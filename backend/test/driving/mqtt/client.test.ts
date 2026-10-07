import { test } from 'node:test'
import * as assert from 'node:assert'
import { EventEmitter } from 'node:events'
import { attachMqttSubscriptions } from '../../../src/driving/mqtt/client'
import { createMqttTopics } from '../../../src/shared/mqttTopics'
import { MeasurementIngestionService } from '../../../src/domain/services/MeasurementIngestionService'
import { CommandService } from '../../../src/domain/services/CommandService'
import { InMemoryDeviceRepository, InMemoryMeasurementRepository, InMemoryCommandRepository } from '../../fakes/inMemoryRepositories'
import { FixedClock, FakeLogger, FakeMqttPublisher, FakeRawMeasurementRepository } from '../../fakes/testDoubles'
import type { MqttClient } from 'mqtt'

class FakeMqttClient extends EventEmitter {
  readonly subscribeCalls: Array<{ topics: string[]; opts: unknown }> = []
  subscribeError: Error | undefined

  subscribe(topics: string[], opts: unknown, cb: (err?: Error) => void): void {
    this.subscribeCalls.push({ topics, opts })
    cb(this.subscribeError)
  }
}

function buildDeps(logger: FakeLogger, qos?: 0 | 1) {
  const devices = new InMemoryDeviceRepository()
  const measurements = new InMemoryMeasurementRepository()
  const rawMeasurements = new FakeRawMeasurementRepository()
  const ingestion = new MeasurementIngestionService(measurements, rawMeasurements, logger)
  const commands = new InMemoryCommandRepository()
  const publisher = new FakeMqttPublisher()
  const clock = new FixedClock(new Date('2024-01-01T00:00:00Z'))
  const commandService = new CommandService(commands, devices, publisher, clock)
  const topics = createMqttTopics('campus')
  return { topics, ingestion, commandService, logger, qos }
}

test('subscribes with the configured QoS and logs a connected status on connect', () => {
  const logger = new FakeLogger()
  const client = new FakeMqttClient()
  attachMqttSubscriptions(client as unknown as MqttClient, buildDeps(logger, 1))

  client.emit('connect', { sessionPresent: false })

  assert.equal(client.subscribeCalls.length, 1)
  assert.deepEqual(client.subscribeCalls[0].topics, ['campus/v1/devices/+/telemetry', 'campus/devices/+/commands/ack'])
  assert.deepEqual(client.subscribeCalls[0].opts, { qos: 1 })
  assert.ok(logger.entries.some((e) => e.level === 'info' && e.meta?.eventType === 'mqtt_connection' && e.meta?.status === 'connected'))
})

test('wraps subscription filters in $share/<group>/ when a shared group is configured, to split messages across several ingester instances', () => {
  const logger = new FakeLogger()
  const client = new FakeMqttClient()
  attachMqttSubscriptions(client as unknown as MqttClient, { ...buildDeps(logger, 1), sharedGroup: 'campify-ingesters' })

  client.emit('connect', { sessionPresent: false })

  assert.deepEqual(client.subscribeCalls[0].topics, [
    '$share/campify-ingesters/campus/v1/devices/+/telemetry',
    '$share/campify-ingesters/campus/devices/+/commands/ack'
  ])
})

test('still routes an incoming message to the right handler when subscribed via a shared group (real topic is never prefixed)', async () => {
  const logger = new FakeLogger()
  const client = new FakeMqttClient()
  const deps = { ...buildDeps(logger, 1), sharedGroup: 'campify-ingesters' }
  attachMqttSubscriptions(client as unknown as MqttClient, deps)
  client.emit('connect', { sessionPresent: false })

  const payload = JSON.stringify({
    schema_version: 1,
    message_id: 'shared-1',
    device_id: 'sensor-001',
    room_id: 'salle-203',
    observed_at: '2024-01-01T00:00:00.000Z',
    temperature: { value: 21, unit: '°C' }
  })
  client.emit('message', 'campus/v1/devices/sensor-001/telemetry', payload)
  await new Promise((resolve) => setImmediate(resolve))

  assert.ok(!logger.entries.some((e) => e.msg === 'mqtt message on unrecognized topic'))
})

test('defaults to QoS 0 when none is configured', () => {
  const logger = new FakeLogger()
  const client = new FakeMqttClient()
  attachMqttSubscriptions(client as unknown as MqttClient, buildDeps(logger))

  client.emit('connect', { sessionPresent: false })

  assert.deepEqual(client.subscribeCalls[0].opts, { qos: 0 })
})

test('logs an error when the subscribe call fails', () => {
  const logger = new FakeLogger()
  const client = new FakeMqttClient()
  client.subscribeError = new Error('not authorized')
  attachMqttSubscriptions(client as unknown as MqttClient, buildDeps(logger))

  client.emit('connect', { sessionPresent: false })

  assert.ok(logger.entries.some((e) => e.level === 'error' && e.meta?.status === 'subscribe_failed'))
})

test('logs a status for each connection lifecycle transition (broker down/up scenario)', () => {
  const logger = new FakeLogger()
  const client = new FakeMqttClient()
  attachMqttSubscriptions(client as unknown as MqttClient, buildDeps(logger))

  client.emit('offline')
  client.emit('close')
  client.emit('reconnect')
  client.emit('error', new Error('connection refused'))

  const statuses = logger.entries.map((e) => e.meta?.status)
  assert.ok(statuses.includes('offline'))
  assert.ok(statuses.includes('closed'))
  assert.ok(statuses.includes('reconnecting'))
  assert.ok(statuses.includes('error'))
  assert.ok(logger.entries.every((e) => e.meta?.eventType === 'mqtt_connection'))
})
