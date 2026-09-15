import { PrismaClient } from '@prisma/client'
import { MeasurementRepository } from '../../domain/ports/MeasurementRepository'
import { Measurement, NewMeasurement } from '../../domain/entities/Measurement'

interface MeasurementRow {
  id: string
  deviceId: string
  type: string
  value: number
  unit: string | null
  timestamp: Date
  receivedAt: Date
}

function toDomain(row: MeasurementRow): Measurement {
  return { ...row }
}

export class PrismaMeasurementRepository implements MeasurementRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: NewMeasurement): Promise<Measurement> {
    const row = await this.prisma.measurement.create({
      data: {
        deviceId: input.deviceId,
        type: input.type,
        value: input.value,
        unit: input.unit ?? null,
        timestamp: input.timestamp
      }
    })
    return toDomain(row)
  }

  async findLatestByDevice(deviceId: string, type?: string): Promise<Measurement | null> {
    const row = await this.prisma.measurement.findFirst({
      where: { deviceId, ...(type ? { type } : {}) },
      orderBy: { timestamp: 'desc' }
    })
    return row ? toDomain(row) : null
  }

  async findByDeviceInRange(deviceId: string, from: Date, to: Date): Promise<Measurement[]> {
    const rows = await this.prisma.measurement.findMany({
      where: { deviceId, timestamp: { gte: from, lte: to } },
      orderBy: { timestamp: 'asc' }
    })
    return rows.map(toDomain)
  }

  async findLatestByDeviceGroupedByType(deviceId: string): Promise<Measurement[]> {
    const rows = await this.prisma.measurement.findMany({
      where: { deviceId },
      distinct: ['type'],
      orderBy: { timestamp: 'desc' }
    })
    return rows.map(toDomain)
  }
}
