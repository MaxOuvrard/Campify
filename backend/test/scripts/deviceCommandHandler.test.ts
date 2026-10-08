import { test } from 'node:test'
import * as assert from 'node:assert'
import { DeviceCommandHandler, DeviceState } from '../../scripts/device/commandHandler'

const NOW = new Date('2026-10-08T10:00:05Z')

function command(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema_version: 1,
    command_id: 'cmd-1',
    device_id: 'sensor-001',
    type: 'set_ventilation',
    params: { on: true },
    created_at: '2026-10-08T10:00:00.000Z',
    expires_at: '2026-10-08T10:00:15.000Z',
    ...overrides
  })
}

function setup(mode: 'normal' | 'silent' | 'reject' = 'normal') {
  const state: DeviceState = { ventilation: 'off', target_temperature: null }
  let now = NOW
  const handler = new DeviceCommandHandler(state, mode, () => now)
  return { state, handler, setNow: (d: Date) => (now = d) }
}

test('executes set_ventilation, then acks "executed" with the same command_id and the resulting state', () => {
  const { state, handler } = setup()

  const result = handler.handle(command())

  assert.equal(result.kind, 'executed')
  assert.equal(state.ventilation, 'on')
  if (result.kind !== 'executed') return
  assert.equal(result.ack.command_id, 'cmd-1')
  assert.equal(result.ack.status, 'executed')
  assert.deepEqual(result.ack.state, { ventilation: 'on', target_temperature: null })
  assert.equal(result.ack.acked_at, NOW.toISOString())
})

test('executes set_target_temperature', () => {
  const { state, handler } = setup()

  const result = handler.handle(command({ type: 'set_target_temperature', params: { value: 21.5 } }))

  assert.equal(result.kind, 'executed')
  assert.equal(state.target_temperature, 21.5)
})

test('a command received twice is executed only once and the SAME ack is returned', () => {
  const { state, handler } = setup()
  const first = handler.handle(command())
  state.ventilation = 'off' // si la commande était réexécutée, l'état repasserait à "on"

  const second = handler.handle(command())

  assert.equal(second.kind, 'duplicate')
  assert.equal(state.ventilation, 'off')
  if (first.kind !== 'executed' || second.kind !== 'duplicate') return
  assert.deepStrictEqual(second.ack, first.ack)
})

test('a command received after expires_at is NOT executed and is acked "expired"', () => {
  const { state, handler, setNow } = setup()
  setNow(new Date('2026-10-08T10:00:16Z'))

  const result = handler.handle(command())

  assert.equal(result.kind, 'expired')
  assert.equal(state.ventilation, 'off')
  if (result.kind !== 'expired') return
  assert.equal(result.ack.status, 'expired')
  assert.equal(result.ack.reason, 'received_after_expires_at')
})

test('an unknown command type is acked "rejected" without touching the state', () => {
  const { state, handler } = setup()

  const result = handler.handle(command({ type: 'toggle_ventilation', params: {} }))

  assert.equal(result.kind, 'rejected')
  assert.deepEqual(state, { ventilation: 'off', target_temperature: null })
  if (result.kind !== 'rejected') return
  assert.equal(result.ack.reason, 'unsupported_command')
})

test('invalid params are acked "rejected"', () => {
  const { handler } = setup()

  const result = handler.handle(command({ params: { on: 'yes' } }))

  assert.equal(result.kind, 'rejected')
})

test('reject mode refuses every command', () => {
  const { state, handler } = setup('reject')

  const result = handler.handle(command())

  assert.equal(result.kind, 'rejected')
  assert.equal(state.ventilation, 'off')
})

test('silent mode receives the command but neither executes nor acks it', () => {
  const { state, handler } = setup('silent')

  const result = handler.handle(command())

  assert.equal(result.kind, 'ignored')
  assert.equal(state.ventilation, 'off')
})

test('an unreadable command is ignored (no reliable command_id to answer to)', () => {
  const { handler } = setup()

  assert.deepEqual(handler.handle('not json'), { kind: 'invalid', reason: 'invalid_json' })
  assert.deepEqual(handler.handle(JSON.stringify({ commandId: 'x' })), { kind: 'invalid', reason: 'invalid_schema' })
})

test('processed command ids are forgotten once well past their expiry (bounded memory)', () => {
  const { handler, setNow } = setup()
  handler.handle(command())

  setNow(new Date('2026-10-08T10:05:00Z'))
  const replay = handler.handle(command())

  // Oubliée : la commande n'est pas réexécutée pour autant, elle est expirée.
  assert.equal(replay.kind, 'expired')
})
