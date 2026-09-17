import mqtt from 'mqtt'
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

export async function startApplication(): Promise<Application> {
  const config = loadConfig()
  const topics = createMqttTopics(config.MQTT_TOPIC_PREFIX)

  const prisma = createPrismaClient()
  const rawPrisma = createRawPrismaClient()
  const rooms = new PrismaRoomRepository(prisma)
  const devices = new PrismaDeviceRepository(prisma)
  const measurements = new PrismaMeasurementRepository(prisma)
  const rawMeasurements = new PrismaRawMeasurementRepository(rawPrisma)
  const commands = new PrismaCommandRepository(prisma)
  const users = new PrismaUserRepository(prisma)

  const mqttClient = mqtt.connect(config.MQTT_URL)
  const publisher = new MqttCommandPublisher(mqttClient, topics)

  const ingestion = new MeasurementIngestionService(measurements, rawMeasurements, logger, alertThresholds, plausibilityRanges)
  const commandService = new CommandService(commands, devices, publisher, systemClock)
  const deviceAssociationService = new DeviceAssociationService(devices, rooms)

  attachMqttSubscriptions(mqttClient, { topics, ingestion, commandService, logger })

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
    await rawPrisma.$disconnect()
  }

  return { api, mqttClient, prisma, stop }
}
