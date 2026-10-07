import { CommandRepository } from '../ports/CommandRepository'
import { Clock } from '../ports/Clock'
import { Logger } from '../ports/Logger'
import { OPEN_COMMAND_STATUSES } from '../entities/Command'
import { COMMAND_EVENT_TYPE } from './CommandService'

export const DEFAULT_COMMAND_TIMEOUT_GRACE_MS = 5_000

/**
 * Règle de timeout (ADR 0014) : une commande encore ouverte (PENDING/SENT)
 * dont `expiresAt + grâce` est dépassé passe en TIMEOUT. La grâce laisse à
 * l'ACK d'une commande exécutée juste avant `expiresAt` le temps de
 * traverser le broker — l'objet, lui, n'exécute jamais après `expiresAt`.
 *
 * Service à part de CommandService : il ne publie rien, et tourne dans le
 * worker (pas de client MQTT). Déclenché périodiquement par
 * `driving/worker/commandTimeoutPoller.ts`, jamais en mémoire dans l'API
 * (perdu au redémarrage, faux à plusieurs instances).
 */
export class CommandTimeoutService {
  constructor(
    private readonly commands: CommandRepository,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly graceMs: number = DEFAULT_COMMAND_TIMEOUT_GRACE_MS,
    private readonly batchSize: number = 100
  ) {}

  /** Passe en TIMEOUT les commandes échues ; renvoie le nombre effectivement passé en TIMEOUT. */
  async expireOverdue(): Promise<number> {
    const now = this.clock.now()
    const cutoff = new Date(now.getTime() - this.graceMs)
    const overdue = await this.commands.findOpenExpiredBefore(cutoff, this.batchSize)

    let expired = 0
    for (const command of overdue) {
      // Conditionnel : si l'ACK est arrivé entre la lecture et ici, il gagne.
      const moved = await this.commands.transition(command.id, OPEN_COMMAND_STATUSES, { status: 'TIMEOUT', timedOutAt: now })
      if (!moved) continue
      expired += 1
      this.logger.warn('command timed out', {
        eventType: COMMAND_EVENT_TYPE,
        commandId: command.id,
        deviceId: command.deviceId,
        status: 'TIMEOUT',
        reason: command.status === 'PENDING' ? 'no_ack_publish_unconfirmed' : 'no_ack',
        previousStatus: command.status,
        expiresAt: command.expiresAt.toISOString()
      })
    }
    return expired
  }
}
