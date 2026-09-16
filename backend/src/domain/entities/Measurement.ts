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

export interface NewMeasurement {
  deviceId: string
  type: string
  value: number
  unit?: string | null
  timestamp: Date
  messageId?: string | null
}
