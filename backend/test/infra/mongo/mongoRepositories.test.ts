import { test } from 'node:test'
import * as assert from 'node:assert'
import { randomUUID } from 'node:crypto'
import { MongoClient } from 'mongodb'
import { MongoRawEventRepository } from '../../../src/infra/mongo/MongoRawEventRepository'
import { MongoConsolidationCheckpointRepository } from '../../../src/infra/mongo/MongoConsolidationCheckpointRepository'
import { MongoDeadLetterRepository } from '../../../src/infra/mongo/MongoDeadLetterRepository'

/**
 * Tests de contrat contre un vrai MongoDB (ignorés si MONGO_URL n'est pas
 * définie). Chaque exécution travaille dans sa propre base, supprimée à la
 * fin : jamais la base de développement.
 */
test('Mongo repositories respect the RawEvent / checkpoint / dead-letter contracts', { skip: !process.env.MONGO_URL }, async () => {
  const client = new MongoClient(process.env.MONGO_URL as string)
  const db = client.db(`campify_test_${randomUUID().replace(/-/g, '')}`)
  try {
    const events = new MongoRawEventRepository(db)
    await events.ensureIndexes(30)

    // Le payload est conservé tel quel, y compris quand il n'est pas du JSON.
    const t0 = new Date('2024-01-01T00:00:00.000Z')
    const a = await events.record({ topic: 'campus/v1/devices/d1/telemetry', payload: '{"ok":1}', qos: 1, retain: false, receivedAt: t0 })
    const b = await events.record({ topic: 'campus/v1/devices/d1/telemetry', payload: 'not json {{', qos: 1, retain: true, receivedAt: t0 })
    const c = await events.record({ topic: 'campus/v1/devices/d2/telemetry', payload: '{}', qos: 0, retain: false, receivedAt: new Date(t0.getTime() + 1000) })

    const all = await events.findAfter(null, 10, new Date(t0.getTime() + 60_000))
    assert.deepEqual(all.map((e) => e.id), [a.id, b.id, c.id])
    assert.equal(all[1].payload, 'not json {{')
    assert.equal(all[1].retain, true)

    // Curseur (receivedAt, id) : deux événements de la même milliseconde restent départagés.
    const afterA = await events.findAfter({ receivedAt: a.receivedAt, id: a.id }, 10, new Date(t0.getTime() + 60_000))
    assert.deepEqual(afterA.map((e) => e.id), [b.id, c.id])
    assert.equal(await events.countAfter({ receivedAt: b.receivedAt, id: b.id }), 1)
    assert.equal(await events.countAfter(null), 3)

    // `receivedBefore` exclut les événements trop récents, `limit` borne le lot.
    assert.deepEqual((await events.findAfter(null, 10, new Date(t0.getTime() + 500))).map((e) => e.id), [a.id, b.id])
    assert.equal((await events.findAfter(null, 2, new Date(t0.getTime() + 60_000))).length, 2)

    const indexes = await db.collection('raw_events').indexes()
    assert.ok(indexes.some((i) => i.name === 'receivedAt_ttl' && i.expireAfterSeconds === 30 * 24 * 3600))

    const checkpoints = new MongoConsolidationCheckpointRepository(db)
    assert.equal(await checkpoints.load('w'), null)
    await checkpoints.save('w', { receivedAt: a.receivedAt, id: a.id })
    await checkpoints.save('w', { receivedAt: c.receivedAt, id: c.id })
    assert.deepEqual(await checkpoints.load('w'), { receivedAt: c.receivedAt, id: c.id })
    assert.equal(await checkpoints.load('other'), null)

    const deadLetters = new MongoDeadLetterRepository(db)
    const failedAt = new Date()
    await deadLetters.record({ event: b, reason: 'invalid_json', failedAt })
    await deadLetters.record({ event: b, reason: 'invalid_json', failedAt })
    const stored = await db.collection('dead_letters').find().toArray()
    assert.equal(stored.length, 1)
    assert.equal(stored[0].reason, 'invalid_json')
    assert.equal(stored[0].event.payload, 'not json {{')
  } finally {
    await db.dropDatabase()
    await client.close()
  }
})
