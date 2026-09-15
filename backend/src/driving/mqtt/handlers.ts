import { Logger } from '../../domain/ports/Logger'
import { MqttTopics } from '../../shared/mqttTopics'
import { MeasurementIngestionService } from '../../domain/services/MeasurementIngestionService'
import { CommandService } from '../../domain/services/CommandService'
import { incomingTelemetrySchema, incomingCommandAckSchema, extractMetrics } from './schemas'

export interface MeasurementHandlerDeps {
  topics: MqttTopics
  ingestion: MeasurementIngestionService
  logger: Logger
}

export function createMeasurementHandler(deps: MeasurementHandlerDeps) {
  return async function handleMeasurementMessage(topic: string, payload: Buffer | string): Promise<void> {
    const deviceId = deps.topics.parseDeviceIdFromMeasurementTopic(topic)
    if (deviceId === null) {
      deps.logger.warn('mqtt measurement on unrecognized topic', { topic })
      return
    }

    const json = parseJson(payload)
    if (json === undefined) {
      deps.logger.warn('mqtt measurement payload is not valid json', { topic })
      return
    }

    const result = incomingTelemetrySchema.safeParse(json)
    if (!result.success) {
      deps.logger.warn('mqtt measurement failed schema validation', { topic, error: result.error.message })
      return
    }

    const timestamp = new Date(result.data.observed_at)

    for (const metric of extractMetrics(result.data)) {
      const outcome = await deps.ingestion.ingest({
        deviceId,
        type: metric.type,
        value: metric.value,
        unit: metric.unit,
        timestamp
      })

      if (!outcome.accepted) {
        deps.logger.info('measurement rejected', { deviceId, type: metric.type, reason: outcome.reason })
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
      deps.logger.warn('mqtt command ack payload is not valid json', { topic })
      return
    }

    const result = incomingCommandAckSchema.safeParse(json)
    if (!result.success) {
      deps.logger.warn('mqtt command ack failed schema validation', { topic, error: result.error.message })
      return
    }

    const acknowledgedAt = result.data.acknowledgedAt ? new Date(result.data.acknowledgedAt) : new Date()

    try {
      await deps.commandService.acknowledge(result.data.commandId, acknowledgedAt)
    } catch (err) {
      deps.logger.warn('failed to acknowledge command', {
        commandId: result.data.commandId,
        error: (err as Error).message
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
