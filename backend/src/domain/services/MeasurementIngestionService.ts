import { MeasurementRepository } from '../ports/MeasurementRepository'
import { Logger } from '../ports/Logger'
import { Measurement, NewMeasurement } from '../entities/Measurement'
import { decideMeasurement, MeasurementRejectionReason } from './dedup'
import { evaluateAlerts, AlertThreshold } from './alerts'
import { isPlausibleValue, PlausibilityRange } from './plausibility'

export type IngestionRejectionReason = MeasurementRejectionReason | 'implausible_value'

export interface MeasurementIngestionResult {
  accepted: boolean
  reason?: IngestionRejectionReason
  measurement?: Measurement
}

const EVENT_TYPE = 'measurement_ingestion'

/**
 * Règles métier de consolidation d'une mesure, quel que soit l'adapter
 * driving qui la fournit — voir ADR 0005. Depuis l'ADR 0013, ce service ne
 * connaît plus la zone d'atterrissage : l'ingester écrit les messages MQTT
 * bruts dans un journal (port `RawEventRepository`), et c'est le worker
 * (`driving/worker`) qui les décode puis appelle `consolidate()` pour
 * chaque mesure extraite. Ce service applique plausibilité puis
 * dédup/retard, écrit dans la base vérifiée si acceptée, et évalue les
 * alertes. Il ne décide jamais de la fraîcheur : elle se calcule à la
 * lecture (domain/services/freshness.ts).
 *
 * Chaque appel journalise son issue (acceptée ou rejetée, avec motif) sous
 * un `eventType` commun (`measurement_ingestion`) et un `eventId` unique —
 * le `messageId` MQTT — pour pouvoir suivre une mesure donnée de sa
 * réception à son traitement dans les logs centralisés (voir docs/J3.md).
 */
export class MeasurementIngestionService {
  constructor(
    private readonly measurements: MeasurementRepository,
    private readonly logger: Logger,
    private readonly thresholds: AlertThreshold[] = [],
    private readonly plausibilityRanges: PlausibilityRange[] = []
  ) {}

  async consolidate(input: NewMeasurement, eventId: string = input.messageId ?? 'unknown'): Promise<MeasurementIngestionResult> {
    if (!isPlausibleValue(input.type, input.value, this.plausibilityRanges)) {
      this.logger.warn('measurement rejected', {
        eventType: EVENT_TYPE,
        eventId,
        deviceId: input.deviceId,
        type: input.type,
        value: input.value,
        status: 'rejected',
        reason: 'implausible_value'
      })
      return { accepted: false, reason: 'implausible_value' }
    }

    const latest = await this.measurements.findLatestByDevice(input.deviceId, input.type)
    const decision = decideMeasurement(latest, { timestamp: input.timestamp, messageId: input.messageId })

    if (!decision.accepted) {
      this.logger.warn('measurement rejected', {
        eventType: EVENT_TYPE,
        eventId,
        deviceId: input.deviceId,
        type: input.type,
        status: 'rejected',
        reason: decision.reason
      })
      return { accepted: false, reason: decision.reason }
    }

    const measurement = await this.measurements.create(input)

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

    return { accepted: true, measurement }
  }
}
