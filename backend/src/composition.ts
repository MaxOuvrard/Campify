import mqtt from 'mqtt'
import { loadConfig } from './shared/config'
import { logger } from './shared/logger'
import { createMqttTopics } from './shared/mqttTopics'
import { createPrismaClient } from './infra/db/prismaClient'
import { PrismaRoomRepository } from './infra/db/PrismaRoomRepository'
import { PrismaDeviceRepository } from './infra/db/PrismaDeviceRepository'
import { PrismaMeasurementRepository } from './infra/db/PrismaMeasurementRepository'
import { PrismaCommandRepository } from './infra/db/PrismaCommandRepository'
import { PrismaUserRepository } from './infra/db/PrismaUserRepository'
import { MqttCommandPublisher } from './infra/mqtt/MqttCommandPublisher'
import { systemClock } from './domain/ports/Clock'
import { MeasurementIngestionService } from './domain/services/MeasurementIngestionService'
import { CommandService } from './domain/services/CommandService'
import { attachMqttSubscriptions } from './driving/mqtt/client'
import { buildApiServer } from './driving/api/server'
import type { AlertThreshold } from './domain/services/alerts'
import type { FastifyInstance } from 'fastify'
import type { MqttClient } from 'mqtt'
import type { PrismaClient } from '@prisma/client'

// PLACEHOLDER : seuils d'alerte réels à définir une fois le contrat de
// mesures du kit connu (types de capteurs, unités, bornes).
const alertThresholds: AlertThreshold[] = []

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
  const rooms = new PrismaRoomRepository(prisma)
  const devices = new PrismaDeviceRepository(prisma)
  const measurements = new PrismaMeasurementRepository(prisma)
  const commands = new PrismaCommandRepository(prisma)
  const users = new PrismaUserRepository(prisma)

  const mqttClient = mqtt.connect(config.MQTT_URL)
  const publisher = new MqttCommandPublisher(mqttClient, topics)

  const ingestion = new MeasurementIngestionService(measurements, devices, systemClock, logger, alertThresholds)
  const commandService = new CommandService(commands, devices, publisher, systemClock)

  attachMqttSubscriptions(mqttClient, { topics, ingestion, commandService, logger })

  const api = buildApiServer({
    jwtSecret: config.JWT_SECRET,
    users,
    rooms,
    devices,
    measurements,
    commandService,
    commands,
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
