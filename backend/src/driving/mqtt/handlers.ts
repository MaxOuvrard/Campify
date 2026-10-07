import { Logger } from '../../domain/ports/Logger'
import { RawEventRepository } from '../../domain/ports/RawEventRepository'
import { CommandService } from '../../domain/services/CommandService'
import { incomingCommandAckSchema } from './schemas'

const MEASUREMENT_EVENT_TYPE = 'measurement_ingestion'
const COMMAND_ACK_EVENT_TYPE = 'command_ack'

export interface MeasurementHandlerDeps {
  rawEvents: RawEventRepository
  logger: Logger
}

export interface MessageMeta {
  qos?: number
  retain?: boolean
}

/**
 * Chemin d'ingestion MQTT (ADR 0013) : ne fait que journaliser le message
 * tel que reçu. Aucun parsing, aucune validation, aucun filtre ici — un
 * payload invalide, un device inconnu ou un doublon sont stockés comme
 * les autres, et c'est le worker (`driving/worker`) qui décide plus tard
 * de leur sort. Seul un échec d'écriture du journal est journalisé : le
 * message est alors perdu pour cette instance (voir ADR 0010).
 */
export function createMeasurementHandler(deps: MeasurementHandlerDeps) {
  return async function handleMeasurementMessage(topic: string, payload: Buffer | string, meta: MessageMeta = {}): Promise<void> {
    try {
      await deps.rawEvents.record({
        topic,
        payload: payload.toString(),
        qos: meta.qos ?? 0,
        retain: meta.retain ?? false
      })
    } catch (err) {
      deps.logger.error('failed to record raw event', {
        eventType: MEASUREMENT_EVENT_TYPE,
        topic,
        status: 'error',
        reason: 'raw_unavailable',
        error: (err as Error).message
      })
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
