import { test } from 'node:test'
import * as assert from 'node:assert'
import { CommandService } from '../../../src/domain/services/CommandService'
import { CommandTimeoutService } from '../../../src/domain/services/CommandTimeoutService'
import { InMemoryDeviceRepository, InMemoryCommandRepository } from '../../fakes/inMemoryRepositories'
import { FixedClock, FakeLogger, FakeMqttPublisher } from '../../fakes/testDoubles'

// ACK timeout 10 s, grâce 5 s : TIMEOUT déclaré strictement après created + 15 s.
async function setup() {
  const devices = new InMemoryDeviceRepository()
  const device = await devices.create({ name: 'Sensor 1', type: 'temperature', roomId: 'room-1' })
  const commands = new InMemoryCommandRepository()
  const publisher = new FakeMqttPublisher()
  const clock = new FixedClock(new Date('2024-01-01T00:00:00Z'))
  const logger = new FakeLogger()
  const service = new CommandService(commands, devices, publisher, clock, logger, 10_000)
  const timeouts = new CommandTimeoutService(commands, clock, logger, 5_000)
  return { device, commands, publisher, clock, logger, service, timeouts }
}

test('a SENT command without ACK is not timed out before expiresAt + grace', async () => {
  const { device, commands, clock, service, timeouts } = await setup()
  const command = await service.dispatch({ deviceId: device.id, type: 'set_ventilation', params: { on: true } })

  clock.advance(14_000)
  assert.equal(await timeouts.expireOverdue(), 0)
  assert.equal((await commands.findById(command.id))?.status, 'SENT')
})

test('a SENT command without ACK goes to TIMEOUT once expiresAt + grace is passed, and it is logged', async () => {
  const { device, commands, clock, logger, service, timeouts } = await setup()
  const command = await service.dispatch({ deviceId: device.id, type: 'set_ventilation', params: { on: true } })

  clock.advance(15_001)
  assert.equal(await timeouts.expireOverdue(), 1)

  const stored = await commands.findById(command.id)
  assert.equal(stored?.status, 'TIMEOUT')
  assert.deepStrictEqual(stored?.timedOutAt, new Date('2024-01-01T00:00:15.001Z'))
  const entry = logger.entries.find((e) => e.msg === 'command timed out')
  assert.equal(entry?.meta?.commandId, command.id)
  assert.equal(entry?.meta?.reason, 'no_ack')
})

test('a PENDING command (publication unconfirmed) also times out, with a distinct reason', async () => {
  const { device, publisher, clock, logger, service, timeouts } = await setup()
  publisher.nextOutcome = 'unconfirmed'
  const command = await service.dispatch({ deviceId: device.id, type: 'set_ventilation', params: { on: true } })

  clock.advance(16_000)
  await timeouts.expireOverdue()

  const entry = logger.entries.find((e) => e.msg === 'command timed out' && e.meta?.commandId === command.id)
  assert.equal(entry?.meta?.reason, 'no_ack_publish_unconfirmed')
})

test('already acknowledged or failed commands are never timed out', async () => {
  const { device, commands, clock, service, timeouts } = await setup()
  const acked = await service.dispatch({ deviceId: device.id, type: 'set_ventilation', params: { on: true } })
  await service.acknowledge({ commandId: acked.id, deviceId: device.id, status: 'executed', reason: null, state: null, ackedAt: new Date() })

  clock.advance(60_000)
  assert.equal(await timeouts.expireOverdue(), 0)
  assert.equal((await commands.findById(acked.id))?.status, 'ACKNOWLEDGED')
})

test('when the ACK wins the race between the read and the transition, the timeout gives up', async () => {
  const { device, commands, clock, service, timeouts } = await setup()
  const command = await service.dispatch({ deviceId: device.id, type: 'set_ventilation', params: { on: true } })
  clock.advance(16_000)

  // Simule l'ingester qui traite l'ACK juste après la lecture des commandes échues par le worker.
  const originalFind = commands.findOpenExpiredBefore.bind(commands)
  commands.findOpenExpiredBefore = async (cutoff, limit) => {
    const found = await originalFind(cutoff, limit)
    await service.acknowledge({ commandId: command.id, deviceId: device.id, status: 'executed', reason: null, state: null, ackedAt: new Date() })
    return found
  }

  assert.equal(await timeouts.expireOverdue(), 0)
  assert.equal((await commands.findById(command.id))?.status, 'ACKNOWLEDGED')
})
