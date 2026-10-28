import { PrismaClient, Prisma } from '@prisma/client'
import { CommandRepository, CommandTransition, CreateCommandResult } from '../../domain/ports/CommandRepository'
import { Command, CommandAckStatus, CommandStatus, LateAck, NewCommand, OPEN_COMMAND_STATUSES } from '../../domain/entities/Command'

interface CommandRow {
  id: string
  deviceId: string
  type: string
  params: Prisma.JsonValue
  status: string
  createdAt: Date
  expiresAt: Date
  sentAt: Date | null
  ackedAt: Date | null
  failureReason: string | null
  reportedState: Prisma.JsonValue
  timedOutAt: Date | null
  lateAckStatus: string | null
  lateAckAt: Date | null
  requestedBy: string | null
  idempotencyKey: string | null
}

function toDomain(row: CommandRow): Command {
  return {
    id: row.id,
    deviceId: row.deviceId,
    type: row.type,
    params: (row.params as Record<string, unknown> | null) ?? {},
    status: row.status as CommandStatus,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    sentAt: row.sentAt,
    ackedAt: row.ackedAt,
    failureReason: row.failureReason,
    reportedState: (row.reportedState as Record<string, unknown> | null) ?? null,
    timedOutAt: row.timedOutAt,
    lateAck: row.lateAckStatus && row.lateAckAt ? { status: row.lateAckStatus as CommandAckStatus, at: row.lateAckAt } : null,
    requestedBy: row.requestedBy,
    idempotencyKey: row.idempotencyKey
  }
}

function toJson(value: Record<string, unknown> | null | undefined): Prisma.InputJsonValue | typeof Prisma.DbNull | undefined {
  if (value === undefined) return undefined
  if (value === null) return Prisma.DbNull
  return value as Prisma.InputJsonValue
}

export class PrismaCommandRepository implements CommandRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createIfAbsent(input: NewCommand): Promise<CreateCommandResult> {
    try {
      const row = await this.prisma.command.create({
        data: {
          deviceId: input.deviceId,
          type: input.type,
          params: input.params as Prisma.InputJsonValue,
          expiresAt: input.expiresAt,
          requestedBy: input.requestedBy,
          idempotencyKey: input.idempotencyKey
        }
      })
      return { command: toDomain(row), created: true }
    } catch (err) {
      // P2002 = violation de la contrainte unique (requestedBy, idempotencyKey) :
      // une requête identique (éventuellement simultanée) a déjà créé la commande.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err
      const existing = await this.prisma.command.findUnique({
        where: { requestedBy_idempotencyKey: { requestedBy: input.requestedBy, idempotencyKey: input.idempotencyKey } }
      })
      if (existing === null) throw err
      return { command: toDomain(existing), created: false }
    }
  }

  async findById(id: string): Promise<Command | null> {
    const row = await this.prisma.command.findUnique({ where: { id } })
    return row ? toDomain(row) : null
  }

  async transition(id: string, from: CommandStatus[], to: CommandTransition): Promise<boolean> {
    // updateMany = un seul UPDATE … WHERE id AND status IN (…) : le test et
    // l'écriture sont atomiques côté PostgreSQL.
    const result = await this.prisma.command.updateMany({
      where: { id, status: { in: from } },
      data: {
        status: to.status,
        sentAt: to.sentAt,
        ackedAt: to.ackedAt,
        timedOutAt: to.timedOutAt,
        failureReason: to.failureReason,
        reportedState: toJson(to.reportedState)
      }
    })
    return result.count === 1
  }

  async recordLateAck(id: string, lateAck: LateAck, reportedState: Record<string, unknown> | null): Promise<boolean> {
    const result = await this.prisma.command.updateMany({
      where: { id, status: 'TIMEOUT', lateAckStatus: null },
      data: { lateAckStatus: lateAck.status, lateAckAt: lateAck.at, reportedState: toJson(reportedState) }
    })
    return result.count === 1
  }

  async findOpenExpiredBefore(cutoff: Date, limit: number): Promise<Command[]> {
    const rows = await this.prisma.command.findMany({
      where: { status: { in: OPEN_COMMAND_STATUSES }, expiresAt: { lt: cutoff } },
      orderBy: { expiresAt: 'asc' },
      take: limit
    })
    return rows.map(toDomain)
  }
}
