import { test } from 'node:test'
import * as assert from 'node:assert'
import { MeasurementIngestionService } from '../../../src/domain/services/MeasurementIngestionService'
import { InMemoryDeviceRepository, InMemoryMeasurementRepository } from '../../fakes/inMemoryRepositories'
import { FakeLogger } from '../../fakes/testDoubles'

test('ingests the first measurement and makes it the device latest received measurement', async () => {
  const devices = new InMemoryDeviceRepository()
  const device = await devices.create({ name: 'Sensor 1', type: 'temperature', roomId: 'room-1' })
  const measurements = new InMemoryMeasurementRepository()
  const logger = new FakeLogger()

  const service = new MeasurementIngestionService(measurements, logger)
  const result = await service.consolidate({ deviceId: device.id, type: 'temperature', value: 21, timestamp: new Date('2024-01-01T00:00:00Z') })

  assert.equal(result.accepted, true)
  assert.equal(measurements.measurements.length, 1)
  const lastReceivedAt = await measurements.findLatestReceivedAt(device.id)
  assert.deepStrictEqual(lastReceivedAt, result.measurement?.receivedAt)
})

test('logs a successful ingestion with the MQTT messageId as correlation eventId', async () => {
  const devices = new InMemoryDeviceRepository()
  const device = await devices.create({ name: 'Sensor 1', type: 'temperature', roomId: 'room-1' })
  const measurements = new InMemoryMeasurementRepository()
  const logger = new FakeLogger()
  const service = new MeasurementIngestionService(measurements, logger)

  await service.consolidate({ deviceId: device.id, type: 'temperature', value: 21, timestamp: new Date('2024-01-01T00:00:00Z'), messageId: 'msg-42' })

  const entry = logger.entries.find((e) => e.level === 'info' && e.msg === 'measurement ingested')
  assert.ok(entry)
  assert.equal(entry?.meta?.eventType, 'measurement_ingestion')
  assert.equal(entry?.meta?.eventId, 'msg-42')
  assert.equal(entry?.meta?.status, 'ingested')
})

test('falls back to a placeholder eventId when no messageId is provided', async () => {
  const devices = new InMemoryDeviceRepository()
  const device = await devices.create({ name: 'Sensor 1', type: 'temperature', roomId: 'room-1' })
  const measurements = new InMemoryMeasurementRepository()
  const logger = new FakeLogger()
  const service = new MeasurementIngestionService(measurements, logger, [], [{ type: 'temperature', min: -40, max: 85 }])

  await service.consolidate({ deviceId: device.id, type: 'temperature', value: 999, timestamp: new Date('2024-01-01T00:00:00Z') })

  const entry = logger.entries.find((e) => e.level === 'warn' && e.msg === 'measurement rejected')
  assert.ok(entry)
  assert.equal(typeof entry?.meta?.eventId, 'string')
  assert.ok((entry?.meta?.eventId as string).length > 0)
})

test('rejects a duplicate measurement and logs a warning', async () => {
  const devices = new InMemoryDeviceRepository()
  const device = await devices.create({ name: 'Sensor 1', type: 'temperature', roomId: 'room-1' })
  const measurements = new InMemoryMeasurementRepository()
  const logger = new FakeLogger()
  const service = new MeasurementIngestionService(measurements, logger)

  const timestamp = new Date('2024-01-01T00:00:00Z')
  await service.consolidate({ deviceId: device.id, type: 'temperature', value: 21, timestamp })
  const result = await service.consolidate({ deviceId: device.id, type: 'temperature', value: 21, timestamp })

  assert.deepStrictEqual(result, { accepted: false, reason: 'duplicate' })
  assert.equal(measurements.measurements.length, 1)
  assert.ok(logger.entries.some((e) => e.level === 'warn' && e.msg === 'measurement rejected'))
})

test('logs a threshold alert when a measurement exceeds its bounds', async () => {
  const devices = new InMemoryDeviceRepository()
  const device = await devices.create({ name: 'Sensor 1', type: 'temperature', roomId: 'room-1' })
  const measurements = new InMemoryMeasurementRepository()
  const logger = new FakeLogger()
  const service = new MeasurementIngestionService(measurements, logger, [{ type: 'temperature', max: 25 }])

  await service.consolidate({ deviceId: device.id, type: 'temperature', value: 30, timestamp: new Date('2024-01-01T00:00:00Z') })

  assert.ok(logger.entries.some((e) => e.level === 'warn' && e.msg === 'threshold alert'))
})

test('rejects an implausible value', async () => {
  const devices = new InMemoryDeviceRepository()
  const device = await devices.create({ name: 'Sensor 1', type: 'temperature', roomId: 'room-1' })
  const measurements = new InMemoryMeasurementRepository()
  const logger = new FakeLogger()
  const service = new MeasurementIngestionService(measurements, logger, [], [{ type: 'temperature', min: -40, max: 85 }])

  const result = await service.consolidate({ deviceId: device.id, type: 'temperature', value: 999, timestamp: new Date('2024-01-01T00:00:00Z') })

  assert.deepStrictEqual(result, { accepted: false, reason: 'implausible_value' })
  assert.equal(measurements.measurements.length, 0)
  assert.ok(logger.entries.some((e) => e.level === 'warn' && e.msg === 'measurement rejected' && e.meta?.reason === 'implausible_value'))
})

test('does not let an implausible value overwrite the current latest measurement', async () => {
  const devices = new InMemoryDeviceRepository()
  const device = await devices.create({ name: 'Sensor 1', type: 'temperature', roomId: 'room-1' })
  const measurements = new InMemoryMeasurementRepository()
  const logger = new FakeLogger()
  const service = new MeasurementIngestionService(measurements, logger, [], [{ type: 'temperature', min: -40, max: 85 }])

  await service.consolidate({ deviceId: device.id, type: 'temperature', value: 21, timestamp: new Date('2024-01-01T00:00:00Z') })
  await service.consolidate({ deviceId: device.id, type: 'temperature', value: 999, timestamp: new Date('2024-01-01T00:01:00Z') })

  const latest = await measurements.findLatestByDevice(device.id, 'temperature')
  assert.equal(latest?.value, 21)
})

