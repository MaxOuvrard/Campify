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

    const expiresAt = new Date('2024-01-01T00:00:15Z')
    const newCommand = { deviceId: device.id, type: 'set_ventilation', params: { on: true }, expiresAt, requestedBy: 'user-1', idempotencyKey: randomUUID() }
    const first = await commands.createIfAbsent(newCommand)
    assert.equal(first.created, true)
    const created = first.command
    assert.equal(created.idempotencyKey, newCommand.idempotencyKey)

    // Même (requestedBy, idempotencyKey) : la contrainte unique renvoie l'existante, rien n'est créé.
    const replay = await commands.createIfAbsent(newCommand)
    assert.equal(replay.created, false)
    assert.equal(replay.command.id, created.id)

    assert.equal(created.status, 'PENDING')
    assert.deepEqual(created.params, { on: true })
    assert.deepStrictEqual(created.expiresAt, expiresAt)
    assert.equal(created.failureReason, null)
    assert.equal(created.reportedState, null)

    const sentAt = new Date('2024-01-01T00:00:00Z')
    assert.equal(await commands.transition(created.id, ['PENDING'], { status: 'SENT', sentAt }), true)
    const sent = await commands.findById(created.id)
    assert.equal(sent?.status, 'SENT')
    assert.deepStrictEqual(sent?.sentAt, sentAt)

    // Transition conditionnelle : refusée si le statut courant n'est pas dans `from`.
    assert.equal(await commands.transition(created.id, ['PENDING'], { status: 'FAILED' }), false)

    const expired = await commands.findOpenExpiredBefore(new Date('2024-01-01T00:00:20Z'), 10)
    assert.ok(expired.some((c) => c.id === created.id))
    assert.equal((await commands.findOpenExpiredBefore(new Date('2024-01-01T00:00:10Z'), 10)).some((c) => c.id === created.id), false)

    const timedOutAt = new Date('2024-01-01T00:00:20Z')
    assert.equal(await commands.transition(created.id, ['PENDING', 'SENT'], { status: 'TIMEOUT', timedOutAt }), true)

    const lateAt = new Date('2024-01-01T00:00:25Z')
    assert.equal(await commands.recordLateAck(created.id, { status: 'executed', at: lateAt }, { ventilation: 'on' }), true)
    // Un second ACK tardif n'écrase pas le premier.
    assert.equal(await commands.recordLateAck(created.id, { status: 'rejected', at: new Date() }, null), false)
    const timedOut = await commands.findById(created.id)
    assert.equal(timedOut?.status, 'TIMEOUT')
    assert.deepStrictEqual(timedOut?.timedOutAt, timedOutAt)
    assert.deepStrictEqual(timedOut?.lateAck, { status: 'executed', at: lateAt })
    assert.deepEqual(timedOut?.reportedState, { ventilation: 'on' })

    const { command: other } = await commands.createIfAbsent({
      deviceId: device.id,
      type: 'set_ventilation',
      params: { on: false },
      expiresAt,
      requestedBy: 'user-1',
      idempotencyKey: randomUUID()
    })
    await commands.transition(other.id, ['PENDING'], { status: 'FAILED', failureReason: 'rejected_by_device: fan_jammed' })
    assert.equal((await commands.findById(other.id))?.failureReason, 'rejected_by_device: fan_jammed')

    assert.equal(await commands.findById('00000000-0000-0000-0000-000000000000'), null)
  } finally {
    await prisma.command.deleteMany({ where: { device: { roomId: room.id } } })
    await prisma.device.deleteMany({ where: { roomId: room.id } })
    await prisma.room.deleteMany({ where: { id: room.id } })
    await prisma.$disconnect()
  }
})
