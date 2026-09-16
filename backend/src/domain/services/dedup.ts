import { Measurement } from '../entities/Measurement'

export type MeasurementRejectionReason = 'duplicate' | 'late'

export interface MeasurementDecision {
  accepted: boolean
  reason?: MeasurementRejectionReason
}

export interface IncomingMeasurement {
  timestamp: Date
  /** Identifiant du message source (ex: message_id MQTT), si connu. */
  messageId?: string | null
}

/**
 * Décide si une mesure entrante doit être acceptée par rapport à la dernière
 * mesure connue pour le même device+type.
 *
 * Deux critères de doublon, dans cet ordre :
 * 1. Même `messageId` que la dernière mesure connue : c'est la même
 *    retransmission MQTT (QoS ≥1) qui revient, indépendamment de son
 *    timestamp — c'est le signal le plus fiable, on ne se fie pas à une
 *    éventuelle coïncidence de date.
 * 2. À défaut de `messageId` (absent des deux côtés), on retombe sur le
 *    timestamp : même timestamp que la dernière connue = doublon, timestamp
 *    antérieur = en retard (mesures qui peuvent arriver hors ordre via MQTT).
 */
export function decideMeasurement(latest: Measurement | null, incoming: IncomingMeasurement): MeasurementDecision {
  if (latest === null) return { accepted: true }

  if (incoming.messageId && latest.messageId && incoming.messageId === latest.messageId) {
    return { accepted: false, reason: 'duplicate' }
  }

  if (incoming.timestamp.getTime() === latest.timestamp.getTime()) {
    return { accepted: false, reason: 'duplicate' }
  }

  if (incoming.timestamp.getTime() < latest.timestamp.getTime()) {
    return { accepted: false, reason: 'late' }
  }

  return { accepted: true }
}
