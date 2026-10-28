import { test } from 'node:test'
import * as assert from 'node:assert'
import { decideAlertTransition, AlertThreshold } from '../../../src/domain/services/alerts'
import { Alert, AlertReason } from '../../../src/domain/entities/Alert'

const co2: AlertThreshold = { type: 'co2', max: 1000, hysteresis: 100 }
const temperature: AlertThreshold = { type: 'temperature', min: 16, max: 28, hysteresis: 1 }

function openAlert(reason: AlertReason, threshold: number): Alert {
  const at = new Date('2024-01-01T00:00:00Z')
  return {
    id: 'a1',
    deviceId: 'd1',
    measurementType: 'co2',
    reason,
    threshold,
    triggerValue: threshold,
    openedAt: at,
    openedEventId: null,
    lastValue: threshold,
    lastSeenAt: at,
    resolvedAt: null,
    resolvedValue: null,
    resolvedEventId: null
  }
}

test('does nothing when there is no open alert and the value is within bounds', () => {
  assert.deepStrictEqual(decideAlertTransition(null, 800, co2), { kind: 'none' })
})

test('opens an above_max alert when the value exceeds the max', () => {
  assert.deepStrictEqual(decideAlertTransition(null, 1001, co2), { kind: 'open', reason: 'above_max', threshold: 1000 })
})

test('opens a below_min alert when the value is under the min', () => {
  assert.deepStrictEqual(decideAlertTransition(null, 15, temperature), { kind: 'open', reason: 'below_min', threshold: 16 })
})

test('does not open on a value exactly at the threshold', () => {
  assert.deepStrictEqual(decideAlertTransition(null, 1000, co2), { kind: 'none' })
})

test('keeps the open alert ongoing while the value stays out of bounds', () => {
  assert.deepStrictEqual(decideAlertTransition(openAlert('above_max', 1000), 1500, co2), { kind: 'ongoing' })
})

test('keeps the alert ongoing inside the hysteresis band', () => {
  // Repassée sous le seuil mais pas sous la marge : pas encore normale.
  assert.deepStrictEqual(decideAlertTransition(openAlert('above_max', 1000), 950, co2), { kind: 'ongoing' })
})

test('resolves an above_max alert once the value is back under max - hysteresis', () => {
  assert.deepStrictEqual(decideAlertTransition(openAlert('above_max', 1000), 900, co2), { kind: 'resolve' })
})

test('resolves a below_min alert once the value is back over min + hysteresis', () => {
  assert.deepStrictEqual(decideAlertTransition(openAlert('below_min', 16), 16.5, temperature), { kind: 'ongoing' })
  assert.deepStrictEqual(decideAlertTransition(openAlert('below_min', 16), 17, temperature), { kind: 'resolve' })
})

test('resolves and reopens when the value jumps to the opposite threshold', () => {
  assert.deepStrictEqual(decideAlertTransition(openAlert('below_min', 16), 30, temperature), {
    kind: 'resolve',
    reopen: { reason: 'above_max', threshold: 28 }
  })
})

test('an oscillation around the threshold never produces more than one transition', () => {
  let open: Alert | null = null
  const transitions: string[] = []
  for (const value of [999, 1001, 999, 1001, 980, 1010, 950]) {
    const t = decideAlertTransition(open, value, co2)
    transitions.push(t.kind)
    if (t.kind === 'open') open = openAlert(t.reason, t.threshold)
    if (t.kind === 'resolve') open = null
  }
  assert.deepStrictEqual(transitions, ['none', 'open', 'ongoing', 'ongoing', 'ongoing', 'ongoing', 'ongoing'])
})
