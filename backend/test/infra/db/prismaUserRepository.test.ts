import { test } from 'node:test'
import * as assert from 'node:assert'
import { PrismaClient } from '@prisma/client'
import { PrismaUserRepository } from '../../../src/infra/db/PrismaUserRepository'

/**
 * Test de contrat : vérifie que PrismaUserRepository respecte l'interface
 * UserRepository contre une vraie base Postgres. Voir
 * prismaRoomRepository.test.ts.
 */
test('PrismaUserRepository respects the UserRepository contract', { skip: !process.env.DATABASE_URL }, async () => {
  const prisma = new PrismaClient()
  const users = new PrismaUserRepository(prisma)

  try {
    const email = `test-user-${Date.now()}@campify.local`
    const created = await prisma.user.create({
      data: { email, passwordHash: 'hash', role: 'VIEWER' }
    })

    const byEmail = await users.findByEmail(email)
    assert.equal(byEmail?.id, created.id)
    assert.equal(byEmail?.role, 'VIEWER')

    const byId = await users.findById(created.id)
    assert.equal(byId?.email, email)

    assert.equal(await users.findByEmail('nobody@campify.local'), null)
  } finally {
    await prisma.user.deleteMany({ where: { email: { startsWith: 'test-user-' } } })
    await prisma.$disconnect()
  }
})
