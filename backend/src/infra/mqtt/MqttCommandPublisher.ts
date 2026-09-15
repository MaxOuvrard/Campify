import { MqttClient } from 'mqtt'
import { MqttPublisher, OutgoingCommandMessage } from '../../domain/ports/MqttPublisher'
import { MqttTopics } from '../../shared/mqttTopics'

export class MqttCommandPublisher implements MqttPublisher {
  constructor(
    private readonly client: MqttClient,
    private readonly topics: MqttTopics
  ) {}

  async publishCommand(message: OutgoingCommandMessage): Promise<void> {
    const topic = this.topics.commandTopic(message.deviceId)
    const payload = JSON.stringify({
      commandId: message.commandId,
      type: message.type,
      payload: message.payload,
      issuedAt: message.issuedAt.toISOString()
    })

    await new Promise<void>((resolve, reject) => {
      this.client.publish(topic, payload, { qos: 1 }, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }
}
