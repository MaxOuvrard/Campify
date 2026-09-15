import { PrismaClient } from '@prisma/client'
import { RoomRepository } from '../../domain/ports/RoomRepository'
import { Room } from '../../domain/entities/Room'

interface RoomRow {
  id: string
  name: string
  createdAt: Date
}

function toDomain(row: RoomRow): Room {
  return { id: row.id, name: row.name, createdAt: row.createdAt }
}

export class PrismaRoomRepository implements RoomRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findAll(): Promise<Room[]> {
    const rows = await this.prisma.room.findMany({ orderBy: { name: 'asc' } })
    return rows.map(toDomain)
  }

  async findById(id: string): Promise<Room | null> {
    const row = await this.prisma.room.findUnique({ where: { id } })
    return row ? toDomain(row) : null
  }

  async create(name: string): Promise<Room> {
    const row = await this.prisma.room.create({ data: { name } })
    return toDomain(row)
  }
}
