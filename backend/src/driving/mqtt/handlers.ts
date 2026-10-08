import { Logger } from '../../domain/ports/Logger'
import { RawEventRepository } from '../../domain/ports/RawEventRepository'
import { CommandService } from '../../domain/services/CommandService'
import { ForbiddenError, NotFoundError } from '../../shared/errors'
import { MqttTopics } from '../../shared/mqttTopics'
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
  topics: MqttTopics
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

    const deviceId = deps.topics.parseDeviceIdFromAckTopic(topic)
    if (deviceId === null) {
      deps.logger.warn('mqtt command ack on a topic without device id', {
        eventType: COMMAND_ACK_EVENT_TYPE,
        topic,
        commandId: result.data.command_id,
        status: 'rejected',
        reason: 'invalid_topic'
      })
      return
    }

    // Réception brute de l'ACK, AVANT le domaine : distingue « l'ACK n'est
    // jamais arrivé » de « l'ACK est arrivé mais a été rejeté » (ADR 0014).
    deps.logger.info('command ack received', {
      eventType: COMMAND_ACK_EVENT_TYPE,
      topic,
      deviceId,
      commandId: result.data.command_id,
      ackStatus: result.data.status,
      status: 'ack_received'
    })

    try {
      await deps.commandService.acknowledge({
        commandId: result.data.command_id,
        deviceId,
        status: result.data.status,
        reason: result.data.reason ?? null,
        state: result.data.state ?? null,
        ackedAt: new Date(result.data.acked_at)
      })
    } catch (err) {
      deps.logger.warn('failed to acknowledge command', {
        eventType: COMMAND_ACK_EVENT_TYPE,
        topic,
        deviceId,
        commandId: result.data.command_id,
        status: 'rejected',
        reason: ackFailureReason(err),
        error: (err as Error).message
      })
    }
  }
}

function ackFailureReason(err: unknown): string {
  if (err instanceof NotFoundError) return 'unknown_command'
  if (err instanceof ForbiddenError) return 'device_mismatch'
  return 'error'
}

function parseJson(payload: Buffer | string): unknown {
  try {
    return JSON.parse(payload.toString())
  } catch {
    return undefined
  }
}
