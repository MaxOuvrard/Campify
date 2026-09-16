import { test } from 'node:test'
import * as assert from 'node:assert'
import { resolveHistoryRange, DEFAULT_HISTORY_SPAN_MS, MAX_HISTORY_SPAN_MS, MAX_HISTORY_POINTS } from '../../../src/domain/services/history'

test('defaults to the last 24h when no range is given', () => {
  const now = new Date('2024-01-08T00:00:00Z')
  const range = resolveHistoryRange({}, now)

  assert.deepStrictEqual(range.to, now)
  assert.deepStrictEqual(range.from, new Date(now.getTime() - DEFAULT_HISTORY_SPAN_MS))
})

test('keeps the requested range when it is within the max span', () => {
  const now = new Date('2024-01-08T00:00:00Z')
  const from = new Date('2024-01-07T00:00:00Z')
  const range = resolveHistoryRange({ from, to: now }, now)

  assert.deepStrictEqual(range.from, from)
  assert.deepStrictEqual(range.to, now)
})

test('clamps a "from" older than the max history span', () => {
  const now = new Date('2024-01-08T00:00:00Z')
  const veryOldFrom = new Date('2020-01-01T00:00:00Z')
  const range = resolveHistoryRange({ from: veryOldFrom, to: now }, now)

  assert.deepStrictEqual(range.from, new Date(now.getTime() - MAX_HISTORY_SPAN_MS))
})

test('always caps the returned points to MAX_HISTORY_POINTS', () => {
  const now = new Date('2024-01-08T00:00:00Z')
  const range = resolveHistoryRange({}, now)

  assert.equal(range.limit, MAX_HISTORY_POINTS)
})
