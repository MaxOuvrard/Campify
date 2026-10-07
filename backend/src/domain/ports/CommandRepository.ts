import { Command, CommandStatus, LateAck, NewCommand } from '../entities/Command'

export interface CommandTransition {
  status: CommandStatus
  sentAt?: Date
  ackedAt?: Date
  timedOutAt?: Date
  failureReason?: string | null
  reportedState?: Record<string, unknown> | null
}

export interface CreateCommandResult {
  command: Command
  /** `false` : une commande existait déjà pour (requestedBy, idempotencyKey) — c'est elle qui est renvoyée, rien n'a été créé. */
  created: boolean
}

export interface CommandRepository {
  /**
   * Crée la commande, sauf si (requestedBy, idempotencyKey) existe déjà :
   * renvoie alors l'existante. Garanti par une contrainte d'unicité en base,
   * donc correct même pour deux requêtes identiques simultanées.
   */
  createIfAbsent(input: NewCommand): Promise<CreateCommandResult>
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
