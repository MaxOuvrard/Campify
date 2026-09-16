export interface RawMeasurement {
  id: string
  deviceId: string
  type: string
  value: number
  unit: string | null
  timestamp: Date
  messageId: string | null
  receivedAt: Date
}
