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
  /**
   * QoS de souscription (mesures + acks). 0 par défaut si absent (défaut
   * mqtt.js). Configurable via `MQTT_QOS` — voir composition.ts — pour
   * comparer QoS 0 vs QoS 1 sur coupure/reprise du broker (scénario J3).
   */
  qos?: 0 | 1
}

/**
 * Câble un client mqtt.js déjà connecté (partagé avec le publisher de
 * commandes en infra/mqtt) aux handlers du domaine : mesures entrantes et
 * acquittements de commandes.
 *
 * mqtt.js reconnecte automatiquement par défaut (`reconnectPeriod`) ; ce
 * qui manquait était la visibilité sur les transitions de connexion, sans
 * laquelle "le broker est tombé puis remonté" n'est qu'une hypothèse. Un
 * seul événement `eventType: 'mqtt_connection'` avec un `status` distinct
 * par transition, pour pouvoir filtrer sur les deux dans les logs
 * centralisés (voir docs/J3.md).
 */
export function attachMqttSubscriptions(client: MqttClient, deps: MqttDrivingDeps): void {
  const handleMeasurement = createMeasurementHandler(deps)
  const handleCommandAck = createCommandAckHandler(deps)

  client.on('connect', (packet) => {
    deps.logger.info('mqtt connection established', {
      eventType: 'mqtt_connection',
      status: 'connected',
      sessionResumed: packet.sessionPresent
    })
    client.subscribe(
      [deps.topics.measurementFilter, deps.topics.commandAckFilter],
      { qos: deps.qos ?? 0 },
      (err) => {
        if (err) deps.logger.error('mqtt subscribe failed', { eventType: 'mqtt_connection', status: 'subscribe_failed', error: err.message })
      }
    )
  })

  client.on('reconnect', () => {
    deps.logger.warn('mqtt reconnecting', { eventType: 'mqtt_connection', status: 'reconnecting' })
  })

  client.on('close', () => {
    deps.logger.warn('mqtt connection closed', { eventType: 'mqtt_connection', status: 'closed' })
  })

  client.on('offline', () => {
    deps.logger.warn('mqtt client offline', { eventType: 'mqtt_connection', status: 'offline' })
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
    deps.logger.error('mqtt client error', { eventType: 'mqtt_connection', status: 'error', error: err.message })
  })
}
