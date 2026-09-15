import { Measurement } from '../entities/Measurement'

export type MeasurementRejectionReason = 'duplicate' | 'late'

export interface MeasurementDecision {
  accepted: boolean
  reason?: MeasurementRejectionReason
}

/**
 * Décide si une mesure entrante doit être acceptée par rapport à la dernière
 * mesure connue pour le même device+type : rejette les doublons (même
 * timestamp) et les mesures en retard (timestamp antérieur à la dernière
 * connue), qui peuvent arriver hors ordre via MQTT (QoS, retransmissions).
 */
export function decideMeasurement(latest: Measurement | null, incomingTimestamp: Date): MeasurementDecision {
  if (latest === null) return { accepted: true }

  if (incomingTimestamp.getTime() === latest.timestamp.getTime()) {
    return { accepted: false, reason: 'duplicate' }
  }

  if (incomingTimestamp.getTime() < latest.timestamp.getTime()) {
    return { accepted: false, reason: 'late' }
  }

  return { accepted: true }
}
