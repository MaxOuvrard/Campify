import { test } from 'node:test'
import * as assert from 'node:assert'
import { createMeasurementHandler, createCommandAckHandler } from '../../../src/driving/mqtt/handlers'
import { createMqttTopics } from '../../../src/shared/mqttTopics'
import { MeasurementIngestionService } from '../../../src/domain/services/MeasurementIngestionService'
import { CommandService } from '../../../src/domain/services/CommandService'
import { InMemoryDeviceRepository, InMemoryMeasurementRepository, InMemoryCommandRepository } from '../../fakes/inMemoryRepositories'
import { FixedClock, FakeLogger, FakeMqttPublisher } from '../../fakes/testDoubles'
import type { MeasurementRepository } from '../../../src/domain/ports/MeasurementRepository'

const topics = createMqttTopics('campus')

test('measurement handler validates, ingests and persists every metric of a well-formed telemetry message', async () => {
  const devices = new InMemoryDeviceRepository()
  const device = await devices.create({ name: 'Sensor 1', type: 'temperature', roomId: 'room-1' })
  const measurements = new InMemoryMeasurementRepository()
  const logger = new FakeLogger()
  const ingestion = new MeasurementIngestionService(measurements, devices, new FixedClock(new Date()), logger)

  const handler = createMeasurementHandler({ topics, ingestion, logger })
  const topic = `campus/v1/devices/${device.id}/telemetry`
  const payload = JSON.stringify({
    schema_version: 1,
    message_id: 'abc-1',
    device_id: device.id,
    room_id: 'salle-203',
    observed_at: '2024-01-01T00:00:00.000Z',
    temperature: { value: 21.7, unit: '°C' },
    co2: { value: 2500, unit: 'ppm' }
  })

  await handler(topic, payload)

  assert.equal(measurements.measurements.length, 2)
  assert.deepEqual(
    measurements.measurements.map((m) => m.type).sort(),
    ['co2', 'temperature']
  )
  assert.ok(measurements.measurements.every((m) => m.deviceId === device.id))
})

test('measurement handler logs and drops an invalid payload', async () => {
  const devices = new InMemoryDeviceRepository()
  const device = await devices.create({ name: 'Sensor 1', type: 'temperature', roomId: 'room-1' })
  const measurements = new InMemoryMeasurementRepository()
  const logger = new FakeLogger()
  const ingestion = new MeasurementIngestionService(measurements, devices, new FixedClock(new Date()), logger)

  const handler = createMeasurementHandler({ topics, ingestion, logger })
  const topic = `campus/v1/devices/${device.id}/telemetry`

  await handler(topic, 'not json')
  await handler(topic, JSON.stringify({ schema_version: 1, message_id: 'abc-1', device_id: device.id }))

  assert.equal(measurements.measurements.length, 0)
  assert.equal(logger.entries.filter((e) => e.level === 'warn').length, 2)
})

test('measurement handler logs a warning and keeps processing when ingestion throws (e.g. device not registered)', async () => {
  const devices = new InMemoryDeviceRepository()
  const device = await devices.create({ name: 'Sensor 1', type: 'temperature', roomId: 'room-1' })
  const logger = new FakeLogger()
  const throwingMeasurements: MeasurementRepository = {
    findLatestByDevice: async () => null,
    create: async () => {
      throw new Error('Foreign key constraint violated')
    },
    findByDeviceInRange: async () => [],
    findLatestByDeviceGroupedByType: async () => []
  }
  const ingestion = new MeasurementIngestionService(throwingMeasurements, devices, new FixedClock(new Date()), logger)

  const handler = createMeasurementHandler({ topics, ingestion, logger })
  const topic = `campus/v1/devices/${device.id}/telemetry`
  const payload = JSON.stringify({
    schema_version: 1,
    message_id: 'abc-2',
    device_id: device.id,
    room_id: 'salle-203',
    observed_at: '2024-01-01T00:00:00.000Z',
    temperature: { value: 21.7, unit: '°C' }
  })

  await assert.doesNotReject(handler(topic, payload))
  assert.ok(logger.entries.some((e) => e.level === 'warn' && e.msg === 'failed to ingest measurement'))
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
