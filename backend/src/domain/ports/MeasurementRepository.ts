import { Measurement, NewMeasurement } from '../entities/Measurement'

export interface MeasurementRepository {
  create(input: NewMeasurement): Promise<Measurement>
  findLatestByDevice(deviceId: string, type?: string): Promise<Measurement | null>
  findByDeviceInRange(deviceId: string, from: Date, to: Date): Promise<Measurement[]>
}
