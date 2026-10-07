import mqtt from 'mqtt'
import { hostname } from 'node:os'
import { loadConfig } from './shared/config'
import { logger } from './shared/logger'
import { createMqttTopics } from './shared/mqttTopics'
import { createPrismaClient } from './infra/db/prismaClient'
import { createRawPrismaClient } from './infra/db/raw/rawPrismaClient'
import { PrismaRoomRepository } from './infra/db/PrismaRoomRepository'
import { PrismaDeviceRepository } from './infra/db/PrismaDeviceRepository'
import { PrismaMeasurementRepository } from './infra/db/PrismaMeasurementRepository'
import { PrismaRawMeasurementRepository } from './infra/db/raw/PrismaRawMeasurementRepository'
import { PrismaCommandRepository } from './infra/db/PrismaCommandRepository'
import { PrismaUserRepository } from './infra/db/PrismaUserRepository'
import { MqttCommandPublisher } from './infra/mqtt/MqttCommandPublisher'
import { systemClock } from './domain/ports/Clock'
import { MeasurementIngestionService } from './domain/services/MeasurementIngestionService'
import { CommandService } from './domain/services/CommandService'
import { DeviceAssociationService } from './domain/services/deviceAssociation'
import { attachMqttSubscriptions } from './driving/mqtt/client'
import { startConsolidationPolling } from './driving/worker/consolidationPoller'
import { buildApiServer } from './driving/api/server'
import type { AlertThreshold } from './domain/services/alerts'
import type { PlausibilityRange } from './domain/services/plausibility'
import type { FastifyInstance } from 'fastify'
import type { MqttClient } from 'mqtt'
import type { PrismaClient } from '@prisma/client'

// PLACEHOLDER : seuils d'alerte réels à définir une fois le contrat de
// mesures du kit connu (types de capteurs, unités, bornes).
const alertThresholds: AlertThreshold[] = []

// Bornes de plausibilité physique par type de mesure (kit démo : capteur
// intérieur température/CO2). Une valeur hors bornes est rejetée avant
// d'atteindre la base vérifiée — voir domain/services/plausibility.ts.
const plausibilityRanges: PlausibilityRange[] = [
  { type: 'temperature', min: -40, max: 85 },
  { type: 'co2', min: 0, max: 40000 }
]

export interface Application {
  api: FastifyInstance
  mqttClient: MqttClient
  prisma: PrismaClient
  stop: () => Promise<void>
}

/**
 * Process API : sert le HTTP (lecture base vérifiée uniquement, jamais la
 * base brute) et publie les commandes sortantes. Depuis l'ADR 0012, il ne
 * s'abonne plus à rien côté MQTT — c'est le rôle de `startIngester`. Le
 * client MQTT gardé ici ne sert qu'à publier (`POST /devices/:id/commands`),
 * donc pas de session persistante ni de `clientId` fixe nécessaire : rien
 * à "rattraper" pour un client qui ne fait que publier à la demande.
 */
export async function startApplication(): Promise<Application> {
  const config = loadConfig()
  const topics = createMqttTopics(config.MQTT_TOPIC_PREFIX)

  const prisma = createPrismaClient()
  const rooms = new PrismaRoomRepository(prisma)
  const devices = new PrismaDeviceRepository(prisma)
  const measurements = new PrismaMeasurementRepository(prisma)
  const commands = new PrismaCommandRepository(prisma)
  const users = new PrismaUserRepository(prisma)

  const mqttClient = mqtt.connect(config.MQTT_URL)
  const publisher = new MqttCommandPublisher(mqttClient, topics)

  const commandService = new CommandService(commands, devices, publisher, systemClock)
  const deviceAssociationService = new DeviceAssociationService(devices, rooms)

  const api = buildApiServer({
    jwtSecret: config.JWT_SECRET,
    users,
    rooms,
    devices,
    measurements,
    commandService,
    commands,
    deviceAssociationService,
    staleThresholdMs: config.DEVICE_STALE_THRESHOLD_MS
  })

  await api.listen({ port: config.PORT, host: '0.0.0.0' })

  const stop = async (): Promise<void> => {
    await api.close()
    mqttClient.end()
    await prisma.$disconnect()
  }

  return { api, mqttClient, prisma, stop }
}

export interface IngesterApplication {
  mqttClient: MqttClient
  stop: () => Promise<void>
}

/**
 * Process ingester (ADR 0012) : seul abonné aux mesures/accusés MQTT,
 * écrit en base brute (`recordRaw`) et acquitte les commandes — jamais la
 * base vérifiée directement. Session persistante (`clean: false`) pour
 * rattraper ce qui a été publié pendant une coupure (voir ADR 0010) ; le
 * `clientId` est dérivé du hostname du conteneur plutôt que fixe en dur,
 * pour que plusieurs instances (plusieurs replicas Docker) aient chacune
 * leur propre session stable, sans collision.
 *
 * S'abonne via une souscription partagée (`$share/<groupe>/...`, voir
 * `driving/mqtt/client.ts`) quand `MQTT_SHARED_GROUP` est défini : chaque
 * message n'est alors délivré qu'à UNE seule instance du groupe, pas à
 * toutes — c'est ce qui permet de scaler horizontalement sans dupliquer
 * l'ingestion. Vide par défaut pour ne pas risquer de casser une connexion
 * vers un broker qui ne le supporterait pas (ex. kit VPS, non vérifié).
 */
export async function startIngester(): Promise<IngesterApplication> {
  const config = loadConfig()
  const topics = createMqttTopics(config.MQTT_TOPIC_PREFIX)

  const prisma = createPrismaClient()
  const rawPrisma = createRawPrismaClient()
  const devices = new PrismaDeviceRepository(prisma)
  const measurements = new PrismaMeasurementRepository(prisma)
  const rawMeasurements = new PrismaRawMeasurementRepository(rawPrisma)
  const commands = new PrismaCommandRepository(prisma)

  const clientId = `campify-ingester-${hostname()}`
  const mqttClient = mqtt.connect(config.MQTT_URL, { clientId, clean: false })
  const publisher = new MqttCommandPublisher(mqttClient, topics)

  // `recordRaw()` est le seul appelé ici (jamais `consolidate()`, donc
  // jamais besoin des seuils d'alerte/plausibilité) ; `measurements` n'est
  // requis que par la signature du constructeur.
  const ingestion = new MeasurementIngestionService(measurements, rawMeasurements, logger)
  // `dispatch()` n'est jamais appelé depuis l'ingester (seul `acknowledge()`
  // l'est, câblé sur l'accusé MQTT) — le publisher est quand même requis
  // par le constructeur de CommandService.
  const commandService = new CommandService(commands, devices, publisher, systemClock)

  attachMqttSubscriptions(mqttClient, {
    topics,
    ingestion,
    commandService,
    logger,
    qos: config.MQTT_QOS,
    sharedGroup: config.MQTT_SHARED_GROUP
  })

  const stop = async (): Promise<void> => {
    mqttClient.end()
    await prisma.$disconnect()
    await rawPrisma.$disconnect()
  }

  return { mqttClient, stop }
}

export interface WorkerApplication {
  prisma: PrismaClient
  stop: () => Promise<void>
}

/**
 * Process séparé (ADR 0011) : consolide en continu ce que l'ingester a
 * laissé en attente dans la base brute, sans jamais partager de process
 * avec lui ni avec l'API — un pic d'ingestion MQTT ne peut donc pas
 * ralentir les réponses de l'API, et inversement.
 */
export async function startWorker(): Promise<WorkerApplication> {
  const config = loadConfig()

  const prisma = createPrismaClient()
  const rawPrisma = createRawPrismaClient()
  const measurements = new PrismaMeasurementRepository(prisma)
  const rawMeasurements = new PrismaRawMeasurementRepository(rawPrisma)

  const ingestion = new MeasurementIngestionService(measurements, rawMeasurements, logger, alertThresholds, plausibilityRanges)

  const stopPolling = startConsolidationPolling({
    ingestion,
    rawMeasurements,
    logger,
    intervalMs: config.CONSOLIDATION_POLL_INTERVAL_MS,
    batchSize: config.CONSOLIDATION_BATCH_SIZE
  })

  const stop = async (): Promise<void> => {
    stopPolling()
    await prisma.$disconnect()
    await rawPrisma.$disconnect()
  }

  return { prisma, stop }
}
