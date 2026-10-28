/**
 * Cycle de vie (ADR 0014) :
 * - PENDING      : demande valide et persistée ; publication non confirmée.
 * - SENT         : le broker a accepté la publication (PUBACK QoS 1) — PAS
 *                  la preuve que l'objet l'a reçue.
 * - ACKNOWLEDGED : l'objet a exécuté la commande (ACK `executed`).
 * - FAILED       : non exécutée, avec certitude (refus/expiration côté objet,
 *                  ou rien n'est parti car le broker était injoignable).
 * - TIMEOUT      : aucun ACK dans le délai — état réel de l'objet INCONNU.
 * Les trois derniers sont terminaux.
 */
export type CommandStatus = 'PENDING' | 'SENT' | 'ACKNOWLEDGED' | 'FAILED' | 'TIMEOUT'

export const OPEN_COMMAND_STATUSES: CommandStatus[] = ['PENDING', 'SENT']

export type CommandParams = Record<string, unknown>

export interface Command {
  id: string
  deviceId: string
  type: string
  params: CommandParams
  status: CommandStatus
  createdAt: Date
  /**
   * Au-delà de cette date, la commande ne doit plus être exécutée par
   * l'objet (il répond `expired`) — protège contre une livraison tardive
   * par le broker (session persistante QoS 1) d'une commande que le
   * backend a déjà abandonnée. Voir ADR 0014.
   */
  expiresAt: Date
  sentAt: Date | null
  ackedAt: Date | null
  /** Motif d'échec (refus de l'objet, commande expirée, publication impossible…). */
  failureReason: string | null
  /** État réel rapporté par l'objet dans son ACK, après exécution (ex. `{ ventilation: 'on' }`). */
  reportedState: Record<string, unknown> | null
  timedOutAt: Date | null
  /**
   * ACK reçu APRÈS le passage en TIMEOUT : le statut reste TIMEOUT (c'est
   * ce que l'utilisateur a vu), mais ce que l'objet a finalement répondu
   * est conservé et exposé, pas caché. Voir ADR 0014.
   */
  lateAck: LateAck | null
  /** Utilisateur ayant demandé la commande (null pour les commandes antérieures à J4). */
  requestedBy: string | null
  /**
   * Clé d'idempotence fournie par le client (une par intention de
   * l'utilisateur), unique par `requestedBy` : un rejeu de la même demande
   * renvoie la même commande au lieu d'en créer une seconde. Voir ADR 0014.
   */
  idempotencyKey: string | null
}

export interface LateAck {
  status: CommandAckStatus
  at: Date
}

export interface NewCommand {
  deviceId: string
  type: string
  params: CommandParams
  expiresAt: Date
  requestedBy: string
  idempotencyKey: string
}

/** Demande de commande telle qu'elle arrive d'une entrée (API), avant validation. */
export interface CommandRequest {
  deviceId: string
  type: string
  params?: unknown
  requestedBy: string
  idempotencyKey: string
}

/**
 * Résultat d'exécution rapporté par l'objet. `executed` n'est émis
 * qu'APRÈS exécution : c'est ce qui permet de distinguer « reçue » de
 * « réellement exécutée » (voir ADR 0014).
 */
export type CommandAckStatus = 'executed' | 'rejected' | 'expired'

export interface CommandAck {
  commandId: string
  /** Device résolu depuis le topic MQTT (jamais depuis le payload, voir ADR 0008). */
  deviceId: string
  status: CommandAckStatus
  reason: string | null
  state: Record<string, unknown> | null
  ackedAt: Date
}
