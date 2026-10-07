import { test } from 'node:test'
import * as assert from 'node:assert'
import { createMeasurementHandler, createCommandAckHandler } from '../../../src/driving/mqtt/handlers'
import { createMqttTopics } from '../../../src/shared/mqttTopics'
import { CommandService } from '../../../src/domain/services/CommandService'
import { InMemoryDeviceRepository, InMemoryCommandRepository } from '../../fakes/inMemoryRepositories'
import { FixedClock, FakeLogger, FakeMqttPublisher, FakeRawEventRepository } from '../../fakes/testDoubles'

const topics = createMqttTopics('campus')

// Depuis l'ADR 0013, le handler de mesures ne fait que journaliser le message
// tel que reçu : parsing, validation, dédup et plausibilité sont le rôle du
// worker (testé dans test/driving/worker et measurementIngestionService.test.ts).

test('measurement handler stores the message exactly as received, without interpreting it', async () => {
  const rawEvents = new FakeRawEventRepository()
  const logger = new FakeLogger()
  const handler = createMeasurementHandler({ rawEvents, logger })
  const payload = JSON.stringify({ schema_version: 1, message_id: 'abc-1', temperature: { value: 21.7, unit: '°C' } })

  await handler('campus/v1/devices/sensor-001/telemetry', Buffer.from(payload), { qos: 1, retain: false })

  assert.equal(rawEvents.events.length, 1)
  assert.deepEqual(
    { topic: rawEvents.events[0].topic, payload: rawEvents.events[0].payload, qos: rawEvents.events[0].qos, retain: rawEvents.events[0].retain },
    { topic: 'campus/v1/devices/sensor-001/telemetry', payload, qos: 1, retain: false }
  )
})

test('measurement handler also stores a payload that is not valid JSON (nothing is filtered at ingestion)', async () => {
  const rawEvents = new FakeRawEventRepository()
  const logger = new FakeLogger()
  const handler = createMeasurementHandler({ rawEvents, logger })

  await handler('campus/v1/devices/sensor-001/telemetry', 'not json {{')

  assert.equal(rawEvents.events.length, 1)
  assert.equal(rawEvents.events[0].payload, 'not json {{')
  assert.equal(logger.entries.length, 0)
})

test('measurement handler stores an exact retransmission (same message_id) twice, unfiltered', async () => {
  const rawEvents = new FakeRawEventRepository()
  const handler = createMeasurementHandler({ rawEvents, logger: new FakeLogger() })
  const payload = JSON.stringify({ message_id: 'retransmit-1' })

  await handler('campus/v1/devices/sensor-001/telemetry', payload)
  await handler('campus/v1/devices/sensor-001/telemetry', payload)

  assert.equal(rawEvents.events.length, 2)
})

test('measurement handler logs an error and does not throw when the raw store is unavailable', async () => {
  const rawEvents = new FakeRawEventRepository()
  rawEvents.failNext = true
  const logger = new FakeLogger()
  const handler = createMeasurementHandler({ rawEvents, logger })

  await handler('campus/v1/devices/sensor-001/telemetry', '{}')

  assert.equal(rawEvents.events.length, 0)
  const entry = logger.entries.find((e) => e.msg === 'failed to record raw event')
  assert.equal(entry?.level, 'error')
  assert.equal(entry?.meta?.topic, 'campus/v1/devices/sensor-001/telemetry')
})

test('command ack handler acknowledges the command via the domain service', async () => {
  const devices = new InMemoryDeviceRepository()
  const device = await devices.create({ name: 'Sensor 1', type: 'temperature', roomId: 'room-1' })
  const commands = new InMemoryCommandRepository()
  const publisher = new FakeMqttPublisher()
  const clock = new FixedClock(new Date('2024-01-01T00:00:00Z'))
  const commandService = new CommandService(commands, devices, publisher, clock)
  const command = await commandService.dispatch({ deviceId: device.id, type: 'reboot' })

  const logger = new FakeLogger()
  const handler = createCommandAckHandler({ commandService, logger })
  const topic = topics.commandTopic(device.id) + '/ack'

  await handler(topic, JSON.stringify({ commandId: command.id, acknowledgedAt: '2024-01-01T00:05:00.000Z' }))

  const stored = await commands.findById(command.id)
  assert.equal(stored?.status, 'ACKED')
})
