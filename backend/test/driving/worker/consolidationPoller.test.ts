import { test } from 'node:test'
import * as assert from 'node:assert'
import { startConsolidationPolling, ConsolidationPollerDeps } from '../../../src/driving/worker/consolidationPoller'
import { MeasurementIngestionService } from '../../../src/domain/services/MeasurementIngestionService'
import { NotFoundError } from '../../../src/shared/errors'
import { createMqttTopics } from '../../../src/shared/mqttTopics'
import { InMemoryMeasurementRepository } from '../../fakes/inMemoryRepositories'
import { FakeCheckpointRepository, FakeDeadLetterRepository, FakeLogger, FakeRawEventRepository } from '../../fakes/testDoubles'
import { NewMeasurement } from '../../../src/domain/entities/Measurement'

const topics = createMqttTopics('campus')

function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function telemetry(deviceId: string, messageId: string, minute: number, metrics: Record<string, number> = { temperature: 21 }): { topic: string; payload: string; qos: number; retain: boolean; receivedAt: Date } {
  const body: Record<string, unknown> = {
    schema_version: 1,
    message_id: messageId,
    device_id: deviceId,
    room_id: 'salle-203',
    observed_at: new Date(Date.UTC(2024, 0, 1, 0, minute)).toISOString()
  }
  for (const [type, value] of Object.entries(metrics)) body[type] = { value, unit: type === 'co2' ? 'ppm' : '°C' }
  return { topic: `campus/v1/devices/${deviceId}/telemetry`, payload: JSON.stringify(body), qos: 1, retain: false, receivedAt: new Date(Date.now() - 60_000 + minute) }
}

class FlakyMeasurements extends InMemoryMeasurementRepository {
  down = false
  failFor: { deviceId: string; error: Error } | null = null

  async findLatestByDevice(deviceId: string, type?: string) {
    if (this.down) throw new Error('postgres unavailable')
    return super.findLatestByDevice(deviceId, type)
  }

  async create(input: NewMeasurement) {
    if (this.down) throw new Error('postgres unavailable')
    if (this.failFor && this.failFor.deviceId === input.deviceId) throw this.failFor.error
    return super.create(input)
  }
}

function setup(overrides: Partial<ConsolidationPollerDeps> = {}) {
  const measurements = new FlakyMeasurements()
  const rawEvents = new FakeRawEventRepository()
  const checkpoints = new FakeCheckpointRepository()
  const deadLetters = new FakeDeadLetterRepository()
  const logger = new FakeLogger()
  const ingestion = new MeasurementIngestionService(measurements, logger, [], [{ type: 'temperature', min: -40, max: 85 }])
  const deps: ConsolidationPollerDeps = {
    topics,
    ingestion,
    rawEvents,
    checkpoints,
    deadLetters,
    logger,
    consumer: 'test-worker',
    intervalMs: 20,
    batchSize: 10,
    settleMs: 0,
    ...overrides
  }
  return { measurements, rawEvents, checkpoints, deadLetters, logger, deps }
}

test('decodes raw events and writes every metric to the verified store on the first (immediate) tick', async () => {
  const { measurements, rawEvents, checkpoints, deps } = setup()
  await rawEvents.record(telemetry('d1', 'm-1', 0, { temperature: 21, co2: 800 }))
  await rawEvents.record(telemetry('d1', 'm-2', 1, { temperature: 22 }))

  const stop = startConsolidationPolling(deps)
  try {
    await waitFor(20)
    assert.equal(measurements.measurements.length, 3)
    assert.deepEqual(checkpoints.cursors.get('test-worker')?.id, rawEvents.events[1].id)
  } finally {
    stop()
  }
})

test('never consolidates the same event twice: the cursor moves past it', async () => {
  const { measurements, rawEvents, deps } = setup()
  await rawEvents.record(telemetry('d1', 'm-1', 0))

  const stop = startConsolidationPolling(deps)
  try {
    await waitFor(100)
    assert.equal(measurements.measurements.length, 1)
  } finally {
    stop()
  }
})

test('resumes from the stored checkpoint after a restart instead of reprocessing the whole journal', async () => {
  const { measurements, rawEvents, checkpoints, deps } = setup()
  const first = await rawEvents.record(telemetry('d1', 'm-1', 0))
  await rawEvents.record(telemetry('d1', 'm-2', 1))
  await checkpoints.save('test-worker', { receivedAt: first.receivedAt, id: first.id })

  const stop = startConsolidationPolling(deps)
  try {
    await waitFor(20)
    assert.deepEqual(measurements.measurements.map((m) => m.messageId), ['m-2'])
  } finally {
    stop()
  }
})

test('dead-letters unreadable events with their reason and keeps going: one bad message never blocks the queue', async () => {
  const { measurements, rawEvents, deadLetters, logger, deps } = setup()
  await rawEvents.record({ ...telemetry('d1', 'x', 0), payload: 'not json {{' })
  await rawEvents.record({ ...telemetry('d1', 'x', 1), payload: JSON.stringify({ hello: 'world' }) })
  await rawEvents.record({ ...telemetry('d1', 'x', 2), topic: 'campus/other/thing' })
  await rawEvents.record(telemetry('d1', 'm-ok', 3))

  const stop = startConsolidationPolling(deps)
  try {
    await waitFor(20)
    assert.deepEqual(deadLetters.deadLetters.map((d) => d.reason), ['invalid_json', 'invalid_schema', 'unrecognized_topic'])
    assert.equal(deadLetters.deadLetters[0].event.payload, 'not json {{')
    assert.deepEqual(measurements.measurements.map((m) => m.messageId), ['m-ok'])
    assert.ok(logger.entries.some((e) => e.meta?.reason === 'invalid_json' && e.meta?.status === 'rejected'))
  } finally {
    stop()
  }
})

test('dead-letters an event rejected for good by the domain (unknown device) and continues', async () => {
  const { measurements, rawEvents, deadLetters, deps } = setup()
  measurements.failFor = { deviceId: 'ghost', error: new NotFoundError('unknown device ghost') }
  await rawEvents.record(telemetry('ghost', 'm-ghost', 0))
  await rawEvents.record(telemetry('d1', 'm-1', 1))

  const stop = startConsolidationPolling(deps)
  try {
    await waitFor(20)
    assert.equal(deadLetters.deadLetters.length, 1)
    assert.equal(deadLetters.deadLetters[0].reason, 'permanent_failure')
    assert.deepEqual(measurements.measurements.map((m) => m.messageId), ['m-1'])
  } finally {
    stop()
  }
})

test('a verified-store outage loses nothing: the cursor stays before the failing event and the backlog is processed after recovery', async () => {
  const { measurements, rawEvents, deadLetters, logger, deps } = setup()
  for (let i = 0; i < 3; i++) await rawEvents.record(telemetry('d1', `m-${i}`, i, { temperature: 20 + i }))
  measurements.down = true

  const stop = startConsolidationPolling(deps)
  try {
    await waitFor(80)
    assert.equal(measurements.measurements.length, 0)
    assert.equal(deadLetters.deadLetters.length, 0)
    assert.ok(logger.entries.some((e) => e.level === 'error' && e.msg === 'consolidation polling tick failed'))

    measurements.down = false
    await waitFor(80)
    assert.deepEqual(measurements.measurements.map((m) => m.messageId), ['m-0', 'm-1', 'm-2'])
  } finally {
    stop()
  }
})

test('does not read events younger than the settle delay (concurrent inserts may not be visible yet)', async () => {
  const { measurements, rawEvents, deps } = setup({ settleMs: 60_000 })
  await rawEvents.record({ ...telemetry('d1', 'm-1', 0), receivedAt: new Date() })

  const stop = startConsolidationPolling(deps)
  try {
    await waitFor(60)
    assert.equal(measurements.measurements.length, 0)
  } finally {
    stop()
  }
})

test('chains full batches without waiting for the polling interval', async () => {
  const { measurements, rawEvents, deps } = setup({ batchSize: 2, intervalMs: 60_000 })
  for (let i = 0; i < 5; i++) await rawEvents.record(telemetry('d1', `m-${i}`, i, { temperature: 20 + i }))

  const stop = startConsolidationPolling(deps)
  try {
    await waitFor(40)
    assert.equal(measurements.measurements.length, 5)
  } finally {
    stop()
  }
})

test('reports the remaining lag after a pass when events are still pending', async () => {
  const { rawEvents, logger, deps } = setup({ settleMs: 0 })
  await rawEvents.record(telemetry('d1', 'm-1', 0))

  const stop = startConsolidationPolling(deps)
  try {
    await waitFor(20)
    const progress = logger.entries.find((e) => e.meta?.eventType === 'consolidation_lag')
    assert.equal(progress?.meta?.processed, 1)
    assert.equal(progress?.meta?.pending, 0)
  } finally {
    stop()
  }
})

test('stop() cancels polling: an event recorded afterwards is never consolidated', async () => {
  const { measurements, rawEvents, deps } = setup()

  const stop = startConsolidationPolling(deps)
  await waitFor(5)
  stop()

  await rawEvents.record(telemetry('d1', 'm-1', 0))
  await waitFor(60)

  assert.equal(measurements.measurements.length, 0)
})
