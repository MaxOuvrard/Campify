import { MqttClient } from 'mqtt'
import { MqttPublisher, OutgoingCommandMessage, PublishOutcome } from '../../domain/ports/MqttPublisher'
import { MqttTopics } from '../../shared/mqttTopics'

export const COMMAND_SCHEMA_VERSION = 1
export const DEFAULT_PUBLISH_CONFIRM_TIMEOUT_MS = 5_000

/**
 * Publie une commande au format du contrat J4 (ADR 0014), en snake_case
 * comme la télémétrie du kit, en QoS 1.
 *
 * Ne prétend jamais savoir plus que ce qu'il sait :
 * - client déconnecté → on ne publie pas du tout (`not_sent`, certain) —
 *   sinon mqtt.js mettrait le message en file et l'enverrait plus tard,
 *   à un moment que personne n'attend plus ;
 * - PUBACK reçu → `confirmed` (le BROKER l'a, pas forcément l'objet) ;
 * - ni PUBACK ni erreur dans le délai, ou erreur → `unconfirmed` : le
 *   message a pu partir, ou partira à la reconnexion.
 */
export class MqttCommandPublisher implements MqttPublisher {
  constructor(
    private readonly client: MqttClient,
    private readonly topics: MqttTopics,
    private readonly confirmTimeoutMs: number = DEFAULT_PUBLISH_CONFIRM_TIMEOUT_MS
  ) {}

  async publishCommand(message: OutgoingCommandMessage): Promise<PublishOutcome> {
    if (!this.client.connected) return 'not_sent'

    const topic = this.topics.commandTopic(message.deviceId)
    const payload = JSON.stringify({
      schema_version: COMMAND_SCHEMA_VERSION,
      command_id: message.commandId,
      device_id: message.deviceId,
      type: message.type,
      params: message.params,
      created_at: message.createdAt.toISOString(),
      expires_at: message.expiresAt.toISOString()
    })

    return new Promise<PublishOutcome>((resolve) => {
      const timer = setTimeout(() => resolve('unconfirmed'), this.confirmTimeoutMs)
      this.client.publish(topic, payload, { qos: 1 }, (err) => {
        clearTimeout(timer)
        resolve(err ? 'unconfirmed' : 'confirmed')
      })
    })
  }
}
