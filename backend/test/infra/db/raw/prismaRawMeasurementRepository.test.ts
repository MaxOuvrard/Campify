import { test } from 'node:test'
import * as assert from 'node:assert'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '../../../../prisma/generated/raw-client'
import { PrismaRawMeasurementRepository } from '../../../../src/infra/db/raw/PrismaRawMeasurementRepository'

/**
 * Test de contrat : vérifie que PrismaRawMeasurementRepository respecte
 * l'interface RawMeasurementRepository contre une vraie base TimescaleDB.
 * Ignoré si RAW_MEASUREMENTS_DATABASE_URL n'est pas définie. Voir ADR 0005
 * et prismaRoomRepository.test.ts pour le même principe côté base
 * principale.
 */
test(
  'PrismaRawMeasurementRepository respects the RawMeasurementRepository contract',
  { skip: !process.env.RAW_MEASUREMENTS_DATABASE_URL },
  async () => {
    const prisma = new PrismaClient()
    const repository = new PrismaRawMeasurementRepository(prisma)
    const deviceId = `test-device-${randomUUID()}`

    try {
      // La base brute n'a pas de contrainte de clé étrangère : elle accepte
      // même un deviceId qui n'existe pas côté base vérifiée, par design
      // (zone d'atterrissage sans filtre — voir ADR 0005).
      const created = await repository.record({
        deviceId,
        type: 'temperature',
        value: 21.7,
        unit: '°C',
        timestamp: new Date('2024-01-01T00:00:00Z'),
        messageId: 'msg-1'
      })
      assert.equal(created.deviceId, deviceId)
      assert.equal(created.value, 21.7)

      const found = await repository.findById(created.id)
      assert.equal(found?.id, created.id)
      assert.equal(found?.messageId, 'msg-1')

      assert.equal(await repository.findById('00000000-0000-0000-0000-000000000000'), null)

      const rows = await prisma.rawMeasurement.findMany({ where: { deviceId } })
      assert.equal(rows.length, 1)
      assert.equal(rows[0].type, 'temperature')
      assert.equal(rows[0].value, 21.7)
      assert.equal(rows[0].messageId, 'msg-1')
    } finally {
      await prisma.rawMeasurement.deleteMany({ where: { deviceId } })
      await prisma.$disconnect()
    }
  }
)
