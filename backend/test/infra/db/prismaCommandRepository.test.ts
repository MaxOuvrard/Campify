import { test } from 'node:test'
import * as assert from 'node:assert'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { PrismaCommandRepository } from '../../../src/infra/db/PrismaCommandRepository'
import { PrismaDeviceRepository } from '../../../src/infra/db/PrismaDeviceRepository'
import { PrismaRoomRepository } from '../../../src/infra/db/PrismaRoomRepository'

/**
 * Test de contrat : vérifie que PrismaCommandRepository respecte l'interface
 * CommandRepository contre une vraie base Postgres. Voir
 * prismaRoomRepository.test.ts.
 */
test('PrismaCommandRepository respects the CommandRepository contract', { skip: !process.env.DATABASE_URL }, async () => {
  const prisma = new PrismaClient()
  const commands = new PrismaCommandRepository(prisma)
  const devices = new PrismaDeviceRepository(prisma)
  const rooms = new PrismaRoomRepository(prisma)

  const room = await rooms.create(`test-room-${randomUUID()}`)
  try {
    const device = await devices.create({ name: 'test-device', type: 'temperature', roomId: room.id })

    const created = await commands.create({ deviceId: device.id, type: 'reboot', payload: { force: true } })
    assert.equal(created.status, 'PENDING')
    assert.deepEqual(created.payload, { force: true })

    const sentAt = new Date('2024-01-01T00:00:00Z')
    await commands.updateStatus(created.id, 'SENT', sentAt)
    const sent = await commands.findById(created.id)
    assert.equal(sent?.status, 'SENT')
    assert.deepStrictEqual(sent?.sentAt, sentAt)

    const ackedAt = new Date('2024-01-01T00:05:00Z')
    await commands.updateStatus(created.id, 'ACKED', ackedAt)
    const acked = await commands.findById(created.id)
    assert.equal(acked?.status, 'ACKED')
    assert.deepStrictEqual(acked?.ackedAt, ackedAt)

    assert.equal(await commands.findById('00000000-0000-0000-0000-000000000000'), null)
  } finally {
    await prisma.command.deleteMany({ where: { device: { roomId: room.id } } })
    await prisma.device.deleteMany({ where: { roomId: room.id } })
    await prisma.room.deleteMany({ where: { id: room.id } })
    await prisma.$disconnect()
  }
})
