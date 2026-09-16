import { PrismaClient } from '../../../../prisma/generated/raw-client'
import { RawMeasurementRepository } from '../../../domain/ports/RawMeasurementRepository'
import { NewMeasurement } from '../../../domain/entities/Measurement'
import { RawMeasurement } from '../../../domain/entities/RawMeasurement'

interface RawMeasurementRow {
  id: string
  deviceId: string
  type: string
  value: number
  unit: string | null
  timestamp: Date
  messageId: string | null
  receivedAt: Date
}

function toDomain(row: RawMeasurementRow): RawMeasurement {
  return { ...row }
}

export class PrismaRawMeasurementRepository implements RawMeasurementRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async record(input: NewMeasurement): Promise<RawMeasurement> {
    const row = await this.prisma.rawMeasurement.create({
      data: {
        deviceId: input.deviceId,
        type: input.type,
        value: input.value,
        unit: input.unit ?? null,
        timestamp: input.timestamp,
        messageId: input.messageId ?? null
      }
    })
    return toDomain(row)
  }

  async findById(id: string): Promise<RawMeasurement | null> {
    const row = await this.prisma.rawMeasurement.findUnique({ where: { id } })
    return row ? toDomain(row) : null
  }
}
