import { test } from 'node:test'
import * as assert from 'node:assert'
import { startConsolidationPolling } from '../../../src/driving/worker/consolidationPoller'
import { MeasurementIngestionService } from '../../../src/domain/services/MeasurementIngestionService'
import { InMemoryDeviceRepository, InMemoryMeasurementRepository } from '../../fakes/inMemoryRepositories'
import { FakeLogger, FakeRawMeasurementRepository } from '../../fakes/testDoubles'

function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

class ThrowingRawMeasurementRepository extends FakeRawMeasurementRepository {
  async findUnconsolidated(): Promise<never> {
    throw new Error('db down')
  }
}

test('consolidation poller picks up pending raw rows on its first (immediate) tick', async () => {
  const devices = new InMemoryDeviceRepository()
  const device = await devices.create({ name: 'Sensor 1', type: 'temperature', roomId: 'room-1' })
  const measurements = new InMemoryMeasurementRepository()
  const rawMeasurements = new FakeRawMeasurementRepository()
  const logger = new FakeLogger()
  const ingestion = new MeasurementIngestionService(measurements, rawMeasurements, logger)

  await rawMeasurements.record({ deviceId: device.id, type: 'temperature', value: 21, timestamp: new Date('2024-01-01T00:00:00Z') })
  await rawMeasurements.record({ deviceId: device.id, type: 'temperature', value: 22, timestamp: new Date('2024-01-01T00:01:00Z') })

  const stop = startConsolidationPolling({ ingestion, rawMeasurements, logger, intervalMs: 50, batchSize: 10 })
  try {
    await waitFor(20)
    assert.equal(measurements.measurements.length, 2)
    assert.equal((await rawMeasurements.findUnconsolidated(10)).length, 0)
  } finally {
    stop()
  }
})

test('consolidation poller logs and keeps running when a pass fails, without crashing', async () => {
  const measurements = new InMemoryMeasurementRepository()
  const rawMeasurements = new ThrowingRawMeasurementRepository()
  const logger = new FakeLogger()
  const ingestion = new MeasurementIngestionService(measurements, rawMeasurements, logger)

  const stop = startConsolidationPolling({ ingestion, rawMeasurements, logger, intervalMs: 20, batchSize: 10 })
  try {
    await waitFor(10)
    assert.ok(logger.entries.some((e) => e.level === 'error' && e.msg === 'consolidation polling tick failed'))
  } finally {
    stop()
  }
})

test('stop() cancels polling: a raw row recorded afterwards is never consolidated', async () => {
  const devices = new InMemoryDeviceRepository()
  const device = await devices.create({ name: 'Sensor 1', type: 'temperature', roomId: 'room-1' })
  const measurements = new InMemoryMeasurementRepository()
  const rawMeasurements = new FakeRawMeasurementRepository()
  const logger = new FakeLogger()
  const ingestion = new MeasurementIngestionService(measurements, rawMeasurements, logger)

  const stop = startConsolidationPolling({ ingestion, rawMeasurements, logger, intervalMs: 20, batchSize: 10 })
  await waitFor(5)
  stop()

  await rawMeasurements.record({ deviceId: device.id, type: 'temperature', value: 21, timestamp: new Date() })
  await waitFor(40)

  assert.equal(measurements.measurements.length, 0)
})
