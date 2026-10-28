export interface Measurement {
  id: string
  deviceId: string
  type: string
  value: number
  unit: string | null
  timestamp: Date
  receivedAt: Date
  /** Identifiant du message source (ex: message_id MQTT), utilisé pour la dédup. */
  messageId: string | null
}

/** Résumé d'un intervalle de temps de l'historique agrégé (domain/services/history.ts). */
export interface MeasurementBucket {
  /** Début de l'intervalle (inclus) ; il dure `bucketMs`. */
  start: Date
  avg: number
  min: number
  max: number
  /** Nombre de mesures brutes résumées par cet intervalle. */
  count: number
}

export interface NewMeasurement {
  deviceId: string
  type: string
  value: number
  unit?: string | null
  timestamp: Date
  messageId?: string | null
}
