import { test } from 'node:test'
import * as assert from 'node:assert'
import { isPlausibleValue, PlausibilityRange } from '../../../src/domain/services/plausibility'

const ranges: PlausibilityRange[] = [
  { type: 'temperature', min: -40, max: 85 },
  { type: 'co2', min: 0, max: 40000 }
]

test('accepts a value within the configured range for its type', () => {
  assert.equal(isPlausibleValue('temperature', 21, ranges), true)
})

test('rejects a value above the configured max', () => {
  assert.equal(isPlausibleValue('temperature', 9999, ranges), false)
})

test('rejects a value below the configured min', () => {
  assert.equal(isPlausibleValue('co2', -1, ranges), false)
})

test('accepts a value at the exact bounds', () => {
  assert.equal(isPlausibleValue('temperature', -40, ranges), true)
  assert.equal(isPlausibleValue('temperature', 85, ranges), true)
})

test('rejects NaN and Infinity regardless of configured ranges', () => {
  assert.equal(isPlausibleValue('temperature', NaN, ranges), false)
  assert.equal(isPlausibleValue('temperature', Infinity, ranges), false)
  assert.equal(isPlausibleValue('temperature', -Infinity, ranges), false)
})

test('accepts any finite value for a type without a configured range', () => {
  assert.equal(isPlausibleValue('humidity', 1e9, ranges), true)
})

test('rejects a non-finite value even for a type without a configured range', () => {
  assert.equal(isPlausibleValue('humidity', NaN, ranges), false)
})
