import { test } from 'node:test'
import * as assert from 'node:assert'
import { MeasurementIngestionService } from '../../../src/domain/services/MeasurementIngestionService'
import { InMemoryDeviceRepository, InMemoryMeasurementRepository } from '../../fakes/inMemoryRepositories'
import { FakeLogger, FakeRawMeasurementRepository } from '../../fakes/testDoubles'

test('ingests the first measurement and makes it the device latest received measurement', async () => {
  const devices = new InMemoryDeviceRepository()
  const device = await devices.create({ name: 'Sensor 1', type: 'temperature', roomId: 'room-1' })
  const measurements = new InMemoryMeasurementRepository()
  const rawMeasurements = new FakeRawMeasurementRepository()
  const logger = new FakeLogger()

  const service = new MeasurementIngestionService(measurements, rawMeasurements, logger)
  const result = await service.ingest({ deviceId: device.id, type: 'temperature', value: 21, timestamp: new Date('2024-01-01T00:00:00Z') })

  assert.equal(result.accepted, true)
  assert.equal(measurements.measurements.length, 1)
  const lastReceivedAt = await measurements.findLatestReceivedAt(device.id)
  assert.deepStrictEqual(lastReceivedAt, result.measurement?.receivedAt)
})

test('rejects a duplicate measurement and logs a warning', async () => {
  const devices = new InMemoryDeviceRepository()
  const device = await devices.create({ name: 'Sensor 1', type: 'temperature', roomId: 'room-1' })
  const measurements = new InMemoryMeasurementRepository()
  const rawMeasurements = new FakeRawMeasurementRepository()
  const logger = new FakeLogger()
  const service = new MeasurementIngestionService(measurements, rawMeasurements, logger)

  const timestamp = new Date('2024-01-01T00:00:00Z')
  await service.ingest({ deviceId: device.id, type: 'temperature', value: 21, timestamp })
  const result = await service.ingest({ deviceId: device.id, type: 'temperature', value: 21, timestamp })

  assert.deepStrictEqual(result, { accepted: false, reason: 'duplicate' })
  assert.equal(measurements.measurements.length, 1)
  assert.ok(logger.entries.some((e) => e.level === 'warn' && e.msg === 'measurement rejected'))
})

test('logs a threshold alert when a measurement exceeds its bounds', async () => {
  const devices = new InMemoryDeviceRepository()
  const device = await devices.create({ name: 'Sensor 1', type: 'temperature', roomId: 'room-1' })
  const measurements = new InMemoryMeasurementRepository()
  const rawMeasurements = new FakeRawMeasurementRepository()
  const logger = new FakeLogger()
  const service = new MeasurementIngestionService(measurements, rawMeasurements, logger, [{ type: 'temperature', max: 25 }])

  await service.ingest({ deviceId: device.id, type: 'temperature', value: 30, timestamp: new Date('2024-01-01T00:00:00Z') })

  assert.ok(logger.entries.some((e) => e.level === 'warn' && e.msg === 'threshold alert'))
})

test('records every measurement in the raw store, including one rejected as duplicate', async () => {
  const devices = new InMemoryDeviceRepository()
  const device = await devices.create({ name: 'Sensor 1', type: 'temperature', roomId: 'room-1' })
  const measurements = new InMemoryMeasurementRepository()
  const rawMeasurements = new FakeRawMeasurementRepository()
  const logger = new FakeLogger()
  const service = new MeasurementIngestionService(measurements, rawMeasurements, logger)

  const timestamp = new Date('2024-01-01T00:00:00Z')
  await service.ingest({ deviceId: device.id, type: 'temperature', value: 21, timestamp })
  await service.ingest({ deviceId: device.id, type: 'temperature', value: 21, timestamp })

  // La base vérifiée n'a qu'une mesure (le doublon a été rejeté), mais la
  // base brute a bien enregistré les deux tentatives, sans filtre.
  assert.equal(measurements.measurements.length, 1)
  assert.equal(rawMeasurements.recorded.length, 2)
})

test('rejects ingestion when the raw store fails to write (verified store depends on raw)', async () => {
  const devices = new InMemoryDeviceRepository()
  const device = await devices.create({ name: 'Sensor 1', type: 'temperature', roomId: 'room-1' })
  const measurements = new InMemoryMeasurementRepository()
  const rawMeasurements = new FakeRawMeasurementRepository()
  rawMeasurements.failNext = true
  const logger = new FakeLogger()
  const service = new MeasurementIngestionService(measurements, rawMeasurements, logger)

  const result = await service.ingest({ deviceId: device.id, type: 'temperature', value: 21, timestamp: new Date('2024-01-01T00:00:00Z') })

  assert.deepStrictEqual(result, { accepted: false, reason: 'raw_unavailable' })
  assert.equal(measurements.measurements.length, 0)
  assert.ok(logger.entries.some((e) => e.level === 'warn' && e.msg === 'failed to record raw measurement'))
})

test('rejects ingestion when the raw store cannot be read back after writing', async () => {
  const devices = new InMemoryDeviceRepository()
  const device = await devices.create({ name: 'Sensor 1', type: 'temperature', roomId: 'room-1' })
  const measurements = new InMemoryMeasurementRepository()
  const rawMeasurements = new FakeRawMeasurementRepository()
  rawMeasurements.vanishOnReadBack = true
  const logger = new FakeLogger()
  const service = new MeasurementIngestionService(measurements, rawMeasurements, logger)

  const result = await service.ingest({ deviceId: device.id, type: 'temperature', value: 21, timestamp: new Date('2024-01-01T00:00:00Z') })

  assert.deepStrictEqual(result, { accepted: false, reason: 'raw_unavailable' })
  assert.equal(measurements.measurements.length, 0)
  assert.ok(logger.entries.some((e) => e.level === 'warn' && e.msg === 'raw measurement not found on read-back'))
})

test('rejects an implausible value but still records it in the raw store', async () => {
  const devices = new InMemoryDeviceRepository()
  const device = await devices.create({ name: 'Sensor 1', type: 'temperature', roomId: 'room-1' })
  const measurements = new InMemoryMeasurementRepository()
  const rawMeasurements = new FakeRawMeasurementRepository()
  const logger = new FakeLogger()
  const service = new MeasurementIngestionService(measurements, rawMeasurements, logger, [], [{ type: 'temperature', min: -40, max: 85 }])

  const result = await service.ingest({ deviceId: device.id, type: 'temperature', value: 999, timestamp: new Date('2024-01-01T00:00:00Z') })

  assert.deepStrictEqual(result, { accepted: false, reason: 'implausible_value' })
  assert.equal(measurements.measurements.length, 0)
  assert.equal(rawMeasurements.recorded.length, 1)
  assert.ok(logger.entries.some((e) => e.level === 'warn' && e.msg === 'measurement rejected' && e.meta?.reason === 'implausible_value'))
})

test('does not let an implausible value overwrite the current latest measurement', async () => {
  const devices = new InMemoryDeviceRepository()
  const device = await devices.create({ name: 'Sensor 1', type: 'temperature', roomId: 'room-1' })
  const measurements = new InMemoryMeasurementRepository()
  const rawMeasurements = new FakeRawMeasurementRepository()
  const logger = new FakeLogger()
  const service = new MeasurementIngestionService(measurements, rawMeasurements, logger, [], [{ type: 'temperature', min: -40, max: 85 }])

  await service.ingest({ deviceId: device.id, type: 'temperature', value: 21, timestamp: new Date('2024-01-01T00:00:00Z') })
  await service.ingest({ deviceId: device.id, type: 'temperature', value: 999, timestamp: new Date('2024-01-01T00:01:00Z') })

  const latest = await measurements.findLatestByDevice(device.id, 'temperature')
  assert.equal(latest?.value, 21)
})

test('the verified measurement reflects what was read back from the raw store, not the original input', async () => {
  const devices = new InMemoryDeviceRepository()
  const device = await devices.create({ name: 'Sensor 1', type: 'temperature', roomId: 'room-1' })
  const measurements = new InMemoryMeasurementRepository()
  const rawMeasurements = new FakeRawMeasurementRepository()
  const logger = new FakeLogger()
  const service = new MeasurementIngestionService(measurements, rawMeasurements, logger)

  const result = await service.ingest({ deviceId: device.id, type: 'temperature', value: 21, unit: '°C', timestamp: new Date('2024-01-01T00:00:00Z'), messageId: 'msg-1' })

  assert.equal(result.accepted, true)
  assert.equal(rawMeasurements.recorded.length, 1)
  assert.equal(result.measurement?.value, rawMeasurements.recorded[0].value)
  assert.equal(result.measurement?.messageId, rawMeasurements.recorded[0].messageId)
})
