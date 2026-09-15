import { test } from 'node:test'
import * as assert from 'node:assert'
import { PrismaClient } from '@prisma/client'
import { PrismaRoomRepository } from '../../../src/infra/db/PrismaRoomRepository'
import type { Room } from '../../../src/domain/entities/Room'

/**
 * Test de contrat : vérifie que PrismaRoomRepository respecte l'interface
 * RoomRepository contre une vraie base Postgres. Nécessite DATABASE_URL et
 * une base migrée (voir backend/README.md — docker compose up -d && npx
 * prisma migrate dev). Ignoré si DATABASE_URL n'est pas définie, pour ne
 * pas casser `npm test` sans dépendances externes.
 */
test('PrismaRoomRepository respects the RoomRepository contract', { skip: !process.env.DATABASE_URL }, async () => {
  const prisma = new PrismaClient()
  const repository = new PrismaRoomRepository(prisma)

  const name = `test-room-${Date.now()}`
  const created = await repository.create(name)
  try {
    assert.equal(created.name, name)

    const found = await repository.findById(created.id)
    assert.equal(found?.id, created.id)

    const all = await repository.findAll()
    assert.ok(all.some((room: Room) => room.id === created.id))
  } finally {
    await prisma.room.deleteMany({ where: { id: created.id } })
    await prisma.$disconnect()
  }
})
