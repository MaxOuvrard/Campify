import { test } from 'node:test'
import * as assert from 'node:assert'
import { createMeasurementHandler, createCommandAckHandler } from '../../../src/driving/mqtt/handlers'
import { createMqttTopics } from '../../../src/shared/mqttTopics'
import { MeasurementIngestionService } from '../../../src/domain/services/MeasurementIngestionService'
import { CommandService } from '../../../src/domain/services/CommandService'
import { InMemoryDeviceRepository, InMemoryMeasurementRepository, InMemoryCommandRepository } from '../../fakes/inMemoryRepositories'
import { FixedClock, FakeLogger, FakeMqttPublisher, FakeRawMeasurementRepository } from '../../fakes/testDoubles'

const topics = createMqttTopics('campus')

// Depuis l'ADR 0011, le handler MQTT n'appelle plus que `recordRaw()` — il
// écrit en base brute et s'arrête là. Le dédup/plausibilité/écriture en
// base vérifiée est désormais le rôle du worker de consolidation (testé
// séparément dans measurementIngestionService.test.ts, via `consolidate()`)
// et n'a donc plus sa place dans les tests du handler lui-même.

test('measurement handler validates and records every metric of a well-formed telemetry message in the raw store', async () => {
  const devices = new InMemoryDeviceRepository()
  const device = await devices.create({ name: 'Sensor 1', type: 'temperature', roomId: 'room-1' })
  const measurements = new InMemoryMeasurementRepository()
  const rawMeasurements = new FakeRawMeasurementRepository()
  const logger = new FakeLogger()
  const ingestion = new MeasurementIngestionService(measurements, rawMeasurements, logger)

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

  // Rien en base vérifiée : seule l'écriture brute se fait dans le handler,
  // la consolidation n'a pas encore eu lieu.
  assert.equal(measurements.measurements.length, 0)
  assert.equal(rawMeasurements.recorded.length, 2)
  assert.deepEqual(
    rawMeasurements.recorded.map((r) => r.type).sort(),
    ['co2', 'temperature']
  )
  assert.ok(rawMeasurements.recorded.every((r) => r.deviceId === device.id))
  assert.ok(rawMeasurements.recorded.every((r) => r.messageId === 'abc-1'))
  assert.ok(rawMeasurements.recorded.every((r) => r.consolidatedAt === null))
})

test('measurement handler records an exact MQTT retransmission (same message_id) twice in the raw store, unfiltered', async () => {
  const devices = new InMemoryDeviceRepository()
  const device = await devices.create({ name: 'Sensor 1', type: 'temperature', roomId: 'room-1' })
  const measurements = new InMemoryMeasurementRepository()
  const rawMeasurements = new FakeRawMeasurementRepository()
  const logger = new FakeLogger()
  const ingestion = new MeasurementIngestionService(measurements, rawMeasurements, logger)

  const handler = createMeasurementHandler({ topics, ingestion, logger })
  const topic = `campus/v1/devices/${device.id}/telemetry`
  const payload = JSON.stringify({
    schema_version: 1,
    message_id: 'retransmit-1',
    device_id: device.id,
    room_id: 'salle-203',
    observed_at: '2024-01-01T00:00:00.000Z',
    temperature: { value: 21.7, unit: '°C' }
  })

  await handler(topic, payload)
  await handler(topic, payload)

  // La base brute trace tout, y compris les retransmissions — voir ADR 0005.
  // Le filtrage du doublon n'intervient qu'à la consolidation, pas ici.
  assert.equal(measurements.measurements.length, 0)
  assert.equal(rawMeasurements.recorded.length, 2)
})

test('measurement handler logs and drops an invalid payload before any raw write', async () => {
  const devices = new InMemoryDeviceRepository()
  const device = await devices.create({ name: 'Sensor 1', type: 'temperature', roomId: 'room-1' })
  const measurements = new InMemoryMeasurementRepository()
  const rawMeasurements = new FakeRawMeasurementRepository()
  const logger = new FakeLogger()
  const ingestion = new MeasurementIngestionService(measurements, rawMeasurements, logger)

  const handler = createMeasurementHandler({ topics, ingestion, logger })
  const topic = `campus/v1/devices/${device.id}/telemetry`

  await handler(topic, 'not json')
  await handler(topic, JSON.stringify({ schema_version: 1, message_id: 'abc-1', device_id: device.id }))

  assert.equal(rawMeasurements.recorded.length, 0)
  assert.equal(measurements.measurements.length, 0)
  assert.equal(logger.entries.filter((e) => e.level === 'warn').length, 2)
})

test('measurement handler logs a warning and keeps processing when the raw store throws', async () => {
  const devices = new InMemoryDeviceRepository()
  const device = await devices.create({ name: 'Sensor 1', type: 'temperature', roomId: 'room-1' })
  const measurements = new InMemoryMeasurementRepository()
  const logger = new FakeLogger()
  const rawMeasurements = new FakeRawMeasurementRepository()
  const ingestion = new MeasurementIngestionService(measurements, rawMeasurements, logger)

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

  // recordRaw() journalise déjà et avale les échecs d'écriture brute (voir
  // MeasurementIngestionService) — ce test vérifie juste que le handler ne
  // plante jamais, quel que soit le motif de l'échec en amont.
  rawMeasurements.failNext = true
  await assert.doesNotReject(handler(topic, payload))
  assert.ok(logger.entries.some((e) => e.level === 'warn' && e.msg === 'failed to record raw measurement'))
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
