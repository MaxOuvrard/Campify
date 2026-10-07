import { NewRawEvent, RawEvent, RawEventCursor } from '../entities/RawEvent'

/**
 * Journal des messages MQTT bruts (zone d'atterrissage, voir ADR 0005 et
 * ADR 0013). L'ingester n'y fait qu'ajouter ; le worker ne fait que lire
 * à partir d'un curseur — aucun événement n'est jamais modifié après
 * insertion.
 */
export interface RawEventRepository {
  record(event: NewRawEvent): Promise<RawEvent>
  /**
   * Événements strictement après `cursor` (tous si `null`), du plus ancien
   * au plus récent, reçus avant `receivedBefore`. Ce plafond laisse aux
   * insertions en cours (autres instances de l'ingester) le temps de
   * devenir visibles : sans lui, un événement reçu à t mais écrit après
   * qu'un événement reçu à t+1 a été lu serait sauté définitivement.
   */
  findAfter(cursor: RawEventCursor | null, limit: number, receivedBefore: Date): Promise<RawEvent[]>
  /** Nombre d'événements après `cursor` — sert à mesurer le retard du worker. */
  countAfter(cursor: RawEventCursor | null): Promise<number>
}
