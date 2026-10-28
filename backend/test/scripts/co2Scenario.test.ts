import { test } from 'node:test'
import * as assert from 'node:assert'
import { co2At, SPIKE_PHASES_MS } from '../../scripts/device/co2Scenario'
import { decideAlertTransition, AlertThreshold } from '../../src/domain/services/alerts'
import { Alert } from '../../src/domain/entities/Alert'

// Seuil CO2 réellement câblé dans composition.ts (ADR 0015).
const co2Threshold: AlertThreshold = { type: 'co2', max: 1000, hysteresis: 100 }

function replay(profile: 'calm' | 'spike', stepMs: number, jitter: (i: number) => number = () => 0): string[] {
  let open: Alert | null = null
  const transitions: string[] = []
  for (let t = 0, i = 0; t <= SPIKE_PHASES_MS.end + 30_000; t += stepMs, i++) {
    const value = co2At(profile, t, jitter(i))
    const transition = decideAlertTransition(open, value, co2Threshold)
    if (transition.kind === 'open') {
      transitions.push('open')
      open = { reason: transition.reason, threshold: transition.threshold } as Alert
    } else if (transition.kind === 'resolve') {
      transitions.push('resolve')
      open = null
    }
  }
  return transitions
}

test('the spike profile opens exactly one alert and resolves it once, at the kit cadence and under a 20x heavier flow', () => {
  assert.deepStrictEqual(replay('spike', 2000), ['open', 'resolve'])
  assert.deepStrictEqual(replay('spike', 100), ['open', 'resolve'])
})

test('noise never makes the spike flap: still one alert, one resolution', () => {
  // Bruit maximal alterné : le pire cas pour un battement autour du seuil.
  assert.deepStrictEqual(replay('spike', 100, (i) => (i % 2 === 0 ? 1 : -1)), ['open', 'resolve'])
})

test('the calm profile never raises an alert, noise included', () => {
  assert.deepStrictEqual(replay('calm', 100, (i) => (i % 2 === 0 ? 1 : -1)), [])
})

test('the spike stays between the two thresholds for a while on the way down (hysteresis visible)', () => {
  const between = []
  for (let t = SPIKE_PHASES_MS.rampDown; t < SPIKE_PHASES_MS.end; t += 1000) {
    const v = co2At('spike', t)
    if (v <= 1000 && v > 900) between.push(v)
  }
  assert.ok(between.length >= 5, `${between.length}s entre 900 et 1000 ppm`)
})
