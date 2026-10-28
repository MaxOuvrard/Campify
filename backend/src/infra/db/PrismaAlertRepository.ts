import { PrismaClient, Prisma } from '@prisma/client'
import { AlertRepository } from '../../domain/ports/AlertRepository'
import { Alert, AlertReason, AlertUpdate, NewAlert } from '../../domain/entities/Alert'

interface AlertRow {
  id: string
  deviceId: string
  measurementType: string
  reason: string
  threshold: number
  triggerValue: number
  openedAt: Date
  openedEventId: string | null
  lastValue: number
  lastSeenAt: Date
  resolvedAt: Date | null
  resolvedValue: number | null
  resolvedEventId: string | null
}

function toDomain(row: AlertRow): Alert {
  return {
    id: row.id,
    deviceId: row.deviceId,
    measurementType: row.measurementType,
    reason: row.reason as AlertReason,
    threshold: row.threshold,
    triggerValue: row.triggerValue,
    openedAt: row.openedAt,
    openedEventId: row.openedEventId,
    lastValue: row.lastValue,
    lastSeenAt: row.lastSeenAt,
    resolvedAt: row.resolvedAt,
    resolvedValue: row.resolvedValue,
    resolvedEventId: row.resolvedEventId
  }
}

/** Clé d'unicité des alertes ouvertes, voir le modèle `Alert` dans schema.prisma. */
function openKeyOf(deviceId: string, measurementType: string): string {
  return `${deviceId}:${measurementType}`
}

export class PrismaAlertRepository implements AlertRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findOpen(deviceId: string, measurementType: string): Promise<Alert | null> {
    const row = await this.prisma.alert.findUnique({ where: { openKey: openKeyOf(deviceId, measurementType) } })
    return row ? toDomain(row) : null
  }

  async open(input: NewAlert): Promise<Alert> {
    try {
      const row = await this.prisma.alert.create({
        data: {
          ...input,
          lastValue: input.triggerValue,
          lastSeenAt: input.openedAt,
          openKey: openKeyOf(input.deviceId, input.measurementType)
        }
      })
      return toDomain(row)
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const existing = await this.findOpen(input.deviceId, input.measurementType)
        if (existing) return existing
      }
      throw err
    }
  }

  async recordOngoing(id: string, update: AlertUpdate): Promise<void> {
    await this.prisma.alert.update({ where: { id }, data: { lastValue: update.value, lastSeenAt: update.at } })
  }

  async resolve(id: string, update: AlertUpdate): Promise<void> {
    await this.prisma.alert.update({
      where: { id },
      data: {
        lastValue: update.value,
        lastSeenAt: update.at,
        resolvedAt: update.at,
        resolvedValue: update.value,
        resolvedEventId: update.eventId,
        openKey: null
      }
    })
  }

  async findOpenByDevices(deviceIds: string[]): Promise<Alert[]> {
    const rows = await this.prisma.alert.findMany({
      where: { deviceId: { in: deviceIds }, resolvedAt: null },
      orderBy: { openedAt: 'desc' }
    })
    return rows.map(toDomain)
  }

  async findByDevicesInRange(deviceIds: string[], from: Date, to: Date, limit: number): Promise<Alert[]> {
    const rows = await this.prisma.alert.findMany({
      where: {
        deviceId: { in: deviceIds },
        openedAt: { lte: to },
        OR: [{ resolvedAt: null }, { resolvedAt: { gte: from } }]
      },
      orderBy: { openedAt: 'desc' },
      take: limit
    })
    return rows.map(toDomain)
  }

  async countOpenByRoom(): Promise<Map<string, number>> {
    // Une seule requête pour toutes les salles (GET /rooms), plutôt qu'une par salle.
    const rows = await this.prisma.$queryRaw<Array<{ roomId: string; count: bigint }>>`
      SELECT d."roomId", COUNT(*) AS count
      FROM "Alert" a JOIN "Device" d ON d."id" = a."deviceId"
      WHERE a."resolvedAt" IS NULL
      GROUP BY d."roomId"`
    return new Map(rows.map((r) => [r.roomId, Number(r.count)]))
  }
}
