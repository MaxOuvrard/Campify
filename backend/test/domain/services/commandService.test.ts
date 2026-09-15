import { test } from 'node:test'
import * as assert from 'node:assert'
import { CommandService } from '../../../src/domain/services/CommandService'
import { NotFoundError } from '../../../src/shared/errors'
import { InMemoryDeviceRepository, InMemoryCommandRepository } from '../../fakes/inMemoryRepositories'
import { FixedClock, FakeMqttPublisher } from '../../fakes/testDoubles'

test('dispatch publishes the command via the MqttPublisher port and marks it as SENT', async () => {
  const devices = new InMemoryDeviceRepository()
  const device = await devices.create({ name: 'Sensor 1', type: 'temperature', roomId: 'room-1' })
  const commands = new InMemoryCommandRepository()
  const publisher = new FakeMqttPublisher()
  const clock = new FixedClock(new Date('2024-01-01T00:00:00Z'))
  const service = new CommandService(commands, devices, publisher, clock)

  const command = await service.dispatch({ deviceId: device.id, type: 'reboot' })

  assert.equal(publisher.published.length, 1)
  assert.equal(publisher.published[0].commandId, command.id)
  assert.equal(publisher.published[0].type, 'reboot')

  const stored = await commands.findById(command.id)
  assert.equal(stored?.status, 'SENT')
})

test('dispatch throws NotFoundError when the device does not exist', async () => {
  const devices = new InMemoryDeviceRepository()
  const commands = new InMemoryCommandRepository()
  const publisher = new FakeMqttPublisher()
  const clock = new FixedClock(new Date())
  const service = new CommandService(commands, devices, publisher, clock)

  await assert.rejects(() => service.dispatch({ deviceId: 'missing-device', type: 'reboot' }), NotFoundError)
})

test('acknowledge marks a command as ACKED', async () => {
  const devices = new InMemoryDeviceRepository()
  const device = await devices.create({ name: 'Sensor 1', type: 'temperature', roomId: 'room-1' })
  const commands = new InMemoryCommandRepository()
  const publisher = new FakeMqttPublisher()
  const clock = new FixedClock(new Date('2024-01-01T00:00:00Z'))
  const service = new CommandService(commands, devices, publisher, clock)

  const command = await service.dispatch({ deviceId: device.id, type: 'reboot' })
  const ackAt = new Date('2024-01-01T00:05:00Z')
  await service.acknowledge(command.id, ackAt)

  const stored = await commands.findById(command.id)
  assert.equal(stored?.status, 'ACKED')
  assert.deepStrictEqual(stored?.ackedAt, ackAt)
})
