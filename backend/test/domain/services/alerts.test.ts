import { test } from 'node:test'
import * as assert from 'node:assert'
import { evaluateAlerts } from '../../../src/domain/services/alerts'
import { Measurement } from '../../../src/domain/entities/Measurement'

function makeMeasurement(type: string, value: number): Measurement {
  return {
    id: 'm1',
    deviceId: 'd1',
    type,
    value,
    unit: null,
    timestamp: new Date(),
    receivedAt: new Date(),
    messageId: null
  }
}

test('raises an above_max alert when the value exceeds the threshold', () => {
  const alerts = evaluateAlerts(makeMeasurement('temperature', 30), [{ type: 'temperature', max: 25 }])
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0].reason, 'above_max')
})

test('raises a below_min alert when the value is under the threshold', () => {
  const alerts = evaluateAlerts(makeMeasurement('temperature', 5), [{ type: 'temperature', min: 10 }])
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0].reason, 'below_min')
})

test('raises no alert when there is no matching threshold', () => {
  const alerts = evaluateAlerts(makeMeasurement('humidity', 50), [{ type: 'temperature', max: 25 }])
  assert.equal(alerts.length, 0)
})

test('raises no alert when the value is within bounds', () => {
  const alerts = evaluateAlerts(makeMeasurement('temperature', 20), [{ type: 'temperature', min: 10, max: 25 }])
  assert.equal(alerts.length, 0)
})
