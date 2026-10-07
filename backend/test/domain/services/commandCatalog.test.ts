import { test } from 'node:test'
import * as assert from 'node:assert'
import { validateCommand } from '../../../src/domain/services/commandCatalog'
import { ValidationError } from '../../../src/shared/errors'

test('set_ventilation accepts a boolean "on" and drops unknown fields', () => {
  assert.deepEqual(validateCommand('set_ventilation', { on: true, extra: 'x' }), { on: true })
})

test('set_ventilation rejects a missing or non-boolean "on"', () => {
  assert.throws(() => validateCommand('set_ventilation', {}), ValidationError)
  assert.throws(() => validateCommand('set_ventilation', { on: 1 }), ValidationError)
})

test('set_target_temperature accepts a value within bounds', () => {
  assert.deepEqual(validateCommand('set_target_temperature', { value: 21.5 }), { value: 21.5 })
  assert.deepEqual(validateCommand('set_target_temperature', { value: 10 }), { value: 10 })
  assert.deepEqual(validateCommand('set_target_temperature', { value: 30 }), { value: 30 })
})

test('set_target_temperature rejects out-of-range or non-finite values', () => {
  assert.throws(() => validateCommand('set_target_temperature', { value: 9.9 }), ValidationError)
  assert.throws(() => validateCommand('set_target_temperature', { value: 31 }), ValidationError)
  assert.throws(() => validateCommand('set_target_temperature', { value: Number.NaN }), ValidationError)
  assert.throws(() => validateCommand('set_target_temperature', { value: '21' }), ValidationError)
})

test('an unknown command type is rejected', () => {
  assert.throws(() => validateCommand('reboot', {}), /Unsupported command type "reboot"/)
})

test('params must be an object', () => {
  assert.throws(() => validateCommand('set_ventilation', null), ValidationError)
  assert.throws(() => validateCommand('set_ventilation', [true]), ValidationError)
})
