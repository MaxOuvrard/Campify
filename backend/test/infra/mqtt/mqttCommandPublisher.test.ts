import { test } from 'node:test'
import * as assert from 'node:assert'
import { MqttCommandPublisher } from '../../../src/infra/mqtt/MqttCommandPublisher'
import { createMqttTopics } from '../../../src/shared/mqttTopics'
import type { MqttClient } from 'mqtt'

class FakePublishClient {
  readonly calls: Array<{ topic: string; payload: string; opts: unknown }> = []
  failNext = false

  publish(topic: string, payload: string, opts: unknown, cb: (err?: Error) => void): void {
    this.calls.push({ topic, payload, opts })
    cb(this.failNext ? new Error('publish failed') : undefined)
  }
}

const topics = createMqttTopics('campus')

test('publishCommand publishes a well-formed message to the device command topic', async () => {
  const client = new FakePublishClient()
  const publisher = new MqttCommandPublisher(client as unknown as MqttClient, topics)

  await publisher.publishCommand({
    commandId: 'command-1',
    deviceId: 'device-1',
    type: 'reboot',
    payload: { force: true },
    issuedAt: new Date('2024-01-01T00:00:00Z')
  })

  assert.equal(client.calls.length, 1)
  assert.equal(client.calls[0].topic, 'campus/devices/device-1/commands')
  assert.deepEqual(JSON.parse(client.calls[0].payload), {
    commandId: 'command-1',
    type: 'reboot',
    payload: { force: true },
    issuedAt: '2024-01-01T00:00:00.000Z'
  })
})

test('publishCommand rejects when the underlying mqtt client reports an error', async () => {
  const client = new FakePublishClient()
  client.failNext = true
  const publisher = new MqttCommandPublisher(client as unknown as MqttClient, topics)

  await assert.rejects(
    () =>
      publisher.publishCommand({
        commandId: 'command-1',
        deviceId: 'device-1',
        type: 'reboot',
        payload: null,
        issuedAt: new Date()
      }),
    /publish failed/
  )
})
