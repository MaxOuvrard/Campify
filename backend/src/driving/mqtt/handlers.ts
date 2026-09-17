import { Logger } from '../../domain/ports/Logger'
import { MqttTopics } from '../../shared/mqttTopics'
import { MeasurementIngestionService } from '../../domain/services/MeasurementIngestionService'
import { CommandService } from '../../domain/services/CommandService'
import { incomingTelemetrySchema, incomingCommandAckSchema, extractMetrics } from './schemas'

const MEASUREMENT_EVENT_TYPE = 'measurement_ingestion'
const COMMAND_ACK_EVENT_TYPE = 'command_ack'

export interface MeasurementHandlerDeps {
  topics: MqttTopics
  ingestion: MeasurementIngestionService
  logger: Logger
}

export function createMeasurementHandler(deps: MeasurementHandlerDeps) {
  return async function handleMeasurementMessage(topic: string, payload: Buffer | string): Promise<void> {
    const deviceId = deps.topics.parseDeviceIdFromMeasurementTopic(topic)
    if (deviceId === null) {
      deps.logger.warn('mqtt measurement on unrecognized topic', {
        eventType: MEASUREMENT_EVENT_TYPE,
        topic,
        status: 'rejected',
        reason: 'unrecognized_topic'
      })
      return
    }

    const json = parseJson(payload)
    if (json === undefined) {
      deps.logger.warn('mqtt measurement payload is not valid json', {
        eventType: MEASUREMENT_EVENT_TYPE,
        topic,
        deviceId,
        status: 'rejected',
        reason: 'invalid_json'
      })
      return
    }

    const result = incomingTelemetrySchema.safeParse(json)
    if (!result.success) {
      deps.logger.warn('mqtt measurement failed schema validation', {
        eventType: MEASUREMENT_EVENT_TYPE,
        topic,
        deviceId,
        status: 'rejected',
        reason: 'invalid_schema',
        error: result.error.message
      })
      return
    }

    const timestamp = new Date(result.data.observed_at)

    for (const metric of extractMetrics(result.data)) {
      try {
        // Le rejet éventuel (doublon, retard, valeur implausible, base brute
        // indisponible) est déjà journalisé par MeasurementIngestionService,
        // avec eventId de corrélation — pas de double log ici.
        await deps.ingestion.ingest({
          deviceId,
          type: metric.type,
          value: metric.value,
          unit: metric.unit,
          timestamp,
          messageId: result.data.message_id
        })
      } catch (err) {
        deps.logger.warn('failed to ingest measurement', {
          eventType: MEASUREMENT_EVENT_TYPE,
          topic,
          deviceId,
          type: metric.type,
          eventId: result.data.message_id,
          status: 'error',
          reason: (err as Error).message
        })
      }
    }
  }
}

export interface CommandAckHandlerDeps {
  commandService: CommandService
  logger: Logger
}

export function createCommandAckHandler(deps: CommandAckHandlerDeps) {
  return async function handleCommandAck(topic: string, payload: Buffer | string): Promise<void> {
    const json = parseJson(payload)
    if (json === undefined) {
      deps.logger.warn('mqtt command ack payload is not valid json', {
        eventType: COMMAND_ACK_EVENT_TYPE,
        topic,
        status: 'rejected',
        reason: 'invalid_json'
      })
      return
    }

    const result = incomingCommandAckSchema.safeParse(json)
    if (!result.success) {
      deps.logger.warn('mqtt command ack failed schema validation', {
        eventType: COMMAND_ACK_EVENT_TYPE,
        topic,
        status: 'rejected',
        reason: 'invalid_schema',
        error: result.error.message
      })
      return
    }

    const acknowledgedAt = result.data.acknowledgedAt ? new Date(result.data.acknowledgedAt) : new Date()

    try {
      await deps.commandService.acknowledge(result.data.commandId, acknowledgedAt)
    } catch (err) {
      deps.logger.warn('failed to acknowledge command', {
        eventType: COMMAND_ACK_EVENT_TYPE,
        topic,
        commandId: result.data.commandId,
        status: 'error',
        reason: (err as Error).message
      })
    }
  }
}

function parseJson(payload: Buffer | string): unknown {
  try {
    return JSON.parse(payload.toString())
  } catch {
    return undefined
  }
}
