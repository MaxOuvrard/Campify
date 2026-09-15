import { PrismaClient, Prisma } from '@prisma/client'
import { CommandRepository } from '../../domain/ports/CommandRepository'
import { Command, CommandStatus, NewCommand } from '../../domain/entities/Command'

interface CommandRow {
  id: string
  deviceId: string
  type: string
  payload: Prisma.JsonValue
  status: string
  createdAt: Date
  sentAt: Date | null
  ackedAt: Date | null
}

function toDomain(row: CommandRow): Command {
  return {
    id: row.id,
    deviceId: row.deviceId,
    type: row.type,
    payload: (row.payload as Record<string, unknown> | null) ?? null,
    status: row.status as CommandStatus,
    createdAt: row.createdAt,
    sentAt: row.sentAt,
    ackedAt: row.ackedAt
  }
}

export class PrismaCommandRepository implements CommandRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: NewCommand): Promise<Command> {
    const row = await this.prisma.command.create({
      data: {
        deviceId: input.deviceId,
        type: input.type,
        payload: (input.payload as Prisma.InputJsonValue | undefined) ?? undefined
      }
    })
    return toDomain(row)
  }

  async findById(id: string): Promise<Command | null> {
    const row = await this.prisma.command.findUnique({ where: { id } })
    return row ? toDomain(row) : null
  }

  async updateStatus(id: string, status: CommandStatus, at: Date): Promise<void> {
    const timestampField = status === 'SENT' ? { sentAt: at } : status === 'ACKED' ? { ackedAt: at } : {}
    await this.prisma.command.update({ where: { id }, data: { status, ...timestampField } })
  }
}
