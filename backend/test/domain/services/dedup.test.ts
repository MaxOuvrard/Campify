import { test } from 'node:test'
import * as assert from 'node:assert'
import { decideMeasurement } from '../../../src/domain/services/dedup'
import { Measurement } from '../../../src/domain/entities/Measurement'

function makeMeasurement(timestamp: Date, messageId: string | null = null): Measurement {
  return {
    id: 'm1',
    deviceId: 'd1',
    type: 'temperature',
    value: 21,
    unit: 'C',
    timestamp,
    receivedAt: timestamp,
    messageId
  }
}

test('accepts the first measurement for a device', () => {
  const decision = decideMeasurement(null, { timestamp: new Date('2024-01-01T00:00:00Z') })
  assert.deepStrictEqual(decision, { accepted: true })
})

test('rejects a duplicate measurement (same timestamp)', () => {
  const latest = makeMeasurement(new Date('2024-01-01T00:00:00Z'))
  const decision = decideMeasurement(latest, { timestamp: new Date('2024-01-01T00:00:00Z') })
  assert.deepStrictEqual(decision, { accepted: false, reason: 'duplicate' })
})

test('rejects a late measurement (older timestamp)', () => {
  const latest = makeMeasurement(new Date('2024-01-01T00:01:00Z'))
  const decision = decideMeasurement(latest, { timestamp: new Date('2024-01-01T00:00:00Z') })
  assert.deepStrictEqual(decision, { accepted: false, reason: 'late' })
})

test('accepts a newer measurement', () => {
  const latest = makeMeasurement(new Date('2024-01-01T00:00:00Z'))
  const decision = decideMeasurement(latest, { timestamp: new Date('2024-01-01T00:01:00Z') })
  assert.deepStrictEqual(decision, { accepted: true })
})

test('rejects a retransmission with the same messageId, even with a different timestamp', () => {
  const latest = makeMeasurement(new Date('2024-01-01T00:00:00Z'), 'msg-1')
  const decision = decideMeasurement(latest, { timestamp: new Date('2024-01-01T00:05:00Z'), messageId: 'msg-1' })
  assert.deepStrictEqual(decision, { accepted: false, reason: 'duplicate' })
})

test('accepts a newer measurement with a different messageId', () => {
  const latest = makeMeasurement(new Date('2024-01-01T00:00:00Z'), 'msg-1')
  const decision = decideMeasurement(latest, { timestamp: new Date('2024-01-01T00:01:00Z'), messageId: 'msg-2' })
  assert.deepStrictEqual(decision, { accepted: true })
})

test('falls back to timestamp comparison when messageId is absent on either side', () => {
  const latest = makeMeasurement(new Date('2024-01-01T00:00:00Z'), null)
  const decision = decideMeasurement(latest, { timestamp: new Date('2024-01-01T00:00:00Z'), messageId: 'msg-1' })
  assert.deepStrictEqual(decision, { accepted: false, reason: 'duplicate' })
})
