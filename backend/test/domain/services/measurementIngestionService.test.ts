import { test } from 'node:test'
import * as assert from 'node:assert'
import { MeasurementIngestionService } from '../../../src/domain/services/MeasurementIngestionService'
import { InMemoryAlertRepository, InMemoryDeviceRepository, InMemoryMeasurementRepository } from '../../fakes/inMemoryRepositories'
import { AlertService } from '../../../src/domain/services/AlertService'
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
  const service = new MeasurementIngestionService(measurements, logger, null, [{ type: 'temperature', min: -40, max: 85 }])

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

test('opens a single alert for repeated out-of-threshold measurements', async () => {
  const devices = new InMemoryDeviceRepository()
  const device = await devices.create({ name: 'Sensor 1', type: 'co2', roomId: 'room-1' })
  const measurements = new InMemoryMeasurementRepository()
  const alerts = new InMemoryAlertRepository()
  const logger = new FakeLogger()
  const alerting = new AlertService(alerts, logger, [{ type: 'co2', max: 1000, hysteresis: 100 }])
  const service = new MeasurementIngestionService(measurements, logger, alerting)

  for (let i = 0; i < 10; i++) {
    await service.consolidate({ deviceId: device.id, type: 'co2', value: 1200 + i, timestamp: new Date(Date.UTC(2024, 0, 1, 0, i)), messageId: `msg-${i}` })
  }

  assert.equal(alerts.alerts.length, 1)
  assert.equal(alerts.alerts[0].lastValue, 1209)
  assert.equal(logger.entries.filter((e) => e.msg === 'alert opened').length, 1)
})

test('a duplicate or late measurement never touches the alert state', async () => {
  const devices = new InMemoryDeviceRepository()
  const device = await devices.create({ name: 'Sensor 1', type: 'co2', roomId: 'room-1' })
  const measurements = new InMemoryMeasurementRepository()
  const alerts = new InMemoryAlertRepository()
  const logger = new FakeLogger()
  const alerting = new AlertService(alerts, logger, [{ type: 'co2', max: 1000, hysteresis: 100 }])
  const service = new MeasurementIngestionService(measurements, logger, alerting)

  await service.consolidate({ deviceId: device.id, type: 'co2', value: 1200, timestamp: new Date('2024-01-01T00:10:00Z'), messageId: 'msg-1' })
  // Retard : une vieille valeur normale ne doit pas résoudre l'alerte.
  await service.consolidate({ deviceId: device.id, type: 'co2', value: 500, timestamp: new Date('2024-01-01T00:05:00Z'), messageId: 'msg-0' })
  // Doublon : retransmission QoS 1 de la mesure d'ouverture.
  await service.consolidate({ deviceId: device.id, type: 'co2', value: 1200, timestamp: new Date('2024-01-01T00:10:00Z'), messageId: 'msg-1' })

  assert.equal(alerts.alerts.length, 1)
  assert.equal(alerts.alerts[0].resolvedAt, null)
})

test('rejects an implausible value', async () => {
  const devices = new InMemoryDeviceRepository()
  const device = await devices.create({ name: 'Sensor 1', type: 'temperature', roomId: 'room-1' })
  const measurements = new InMemoryMeasurementRepository()
  const logger = new FakeLogger()
  const service = new MeasurementIngestionService(measurements, logger, null, [{ type: 'temperature', min: -40, max: 85 }])

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
  const service = new MeasurementIngestionService(measurements, logger, null, [{ type: 'temperature', min: -40, max: 85 }])

  await service.consolidate({ deviceId: device.id, type: 'temperature', value: 21, timestamp: new Date('2024-01-01T00:00:00Z') })
  await service.consolidate({ deviceId: device.id, type: 'temperature', value: 999, timestamp: new Date('2024-01-01T00:01:00Z') })

  const latest = await measurements.findLatestByDevice(device.id, 'temperature')
  assert.equal(latest?.value, 21)
})

