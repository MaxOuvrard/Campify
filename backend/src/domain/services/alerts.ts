import { Measurement } from '../entities/Measurement'

export interface AlertThreshold {
  type: string
  min?: number
  max?: number
}

export interface Alert {
  deviceId: string
  measurementType: string
  value: number
  reason: 'below_min' | 'above_max'
  threshold: number
}

export function evaluateAlerts(measurement: Measurement, thresholds: AlertThreshold[]): Alert[] {
  const alerts: Alert[] = []

  for (const threshold of thresholds) {
    if (threshold.type !== measurement.type) continue

    if (threshold.max !== undefined && measurement.value > threshold.max) {
      alerts.push({
        deviceId: measurement.deviceId,
        measurementType: measurement.type,
        value: measurement.value,
        reason: 'above_max',
        threshold: threshold.max
      })
    }

    if (threshold.min !== undefined && measurement.value < threshold.min) {
      alerts.push({
        deviceId: measurement.deviceId,
        measurementType: measurement.type,
        value: measurement.value,
        reason: 'below_min',
        threshold: threshold.min
      })
    }
  }

  return alerts
}
