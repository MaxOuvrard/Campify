import { Command, CommandStatus, LateAck, NewCommand } from '../entities/Command'

export interface CommandTransition {
  status: CommandStatus
  sentAt?: Date
  ackedAt?: Date
  timedOutAt?: Date
  failureReason?: string | null
  reportedState?: Record<string, unknown> | null
}

export interface CommandRepository {
  create(input: NewCommand): Promise<Command>
  findById(id: string): Promise<Command | null>
  /**
   * Changement d'état ATOMIQUE et conditionnel : n'est appliqué que si le
   * statut courant fait partie de `from` (UPDATE … WHERE status IN …).
   * Renvoie `false` si un autre process (ingester, worker, API) a changé
   * l'état entre-temps — c'est ce qui empêche un ACK et un timeout
   * simultanés de s'écraser l'un l'autre. Voir ADR 0014.
   */
  transition(id: string, from: CommandStatus[], to: CommandTransition): Promise<boolean>
  /** Enregistre un ACK tardif sur une commande déjà en TIMEOUT, s'il n'y en a pas déjà un. Renvoie `false` sinon. */
  recordLateAck(id: string, lateAck: LateAck, reportedState: Record<string, unknown> | null): Promise<boolean>
  /** Commandes encore ouvertes (PENDING/SENT) dont `expiresAt` est antérieur à `cutoff`. */
  findOpenExpiredBefore(cutoff: Date, limit: number): Promise<Command[]>
}
