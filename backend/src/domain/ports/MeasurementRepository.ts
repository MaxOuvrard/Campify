import { Measurement, NewMeasurement } from '../entities/Measurement'

export interface MeasurementRepository {
  create(input: NewMeasurement): Promise<Measurement>
  findLatestByDevice(deviceId: string, type?: string): Promise<Measurement | null>
  findByDeviceInRange(deviceId: string, from: Date, to: Date, limit: number): Promise<Measurement[]>
  /** Dernière mesure de chaque type produit par le device (ex: temperature + co2 pour un capteur multi-métrique). */
  findLatestByDeviceGroupedByType(deviceId: string): Promise<Measurement[]>
  /** Date de réception de la mesure la plus récente du device (tous types confondus) — sert à dériver sa présence, voir domain/services/freshness.ts. */
  findLatestReceivedAt(deviceId: string): Promise<Date | null>
}
