import { MeasurementRepository } from '../ports/MeasurementRepository'
import { RawMeasurementRepository } from '../ports/RawMeasurementRepository'
import { Logger } from '../ports/Logger'
import { Measurement, NewMeasurement } from '../entities/Measurement'
import { decideMeasurement, MeasurementRejectionReason } from './dedup'
import { evaluateAlerts, AlertThreshold } from './alerts'

export type IngestionRejectionReason = MeasurementRejectionReason | 'raw_unavailable'

export interface MeasurementIngestionResult {
  accepted: boolean
  reason?: IngestionRejectionReason
  measurement?: Measurement
}

/**
 * Point d'entrée unique du domaine pour toute mesure entrante, quel que soit
 * l'adapter driving (MQTT ou API) qui la reçoit — voir ADR 0005 :
 *
 * 1. Enregistre systématiquement dans la base brute (aucun filtre).
 * 2. Relit cette même ligne depuis la base brute (la base vérifiée n'est
 *    jamais alimentée directement depuis l'entrée MQTT/API, seulement via
 *    ce qui a été relu en base brute).
 * 3. Applique dédup/retard sur cette donnée relue, persiste dans la base
 *    vérifiée si acceptée et évalue les alertes. La présence d'un device se
 *    dérive de ses mesures (MeasurementRepository.findLatestReceivedAt),
 *    pas d'un champ mutable maintenu ici — voir domain/services/freshness.ts.
 */
export class MeasurementIngestionService {
  constructor(
    private readonly measurements: MeasurementRepository,
    private readonly rawMeasurements: RawMeasurementRepository,
    private readonly logger: Logger,
    private readonly thresholds: AlertThreshold[] = []
  ) {}

  async ingest(input: NewMeasurement): Promise<MeasurementIngestionResult> {
    const raw = await this.recordAndReadBack(input)
    if (raw === null) {
      return { accepted: false, reason: 'raw_unavailable' }
    }

    const latest = await this.measurements.findLatestByDevice(raw.deviceId, raw.type)
    const decision = decideMeasurement(latest, { timestamp: raw.timestamp, messageId: raw.messageId })

    if (!decision.accepted) {
      this.logger.warn('measurement rejected', {
        deviceId: raw.deviceId,
        type: raw.type,
        reason: decision.reason
      })
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

    for (const alert of evaluateAlerts(measurement, this.thresholds)) {
      this.logger.warn('threshold alert', { ...alert })
    }

    return { accepted: true, measurement }
  }

  /**
   * Écrit dans la base brute puis relit la ligne — c'est cette relecture,
   * pas la donnée entrante en mémoire, qui alimente la suite du traitement.
   * Si la base brute est indisponible ou ne renvoie pas la ligne, la base
   * vérifiée n'est délibérément pas alimentée : elle dépend de la base
   * brute, pas de l'entrée MQTT/API directement.
   */
  private async recordAndReadBack(input: NewMeasurement) {
    try {
      const created = await this.rawMeasurements.record(input)
      const reread = await this.rawMeasurements.findById(created.id)
      if (reread === null) {
        this.logger.warn('raw measurement not found on read-back', {
          deviceId: input.deviceId,
          type: input.type
        })
      }
      return reread
    } catch (err) {
      this.logger.warn('failed to record raw measurement', {
        deviceId: input.deviceId,
        type: input.type,
        error: (err as Error).message
      })
      return null
    }
  }
}
