import { test } from 'node:test'
import * as assert from 'node:assert'
import { CommandService } from '../../../src/domain/services/CommandService'
import { CommandAck } from '../../../src/domain/entities/Command'
import { ForbiddenError, NotFoundError, ValidationError } from '../../../src/shared/errors'
import { InMemoryDeviceRepository, InMemoryCommandRepository } from '../../fakes/inMemoryRepositories'
import { FixedClock, FakeLogger, FakeMqttPublisher } from '../../fakes/testDoubles'

async function setup(ackTimeoutMs = 15_000) {
  const devices = new InMemoryDeviceRepository()
  const device = await devices.create({ name: 'Sensor 1', type: 'temperature', roomId: 'room-1' })
  const commands = new InMemoryCommandRepository()
  const publisher = new FakeMqttPublisher()
  const clock = new FixedClock(new Date('2024-01-01T00:00:00Z'))
  const logger = new FakeLogger()
  const service = new CommandService(commands, devices, publisher, clock, logger, ackTimeoutMs)
  return { devices, device, commands, publisher, clock, logger, service }
}

function ack(commandId: string, deviceId: string, overrides: Partial<CommandAck> = {}): CommandAck {
  return { commandId, deviceId, status: 'executed', reason: null, state: { ventilation: 'on' }, ackedAt: new Date('2024-01-01T00:00:01Z'), ...overrides }
}

// --- Émission -------------------------------------------------------------

test('dispatch publishes the command via the MqttPublisher port and marks it as SENT', async () => {
  const { device, commands, publisher, service } = await setup()

  const command = await service.dispatch({ deviceId: device.id, type: 'set_ventilation', params: { on: true } })

  assert.equal(command.status, 'SENT')
  assert.equal(publisher.published.length, 1)
  assert.equal(publisher.published[0].commandId, command.id)
  assert.equal(publisher.published[0].type, 'set_ventilation')
  assert.deepEqual(publisher.published[0].params, { on: true })
  assert.equal((await commands.findById(command.id))?.status, 'SENT')
})

test('dispatch sets expiresAt to now + ack timeout and sends it to the device', async () => {
  const { device, publisher, service } = await setup(10_000)

  const command = await service.dispatch({ deviceId: device.id, type: 'set_ventilation', params: { on: false } })

  assert.deepStrictEqual(command.expiresAt, new Date('2024-01-01T00:00:10Z'))
  assert.deepStrictEqual(publisher.published[0].expiresAt, new Date('2024-01-01T00:00:10Z'))
})

test('dispatch marks the command FAILED (broker_unavailable) when nothing could be sent', async () => {
  const { device, publisher, logger, service } = await setup()
  publisher.nextOutcome = 'not_sent'

  const command = await service.dispatch({ deviceId: device.id, type: 'set_ventilation', params: { on: true } })

  assert.equal(command.status, 'FAILED')
  assert.equal(command.failureReason, 'broker_unavailable')
  assert.ok(logger.entries.some((e) => e.meta?.commandId === command.id && e.meta?.reason === 'broker_unavailable'))
})

test('dispatch leaves the command PENDING when the publication is unconfirmed (it may still be delivered)', async () => {
  const { device, publisher, logger, service } = await setup()
  publisher.nextOutcome = 'unconfirmed'

  const command = await service.dispatch({ deviceId: device.id, type: 'set_ventilation', params: { on: true } })

  assert.equal(command.status, 'PENDING')
  assert.ok(logger.entries.some((e) => e.meta?.commandId === command.id && e.meta?.reason === 'publish_unconfirmed'))
})

test('an ACK may still conclude a PENDING command whose publication was unconfirmed', async () => {
  const { device, publisher, service, commands } = await setup()
  publisher.nextOutcome = 'unconfirmed'
  const command = await service.dispatch({ deviceId: device.id, type: 'set_ventilation', params: { on: true } })

  assert.equal(await service.acknowledge(ack(command.id, device.id)), 'acknowledged')
  assert.equal((await commands.findById(command.id))?.status, 'ACKNOWLEDGED')
})

test('dispatch never moves an already acknowledged command back to SENT (ACK faster than the PUBACK)', async () => {
  const { device, publisher, service } = await setup()
  publisher.onPublish = async (message) => {
    await service.acknowledge(ack(message.commandId, device.id))
  }

  const command = await service.dispatch({ deviceId: device.id, type: 'set_ventilation', params: { on: true } })

  assert.equal(command.status, 'ACKNOWLEDGED')
})

test('dispatch throws NotFoundError when the device does not exist', async () => {
  const { service } = await setup()

  await assert.rejects(() => service.dispatch({ deviceId: 'missing-device', type: 'set_ventilation', params: { on: true } }), NotFoundError)
})

test('dispatch rejects an unsupported command type before persisting or publishing anything', async () => {
  const { device, publisher, service } = await setup()

  await assert.rejects(() => service.dispatch({ deviceId: device.id, type: 'reboot', params: {} }), ValidationError)
  assert.equal(publisher.published.length, 0)
})

test('dispatch rejects invalid params for a supported command type', async () => {
  const { device, publisher, service } = await setup()

  await assert.rejects(() => service.dispatch({ deviceId: device.id, type: 'set_ventilation', params: { on: 'yes' } }), ValidationError)
  await assert.rejects(() => service.dispatch({ deviceId: device.id, type: 'set_target_temperature', params: { value: 99 } }), ValidationError)
  assert.equal(publisher.published.length, 0)
})

// --- Acquittement ---------------------------------------------------------

test('acknowledge with status executed marks the command as ACKNOWLEDGED and keeps the reported state', async () => {
  const { device, commands, service } = await setup()
  const command = await service.dispatch({ deviceId: device.id, type: 'set_ventilation', params: { on: true } })

  const outcome = await service.acknowledge(ack(command.id, device.id))

  assert.equal(outcome, 'acknowledged')
  const stored = await commands.findById(command.id)
  assert.equal(stored?.status, 'ACKNOWLEDGED')
  assert.deepStrictEqual(stored?.ackedAt, new Date('2024-01-01T00:00:01Z'))
  assert.deepEqual(stored?.reportedState, { ventilation: 'on' })
})

test('acknowledge with status rejected marks the command as FAILED with the device reason', async () => {
  const { device, commands, service } = await setup()
  const command = await service.dispatch({ deviceId: device.id, type: 'set_ventilation', params: { on: true } })

  const outcome = await service.acknowledge(ack(command.id, device.id, { status: 'rejected', reason: 'fan_jammed', state: null }))

  assert.equal(outcome, 'failed')
  const stored = await commands.findById(command.id)
  assert.equal(stored?.status, 'FAILED')
  assert.equal(stored?.failureReason, 'rejected_by_device: fan_jammed')
})

test('acknowledge with status expired marks the command as FAILED (not executed by the device)', async () => {
  const { device, commands, service } = await setup()
  const command = await service.dispatch({ deviceId: device.id, type: 'set_ventilation', params: { on: true } })

  await service.acknowledge(ack(command.id, device.id, { status: 'expired', state: null }))

  const stored = await commands.findById(command.id)
  assert.equal(stored?.status, 'FAILED')
  assert.equal(stored?.failureReason, 'expired_on_device')
})

test('a late ACK after TIMEOUT keeps the TIMEOUT status but records what the device finally answered', async () => {
  const { device, commands, logger, service } = await setup()
  const command = await service.dispatch({ deviceId: device.id, type: 'set_ventilation', params: { on: true } })
  await commands.transition(command.id, ['SENT'], { status: 'TIMEOUT', timedOutAt: new Date('2024-01-01T00:00:20Z') })

  const lateAt = new Date('2024-01-01T00:00:22Z')
  const outcome = await service.acknowledge(ack(command.id, device.id, { ackedAt: lateAt }))

  assert.equal(outcome, 'late_ack')
  const stored = await commands.findById(command.id)
  assert.equal(stored?.status, 'TIMEOUT')
  assert.deepStrictEqual(stored?.lateAck, { status: 'executed', at: lateAt })
  assert.deepEqual(stored?.reportedState, { ventilation: 'on' })
  assert.ok(logger.entries.some((e) => e.meta?.commandId === command.id && e.meta?.reason === 'late_ack'))
})

test('a second ACK on an already acknowledged command has no effect (duplicate_ack)', async () => {
  const { device, commands, logger, service } = await setup()
  const command = await service.dispatch({ deviceId: device.id, type: 'set_ventilation', params: { on: true } })
  await service.acknowledge(ack(command.id, device.id))

  const outcome = await service.acknowledge(ack(command.id, device.id, { status: 'rejected', reason: 'whatever', ackedAt: new Date('2024-01-01T00:00:05Z') }))

  assert.equal(outcome, 'duplicate_ack')
  const stored = await commands.findById(command.id)
  assert.equal(stored?.status, 'ACKNOWLEDGED')
  assert.deepStrictEqual(stored?.ackedAt, new Date('2024-01-01T00:00:01Z'))
  assert.ok(logger.entries.some((e) => e.meta?.commandId === command.id && e.meta?.reason === 'duplicate_ack'))
})

test('acknowledge refuses an ack coming from another device than the command target', async () => {
  const { device, commands, service } = await setup()
  const command = await service.dispatch({ deviceId: device.id, type: 'set_ventilation', params: { on: true } })

  await assert.rejects(() => service.acknowledge(ack(command.id, 'other-device')), ForbiddenError)
  assert.equal((await commands.findById(command.id))?.status, 'SENT')
})

test('acknowledge throws NotFoundError for an unknown command id', async () => {
  const { device, service } = await setup()

  await assert.rejects(() => service.acknowledge(ack('missing', device.id)), NotFoundError)
})
