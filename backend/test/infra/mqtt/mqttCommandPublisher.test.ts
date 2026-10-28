import { test } from 'node:test'
import * as assert from 'node:assert'
import { MqttCommandPublisher } from '../../../src/infra/mqtt/MqttCommandPublisher'
import { createMqttTopics } from '../../../src/shared/mqttTopics'
import type { MqttClient } from 'mqtt'

class FakePublishClient {
  readonly calls: Array<{ topic: string; payload: string; opts: unknown }> = []
  connected = true
  failNext = false
  /** Simule un broker qui ne renvoie jamais de PUBACK. */
  neverAck = false

  publish(topic: string, payload: string, opts: unknown, cb: (err?: Error) => void): void {
    this.calls.push({ topic, payload, opts })
    if (this.neverAck) return
    cb(this.failNext ? new Error('publish failed') : undefined)
  }
}

const topics = createMqttTopics('campus')

test('publishCommand publishes a well-formed message to the device command topic', async () => {
  const client = new FakePublishClient()
  const publisher = new MqttCommandPublisher(client as unknown as MqttClient, topics)

  const outcome = await publisher.publishCommand({
    commandId: 'command-1',
    deviceId: 'device-1',
    type: 'set_ventilation',
    params: { on: true },
    createdAt: new Date('2024-01-01T00:00:00Z'),
    expiresAt: new Date('2024-01-01T00:00:15Z')
  })

  assert.equal(outcome, 'confirmed')
  assert.equal(client.calls.length, 1)
  assert.equal(client.calls[0].topic, 'campus/v1/devices/device-1/commands')
  assert.deepEqual(client.calls[0].opts, { qos: 1 })
  assert.deepEqual(JSON.parse(client.calls[0].payload), {
    schema_version: 1,
    command_id: 'command-1',
    device_id: 'device-1',
    type: 'set_ventilation',
    params: { on: true },
    created_at: '2024-01-01T00:00:00.000Z',
    expires_at: '2024-01-01T00:00:15.000Z'
  })
})

const message = {
  commandId: 'command-1',
  deviceId: 'device-1',
  type: 'set_ventilation',
  params: { on: true },
  createdAt: new Date(),
  expiresAt: new Date()
}

test('publishCommand returns not_sent and publishes nothing when the client is disconnected', async () => {
  const client = new FakePublishClient()
  client.connected = false
  const publisher = new MqttCommandPublisher(client as unknown as MqttClient, topics)

  assert.equal(await publisher.publishCommand(message), 'not_sent')
  assert.equal(client.calls.length, 0)
})

test('publishCommand returns unconfirmed when the client reports an error', async () => {
  const client = new FakePublishClient()
  client.failNext = true
  const publisher = new MqttCommandPublisher(client as unknown as MqttClient, topics)

  assert.equal(await publisher.publishCommand(message), 'unconfirmed')
})

test('publishCommand returns unconfirmed when the broker never sends PUBACK in time', async () => {
  const client = new FakePublishClient()
  client.neverAck = true
  const publisher = new MqttCommandPublisher(client as unknown as MqttClient, topics, 20)

  assert.equal(await publisher.publishCommand(message), 'unconfirmed')
  assert.equal(client.calls.length, 1)
})
