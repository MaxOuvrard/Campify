import { Logger } from '../../domain/ports/Logger'
import { Clock, systemClock } from '../../domain/ports/Clock'
import { RawEventRepository } from '../../domain/ports/RawEventRepository'
import { ConsolidationCheckpointRepository } from '../../domain/ports/ConsolidationCheckpointRepository'
import { DeadLetterRepository } from '../../domain/ports/DeadLetterRepository'
import { DeadLetterReason, RawEvent, RawEventCursor } from '../../domain/entities/RawEvent'
import { MeasurementIngestionService } from '../../domain/services/MeasurementIngestionService'
import { DomainError } from '../../shared/errors'
import { MqttTopics } from '../../shared/mqttTopics'
import { decodeTelemetry } from '../mqtt/schemas'

export interface ConsolidationPollerDeps {
  topics: MqttTopics
  ingestion: MeasurementIngestionService
  rawEvents: RawEventRepository
  checkpoints: ConsolidationCheckpointRepository
  deadLetters: DeadLetterRepository
  logger: Logger
  /** Nom du curseur dans la collection de checkpoints (un par consommateur). */
  consumer: string
  intervalMs: number
  batchSize: number
  /** Délai minimal avant de lire un événement, pour laisser les insertions concurrentes devenir visibles — voir RawEventRepository.findAfter. */
  settleMs: number
  clock?: Clock
}

const EVENT_TYPE = 'measurement_ingestion'

/**
 * Troisième entrée `driving`, symétrique à `driving/mqtt` et `driving/api` —
 * lit le journal brut (ADR 0013), décode chaque message avec le contrat
 * MQTT (`decodeTelemetry`) puis appelle le même domaine
 * (`MeasurementIngestionService.consolidate()`) pour chaque mesure. Aucune
 * règle métier ici (voir ADR 0001).
 *
 * - Progression : un curseur `(receivedAt, id)` persisté après chaque lot,
 *   jamais d'écriture sur les événements eux-mêmes. Un crash entre le
 *   traitement et la sauvegarde rejoue au pire un lot, que la dédup par
 *   messageId absorbe.
 * - Ordre : événements traités un par un, dans l'ordre de réception —
 *   `consolidate()` compare chaque mesure à la dernière connue pour son
 *   device+type, un traitement concurrent pourrait accepter à tort deux
 *   mesures lues sur le même état. C'est aussi pourquoi il ne faut qu'UNE
 *   instance par nom de consommateur.
 * - Échecs : un événement illisible ou rejeté définitivement (payload non
 *   JSON, hors contrat, device inconnu — `DomainError`) part en dead-letter
 *   avec son motif et le curseur avance. Toute autre erreur (base vérifiée
 *   indisponible…) est considérée transitoire : le curseur reste avant
 *   l'événement fautif et le prochain passage le retente, sans rien perdre.
 * - Les lots s'enchaînent sans attendre tant qu'ils sont pleins : l'intervalle
 *   ne sert qu'une fois le journal rattrapé.
 */
export function startConsolidationPolling(deps: ConsolidationPollerDeps): () => void {
  const clock = deps.clock ?? systemClock
  let stopped = false
  let timer: NodeJS.Timeout | null = null
  let cursor: RawEventCursor | null = null
  let cursorLoaded = false
  let currentEventId: string | null = null

  const deadLetter = async (event: RawEvent, reason: DeadLetterReason, error?: string): Promise<void> => {
    await deps.deadLetters.record({ event, reason, error, failedAt: clock.now() })
  }

  const processEvent = async (event: RawEvent): Promise<boolean> => {
    const deviceId = deps.topics.parseDeviceIdFromMeasurementTopic(event.topic)
    if (deviceId === null) {
      deps.logger.warn('mqtt measurement on unrecognized topic', { eventType: EVENT_TYPE, eventId: event.id, topic: event.topic, status: 'rejected', reason: 'unrecognized_topic' })
      await deadLetter(event, 'unrecognized_topic')
      return false
    }

    const decoded = decodeTelemetry(event.payload)
    if (!decoded.ok) {
      deps.logger.warn(decoded.reason === 'invalid_json' ? 'mqtt measurement payload is not valid json' : 'mqtt measurement failed schema validation', {
        eventType: EVENT_TYPE,
        eventId: event.id,
        topic: event.topic,
        deviceId,
        status: 'rejected',
        reason: decoded.reason,
        ...(decoded.error ? { error: decoded.error } : {})
      })
      await deadLetter(event, decoded.reason, decoded.error)
      return false
    }

    let permanentFailure: string | null = null
    for (const metric of decoded.metrics) {
      try {
        await deps.ingestion.consolidate(
          { deviceId, type: metric.type, value: metric.value, unit: metric.unit, timestamp: decoded.observedAt, messageId: decoded.messageId },
          decoded.messageId
        )
      } catch (err) {
        if (!(err instanceof DomainError)) throw err
        permanentFailure = err.message
        deps.logger.warn('measurement dead-lettered', { eventType: EVENT_TYPE, eventId: decoded.messageId, deviceId, type: metric.type, status: 'rejected', reason: 'permanent_failure', error: err.message })
      }
    }
    if (permanentFailure !== null) {
      await deadLetter(event, 'permanent_failure', permanentFailure)
      return false
    }
    return true
  }

  const tick = async (): Promise<void> => {
    if (stopped) return
    currentEventId = null
    try {
      if (!cursorLoaded) {
        cursor = await deps.checkpoints.load(deps.consumer)
        cursorLoaded = true
      }

      let processed = 0
      let full = true
      while (full && !stopped) {
        const events = await deps.rawEvents.findAfter(cursor, deps.batchSize, new Date(clock.now().getTime() - deps.settleMs))
        full = events.length >= deps.batchSize
        let lastDone: RawEvent | null = null
        try {
          for (const event of events) {
            if (stopped) break
            currentEventId = event.id
            await processEvent(event)
            lastDone = event
            processed++
          }
        } finally {
          // Sauvegarde même sur échec transitoire en cours de lot : le travail
          // déjà fait ne sera pas rejoué, seul l'événement fautif le sera.
          if (lastDone !== null) {
            cursor = { receivedAt: lastDone.receivedAt, id: lastDone.id }
            await deps.checkpoints.save(deps.consumer, cursor)
          }
        }
      }

      const pending = await deps.rawEvents.countAfter(cursor)
      if (processed > 0 || pending > 0) {
        deps.logger.info('consolidation progress', { eventType: 'consolidation_lag', consumer: deps.consumer, processed, pending })
      }
    } catch (err) {
      deps.logger.error('consolidation polling tick failed', { error: (err as Error).message, ...(currentEventId ? { eventId: currentEventId } : {}) })
    } finally {
      if (!stopped) timer = setTimeout(() => void tick(), deps.intervalMs)
    }
  }

  void tick()

  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
}
