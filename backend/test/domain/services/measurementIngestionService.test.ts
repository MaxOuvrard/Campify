import { test } from 'node:test'
import * as assert from 'node:assert'
import { MeasurementIngestionService } from '../../../src/domain/services/MeasurementIngestionService'
import { InMemoryDeviceRepository, InMemoryMeasurementRepository } from '../../fakes/inMemoryRepositories'
import { FixedClock, FakeLogger } from '../../fakes/testDoubles'

test('ingests the first measurement and refreshes the device', async () => {
  const devices = new InMemoryDeviceRepository()
  const device = await devices.create({ name: 'Sensor 1', type: 'temperature', roomId: 'room-1' })
  const measurements = new InMemoryMeasurementRepository()
  const clock = new FixedClock(new Date('2024-01-01T00:00:00Z'))
  const logger = new FakeLogger()

  const service = new MeasurementIngestionService(measurements, devices, clock, logger)
  const result = await service.ingest({ deviceId: device.id, type: 'temperature', value: 21, timestamp: new Date('2024-01-01T00:00:00Z') })

  assert.equal(result.accepted, true)
  assert.equal(measurements.measurements.length, 1)
  const updated = await devices.findById(device.id)
  assert.deepStrictEqual(updated?.lastSeenAt, clock.now())
})

test('rejects a duplicate measurement and logs a warning', async () => {
  const devices = new InMemoryDeviceRepository()
  const device = await devices.create({ name: 'Sensor 1', type: 'temperature', roomId: 'room-1' })
  const measurements = new InMemoryMeasurementRepository()
  const clock = new FixedClock(new Date('2024-01-01T00:00:00Z'))
  const logger = new FakeLogger()
  const service = new MeasurementIngestionService(measurements, devices, clock, logger)

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
  const clock = new FixedClock(new Date('2024-01-01T00:00:00Z'))
  const logger = new FakeLogger()
  const service = new MeasurementIngestionService(measurements, devices, clock, logger, [{ type: 'temperature', max: 25 }])

  await service.ingest({ deviceId: device.id, type: 'temperature', value: 30, timestamp: new Date('2024-01-01T00:00:00Z') })

  assert.ok(logger.entries.some((e) => e.level === 'warn' && e.msg === 'threshold alert'))
})
