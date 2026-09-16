import { MeasurementRepository } from '../ports/MeasurementRepository'
import { DeviceRepository } from '../ports/DeviceRepository'
import { Clock } from '../ports/Clock'
import { Logger } from '../ports/Logger'
import { Measurement, NewMeasurement } from '../entities/Measurement'
import { decideMeasurement, MeasurementRejectionReason } from './dedup'
import { evaluateAlerts, AlertThreshold } from './alerts'

export interface MeasurementIngestionResult {
  accepted: boolean
  reason?: MeasurementRejectionReason
  measurement?: Measurement
}

/**
 * Point d'entrée unique du domaine pour toute mesure entrante, quel que soit
 * l'adapter driving (MQTT ou API) qui la reçoit : applique dédup/retard,
 * persiste, met à jour la fraîcheur du device et évalue les alertes.
 */
export class MeasurementIngestionService {
  constructor(
    private readonly measurements: MeasurementRepository,
    private readonly devices: DeviceRepository,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly thresholds: AlertThreshold[] = []
  ) {}

  async ingest(input: NewMeasurement): Promise<MeasurementIngestionResult> {
    const latest = await this.measurements.findLatestByDevice(input.deviceId, input.type)
    const decision = decideMeasurement(latest, { timestamp: input.timestamp, messageId: input.messageId })

    if (!decision.accepted) {
      this.logger.warn('measurement rejected', {
        deviceId: input.deviceId,
        type: input.type,
        reason: decision.reason
      })
      return { accepted: false, reason: decision.reason }
    }

    const measurement = await this.measurements.create(input)
    await this.devices.updateLastSeen(input.deviceId, this.clock.now())

    for (const alert of evaluateAlerts(measurement, this.thresholds)) {
      this.logger.warn('threshold alert', { ...alert })
    }

    return { accepted: true, measurement }
  }
}
