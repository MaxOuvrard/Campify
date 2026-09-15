import { test } from 'node:test'
import * as assert from 'node:assert'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { PrismaDeviceRepository } from '../../../src/infra/db/PrismaDeviceRepository'
import { PrismaRoomRepository } from '../../../src/infra/db/PrismaRoomRepository'

/**
 * Test de contrat : vérifie que PrismaDeviceRepository respecte l'interface
 * DeviceRepository contre une vraie base Postgres. Voir prismaRoomRepository.test.ts.
 */
test('PrismaDeviceRepository respects the DeviceRepository contract', { skip: !process.env.DATABASE_URL }, async () => {
  const prisma = new PrismaClient()
  const devices = new PrismaDeviceRepository(prisma)
  const rooms = new PrismaRoomRepository(prisma)

  const room = await rooms.create(`test-room-${randomUUID()}`)
  try {
    const created = await devices.create({ name: 'test-device', type: 'temperature', roomId: room.id })
    assert.equal(created.type, 'temperature')
    assert.equal(created.lastSeenAt, null)

    const found = await devices.findById(created.id)
    assert.equal(found?.id, created.id)

    const byRoom = await devices.findByRoom(room.id)
    assert.ok(byRoom.some((d) => d.id === created.id))

    const all = await devices.findAll()
    assert.ok(all.some((d) => d.id === created.id))

    const seenAt = new Date('2024-01-01T00:00:00Z')
    await devices.updateLastSeen(created.id, seenAt)
    const updated = await devices.findById(created.id)
    assert.deepStrictEqual(updated?.lastSeenAt, seenAt)
  } finally {
    await prisma.device.deleteMany({ where: { roomId: room.id } })
    await prisma.room.deleteMany({ where: { id: room.id } })
    await prisma.$disconnect()
  }
})
