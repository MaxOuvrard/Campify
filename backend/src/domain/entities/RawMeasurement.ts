export interface RawMeasurement {
  id: string
  deviceId: string
  type: string
  value: number
  unit: string | null
  timestamp: Date
  messageId: string | null
  receivedAt: Date
  /** Null tant que le worker de consolidation n'a pas encore traité cette ligne — voir ADR 0011. */
  consolidatedAt: Date | null
}
