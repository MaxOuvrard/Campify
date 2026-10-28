import { test } from 'node:test'
import * as assert from 'node:assert'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { PrismaAlertRepository } from '../../../src/infra/db/PrismaAlertRepository'
import { PrismaDeviceRepository } from '../../../src/infra/db/PrismaDeviceRepository'
import { PrismaRoomRepository } from '../../../src/infra/db/PrismaRoomRepository'

/**
 * Test de contrat : vérifie que PrismaAlertRepository respecte l'interface
 * AlertRepository contre une vraie base Postgres, dont l'invariant « au plus
 * une alerte ouverte par (device, type) » porté par la colonne `openKey`.
 */
test('PrismaAlertRepository respects the AlertRepository contract', { skip: !process.env.DATABASE_URL }, async () => {
  const prisma = new PrismaClient()
  const alerts = new PrismaAlertRepository(prisma)
  const devices = new PrismaDeviceRepository(prisma)
  const rooms = new PrismaRoomRepository(prisma)

  const room = await rooms.create(`test-room-${randomUUID()}`)
  try {
    const device = await devices.create({ name: 'test-device', type: 'co2', roomId: room.id })
    const openedAt = new Date('2024-01-01T10:00:00Z')
    const input = {
      deviceId: device.id,
      measurementType: 'co2',
      reason: 'above_max' as const,
      threshold: 1000,
      triggerValue: 1200,
      openedAt,
      openedEventId: 'msg-open'
    }

    assert.equal(await alerts.findOpen(device.id, 'co2'), null)

    const opened = await alerts.open(input)
    assert.equal(opened.resolvedAt, null)
    assert.equal(opened.lastValue, 1200)

    // Une seconde ouverture concurrente renvoie l'alerte existante au lieu d'en créer une autre.
    const again = await alerts.open({ ...input, triggerValue: 1300, openedEventId: 'msg-concurrent' })
    assert.equal(again.id, opened.id)
    assert.equal(await prisma.alert.count({ where: { deviceId: device.id } }), 1)

    await alerts.recordOngoing(opened.id, { value: 1350, at: new Date('2024-01-01T10:05:00Z'), eventId: 'msg-2' })
    assert.equal((await alerts.findOpen(device.id, 'co2'))?.lastValue, 1350)

    const resolvedAt = new Date('2024-01-01T10:20:00Z')
    await alerts.resolve(opened.id, { value: 850, at: resolvedAt, eventId: 'msg-resolve' })
    assert.equal(await alerts.findOpen(device.id, 'co2'), null)

    const resolved = await prisma.alert.findUniqueOrThrow({ where: { id: opened.id } })
    assert.deepStrictEqual(resolved.resolvedAt, resolvedAt)
    assert.equal(resolved.resolvedValue, 850)
    assert.equal(resolved.resolvedEventId, 'msg-resolve')

    // Après résolution, un nouvel incident ouvre bien une nouvelle alerte.
    const next = await alerts.open({ ...input, openedAt: new Date('2024-01-01T11:00:00Z') })
    assert.notEqual(next.id, opened.id)
  } finally {
    await prisma.alert.deleteMany({ where: { device: { roomId: room.id } } })
    await prisma.device.deleteMany({ where: { roomId: room.id } })
    await prisma.room.deleteMany({ where: { id: room.id } })
    await prisma.$disconnect()
  }
})
