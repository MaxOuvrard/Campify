import { test } from 'node:test'
import * as assert from 'node:assert'
import { decideMeasurement } from '../../../src/domain/services/dedup'
import { Measurement } from '../../../src/domain/entities/Measurement'

function makeMeasurement(timestamp: Date): Measurement {
  return {
    id: 'm1',
    deviceId: 'd1',
    type: 'temperature',
    value: 21,
    unit: 'C',
    timestamp,
    receivedAt: timestamp
  }
}

test('accepts the first measurement for a device', () => {
  const decision = decideMeasurement(null, new Date('2024-01-01T00:00:00Z'))
  assert.deepStrictEqual(decision, { accepted: true })
})

test('rejects a duplicate measurement (same timestamp)', () => {
  const latest = makeMeasurement(new Date('2024-01-01T00:00:00Z'))
  const decision = decideMeasurement(latest, new Date('2024-01-01T00:00:00Z'))
  assert.deepStrictEqual(decision, { accepted: false, reason: 'duplicate' })
})

test('rejects a late measurement (older timestamp)', () => {
  const latest = makeMeasurement(new Date('2024-01-01T00:01:00Z'))
  const decision = decideMeasurement(latest, new Date('2024-01-01T00:00:00Z'))
  assert.deepStrictEqual(decision, { accepted: false, reason: 'late' })
})

test('accepts a newer measurement', () => {
  const latest = makeMeasurement(new Date('2024-01-01T00:00:00Z'))
  const decision = decideMeasurement(latest, new Date('2024-01-01T00:01:00Z'))
  assert.deepStrictEqual(decision, { accepted: true })
})
