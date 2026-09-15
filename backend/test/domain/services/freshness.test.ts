import { test } from 'node:test'
import * as assert from 'node:assert'
import { isFresh } from '../../../src/domain/services/freshness'

test('isFresh returns false when the device was never seen', () => {
  assert.equal(isFresh(null, new Date(), 60_000), false)
})

test('isFresh returns true within the threshold', () => {
  const now = new Date('2024-01-01T00:01:00Z')
  const lastSeenAt = new Date('2024-01-01T00:00:30Z')
  assert.equal(isFresh(lastSeenAt, now, 60_000), true)
})

test('isFresh returns false beyond the threshold', () => {
  const now = new Date('2024-01-01T00:05:00Z')
  const lastSeenAt = new Date('2024-01-01T00:00:00Z')
  assert.equal(isFresh(lastSeenAt, now, 60_000), false)
})
