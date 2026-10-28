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
}
