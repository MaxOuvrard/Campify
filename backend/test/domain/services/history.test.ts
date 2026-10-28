import { test } from 'node:test'
import * as assert from 'node:assert'
import {
  resolveHistoryRange,
  resolveBucketMs,
  DEFAULT_HISTORY_SPAN_MS,
  MAX_HISTORY_SPAN_MS,
  MAX_HISTORY_POINTS,
  MAX_HISTORY_BUCKETS
} from '../../../src/domain/services/history'

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

function span(ms: number) {
  const to = new Date('2024-01-08T00:00:00Z')
  return { from: new Date(to.getTime() - ms), to }
}

const HOUR = 60 * 60 * 1000

test('picks a round bucket size covering the whole range: 10s for 1h, 5min for 24h, 30min for 7 days', () => {
  assert.equal(resolveBucketMs(span(HOUR)), 10 * 1000)
  assert.equal(resolveBucketMs(span(24 * HOUR)), 5 * 60 * 1000)
  assert.equal(resolveBucketMs(span(7 * 24 * HOUR)), 30 * 60 * 1000)
})

test('never produces more than MAX_HISTORY_BUCKETS buckets, partial buckets at both ends included', () => {
  for (const ms of [1000, 59 * 1000, HOUR, 6 * HOUR, 24 * HOUR, 3 * 24 * HOUR, MAX_HISTORY_SPAN_MS]) {
    const bucketMs = resolveBucketMs(span(ms))
    assert.ok(Math.ceil(ms / bucketMs) + 1 <= MAX_HISTORY_BUCKETS, `${ms}ms -> ${bucketMs}ms`)
  }
})

test('every bucket size divides a day, so buckets line up from one day to the next', () => {
  for (const ms of [HOUR, 24 * HOUR, MAX_HISTORY_SPAN_MS]) {
    assert.equal((24 * HOUR) % resolveBucketMs(span(ms)), 0)
  }
})
