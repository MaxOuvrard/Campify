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
      assert.equal(rows[0].consolidatedAt, null)

      // Le worker de consolidation (ADR 0011) ne doit voir que les lignes
      // pas encore traitées, puis ne plus jamais les revoir une fois
      // marquées. `findUnconsolidated` est global (pas filtré par device) —
      // sur une base avec beaucoup d'historique, on ne peut pas garantir
      // que notre ligne apparaît dans une petite page triée par ancienneté,
      // donc on vérifie via `findById` plutôt que via la présence dans la page.
      const before = await repository.findById(created.id)
      assert.equal(before?.consolidatedAt, null)

      await repository.markConsolidated([created.id])
      const after = await repository.findById(created.id)
      assert.ok(after?.consolidatedAt instanceof Date)

      // Sanity check : la méthode répond bien et exclut ce qui vient d'être marqué.
      const stillPending = await repository.findUnconsolidated(5)
      assert.ok(!stillPending.some((r) => r.id === created.id))
    } finally {
      await prisma.rawMeasurement.deleteMany({ where: { deviceId } })
      await prisma.$disconnect()
    }
  }
)
