import { randomUUID } from 'node:crypto'
import { MeasurementRepository } from '../ports/MeasurementRepository'
import { RawMeasurementRepository } from '../ports/RawMeasurementRepository'
import { Logger } from '../ports/Logger'
import { Measurement, NewMeasurement } from '../entities/Measurement'
import { RawMeasurement } from '../entities/RawMeasurement'
import { decideMeasurement, MeasurementRejectionReason } from './dedup'
import { evaluateAlerts, AlertThreshold } from './alerts'
import { isPlausibleValue, PlausibilityRange } from './plausibility'

export type IngestionRejectionReason = MeasurementRejectionReason | 'raw_unavailable' | 'implausible_value'

export interface MeasurementIngestionResult {
  accepted: boolean
  reason?: IngestionRejectionReason
  measurement?: Measurement
}

const EVENT_TYPE = 'measurement_ingestion'

/**
 * Point d'entrée unique du domaine pour toute mesure entrante, quel que soit
 * l'adapter driving (MQTT ou API) qui la reçoit — voir ADR 0005. Depuis
 * l'ADR 0011, le traitement est coupé en deux étapes séparées dans le temps
 * (plus un seul appel synchrone) :
 *
 * 1. `recordRaw()` — appelé par le handler MQTT, chemin rapide : enregistre
 *    systématiquement dans la base brute (aucun filtre) et relit cette même
 *    ligne pour confirmer qu'elle a bien été persistée. Ne décide rien,
 *    n'écrit jamais dans la base vérifiée.
 * 2. `consolidate()` — appelé par le worker de consolidation (polling,
 *    `driving/worker`), sur une ligne déjà en base brute : applique
 *    plausibilité puis dédup/retard, écrit dans la base vérifiée si
 *    accepté, évalue les alertes, et marque la ligne brute comme traitée
 *    pour que le worker ne la reprenne jamais.
 *
 * `ingest()` recompose les deux pour les cas qui veulent le flux complet
 * synchrone (tests, éventuel futur appel API direct) — la présence d'un
 * device se dérive de ses mesures (MeasurementRepository.findLatestReceivedAt),
 * pas d'un champ mutable maintenu ici — voir domain/services/freshness.ts.
 *
 * Chaque appel journalise son issue (acceptée ou rejetée, avec motif) sous
 * un `eventType` commun (`measurement_ingestion`) et un `eventId` unique —
 * le `messageId` MQTT quand il existe, sinon un id généré — pour pouvoir
 * suivre une mesure donnée de sa réception à son traitement dans les logs
 * centralisés (voir docs/J3.md).
 */
export class MeasurementIngestionService {
  constructor(
    private readonly measurements: MeasurementRepository,
    private readonly rawMeasurements: RawMeasurementRepository,
    private readonly logger: Logger,
    private readonly thresholds: AlertThreshold[] = [],
    private readonly plausibilityRanges: PlausibilityRange[] = []
  ) {}

  async ingest(input: NewMeasurement): Promise<MeasurementIngestionResult> {
    const raw = await this.recordRaw(input)
    if (raw === null) {
      return { accepted: false, reason: 'raw_unavailable' }
    }
    return this.consolidate(raw)
  }

  /**
   * Écrit dans la base brute puis relit la ligne — c'est cette relecture,
   * pas la donnée entrante en mémoire, qui alimente la suite du traitement
   * (voir ADR 0005). Ne touche jamais la base vérifiée : c'est le rôle de
   * `consolidate()`, appelé séparément par le worker.
   */
  async recordRaw(input: NewMeasurement): Promise<RawMeasurement | null> {
    const eventId = input.messageId ?? randomUUID()
    try {
      const created = await this.rawMeasurements.record(input)
      const reread = await this.rawMeasurements.findById(created.id)
      if (reread === null) {
        this.logger.warn('raw measurement not found on read-back', {
          eventType: EVENT_TYPE,
          eventId,
          deviceId: input.deviceId,
          type: input.type,
          status: 'rejected',
          reason: 'raw_unavailable'
        })
      }
      return reread
    } catch (err) {
      this.logger.warn('failed to record raw measurement', {
        eventType: EVENT_TYPE,
        eventId,
        deviceId: input.deviceId,
        type: input.type,
        status: 'rejected',
        reason: 'raw_unavailable',
        error: (err as Error).message
      })
      return null
    }
  }

  /**
   * Décide du sort d'une ligne déjà en base brute (plausibilité puis
   * dédup/retard), écrit en base vérifiée si acceptée, évalue les alertes,
   * et marque systématiquement la ligne comme consolidée (acceptée ou
   * rejetée) pour que le worker de polling ne la reprenne jamais.
   */
  async consolidate(raw: RawMeasurement): Promise<MeasurementIngestionResult> {
    const eventId = raw.messageId ?? raw.id

    if (!isPlausibleValue(raw.type, raw.value, this.plausibilityRanges)) {
      this.logger.warn('measurement rejected', {
        eventType: EVENT_TYPE,
        eventId,
        deviceId: raw.deviceId,
        type: raw.type,
        value: raw.value,
        status: 'rejected',
        reason: 'implausible_value'
      })
      await this.rawMeasurements.markConsolidated([raw.id])
      return { accepted: false, reason: 'implausible_value' }
    }

    const latest = await this.measurements.findLatestByDevice(raw.deviceId, raw.type)
    const decision = decideMeasurement(latest, { timestamp: raw.timestamp, messageId: raw.messageId })

    if (!decision.accepted) {
      this.logger.warn('measurement rejected', {
        eventType: EVENT_TYPE,
        eventId,
        deviceId: raw.deviceId,
        type: raw.type,
        status: 'rejected',
        reason: decision.reason
      })
      await this.rawMeasurements.markConsolidated([raw.id])
      return { accepted: false, reason: decision.reason }
    }

    const measurement = await this.measurements.create({
      deviceId: raw.deviceId,
      type: raw.type,
      value: raw.value,
      unit: raw.unit,
      timestamp: raw.timestamp,
      messageId: raw.messageId
    })

    this.logger.info('measurement ingested', {
      eventType: EVENT_TYPE,
      eventId,
      deviceId: measurement.deviceId,
      type: measurement.type,
      value: measurement.value,
      status: 'ingested'
    })

    for (const alert of evaluateAlerts(measurement, this.thresholds)) {
      this.logger.warn('threshold alert', { eventType: EVENT_TYPE, eventId, ...alert })
    }

    await this.rawMeasurements.markConsolidated([raw.id])
    return { accepted: true, measurement }
  }
}
