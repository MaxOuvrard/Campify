export interface Measurement {
  id: string
  deviceId: string
  type: string
  value: number
  unit: string | null
  timestamp: Date
  receivedAt: Date
}

export interface NewMeasurement {
  deviceId: string
  type: string
  value: number
  unit?: string | null
  timestamp: Date
}
