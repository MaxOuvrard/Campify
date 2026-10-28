import { CommandParams } from '../entities/Command'

export interface OutgoingCommandMessage {
  commandId: string
  deviceId: string
  type: string
  params: CommandParams
  createdAt: Date
  expiresAt: Date
}

/**
 * Ce que l'adapter sait de la publication — rien de plus :
 * - `confirmed`   : le broker a accusé réception (PUBACK QoS 1).
 * - `not_sent`    : rien n'est parti (client déconnecté), c'est certain.
 * - `unconfirmed` : publication tentée sans confirmation (délai dépassé,
 *                   erreur) — elle a PU partir, ou partira à la reconnexion.
 */
export type PublishOutcome = 'confirmed' | 'not_sent' | 'unconfirmed'

export interface MqttPublisher {
  publishCommand(message: OutgoingCommandMessage): Promise<PublishOutcome>
}
