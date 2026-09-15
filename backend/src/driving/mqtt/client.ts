import { MqttClient } from 'mqtt'
import { Logger } from '../../domain/ports/Logger'
import { MqttTopics, matchesTopic } from '../../shared/mqttTopics'
import { MeasurementIngestionService } from '../../domain/services/MeasurementIngestionService'
import { CommandService } from '../../domain/services/CommandService'
import { createMeasurementHandler, createCommandAckHandler } from './handlers'

export interface MqttDrivingDeps {
  topics: MqttTopics
  ingestion: MeasurementIngestionService
  commandService: CommandService
  logger: Logger
}

/**
 * Câble un client mqtt.js déjà connecté (partagé avec le publisher de
 * commandes en infra/mqtt) aux handlers du domaine : mesures entrantes et
 * acquittements de commandes.
 */
export function attachMqttSubscriptions(client: MqttClient, deps: MqttDrivingDeps): void {
  const handleMeasurement = createMeasurementHandler(deps)
  const handleCommandAck = createCommandAckHandler(deps)

  client.on('connect', () => {
    deps.logger.info('mqtt connected')
    client.subscribe([deps.topics.measurementFilter, deps.topics.commandAckFilter], (err) => {
      if (err) deps.logger.error('mqtt subscribe failed', { error: err.message })
    })
  })

  client.on('message', (topic, payload) => {
    if (matchesTopic(deps.topics.measurementFilter, topic)) {
      void handleMeasurement(topic, payload)
    } else if (matchesTopic(deps.topics.commandAckFilter, topic)) {
      void handleCommandAck(topic, payload)
    } else {
      deps.logger.warn('mqtt message on unrecognized topic', { topic })
    }
  })

  client.on('error', (err) => {
    deps.logger.error('mqtt client error', { error: err.message })
  })
}
