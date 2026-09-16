import { test } from 'node:test'
import * as assert from 'node:assert'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { PrismaMeasurementRepository } from '../../../src/infra/db/PrismaMeasurementRepository'
import { PrismaDeviceRepository } from '../../../src/infra/db/PrismaDeviceRepository'
import { PrismaRoomRepository } from '../../../src/infra/db/PrismaRoomRepository'

/**
 * Test de contrat : vérifie que PrismaMeasurementRepository respecte
 * l'interface MeasurementRepository contre une vraie base Postgres. Voir
 * prismaRoomRepository.test.ts.
 */
test('PrismaMeasurementRepository respects the MeasurementRepository contract', { skip: !process.env.DATABASE_URL }, async () => {
  const prisma = new PrismaClient()
  const measurements = new PrismaMeasurementRepository(prisma)
  const devices = new PrismaDeviceRepository(prisma)
  const rooms = new PrismaRoomRepository(prisma)

  const room = await rooms.create(`test-room-${randomUUID()}`)
  try {
    const device = await devices.create({ name: 'test-device', type: 'temperature', roomId: room.id })

    const older = await measurements.create({
      deviceId: device.id,
      type: 'temperature',
      value: 20,
      unit: '°C',
      timestamp: new Date('2024-01-01T10:00:00Z')
    })
    const newer = await measurements.create({
      deviceId: device.id,
      type: 'temperature',
      value: 21.7,
      unit: '°C',
      timestamp: new Date('2024-01-01T11:00:00Z')
    })
    const co2 = await measurements.create({
      deviceId: device.id,
      type: 'co2',
      value: 2500,
      unit: 'ppm',
      timestamp: new Date('2024-01-01T11:00:00Z')
    })

    const latest = await measurements.findLatestByDevice(device.id, 'temperature')
    assert.equal(latest?.id, newer.id)

    const inRange = await measurements.findByDeviceInRange(
      device.id,
      new Date('2024-01-01T09:00:00Z'),
      new Date('2024-01-01T10:30:00Z'),
      500
    )
    assert.deepEqual(
      inRange.map((m) => m.id),
      [older.id]
    )

    const limited = await measurements.findByDeviceInRange(
      device.id,
      new Date('2024-01-01T09:00:00Z'),
      new Date('2024-01-01T12:00:00Z'),
      2
    )
    assert.deepEqual(
      new Set(limited.map((m) => m.id)),
      new Set([newer.id, co2.id])
    )

    const latestByType = await measurements.findLatestByDeviceGroupedByType(device.id)
    assert.deepEqual(
      latestByType.map((m) => m.type).sort(),
      ['co2', 'temperature']
    )

    const latestReceivedAt = await measurements.findLatestReceivedAt(device.id)
    assert.deepStrictEqual(latestReceivedAt, co2.receivedAt)

    const otherDevice = await devices.create({ name: 'other-device', type: 'temperature', roomId: room.id })
    assert.equal(await measurements.findLatestReceivedAt(otherDevice.id), null)
  } finally {
    await prisma.measurement.deleteMany({ where: { device: { roomId: room.id } } })
    await prisma.device.deleteMany({ where: { roomId: room.id } })
    await prisma.room.deleteMany({ where: { id: room.id } })
    await prisma.$disconnect()
  }
})
