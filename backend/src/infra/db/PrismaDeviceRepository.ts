import { PrismaClient } from '@prisma/client'
import { DeviceRepository, NewDevice } from '../../domain/ports/DeviceRepository'
import { Device } from '../../domain/entities/Device'

interface DeviceRow {
  id: string
  name: string
  type: string
  roomId: string
  createdAt: Date
}

function toDomain(row: DeviceRow): Device {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    roomId: row.roomId,
    createdAt: row.createdAt
  }
}

export class PrismaDeviceRepository implements DeviceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findAll(): Promise<Device[]> {
    const rows = await this.prisma.device.findMany()
    return rows.map(toDomain)
  }

  async findById(id: string): Promise<Device | null> {
    const row = await this.prisma.device.findUnique({ where: { id } })
    return row ? toDomain(row) : null
  }

  async findByRoom(roomId: string): Promise<Device[]> {
    const rows = await this.prisma.device.findMany({ where: { roomId } })
    return rows.map(toDomain)
  }

  async create(input: NewDevice): Promise<Device> {
    const row = await this.prisma.device.create({ data: input })
    return toDomain(row)
  }
}
