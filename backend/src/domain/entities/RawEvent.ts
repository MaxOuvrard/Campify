/**
 * Message MQTT tel que reçu par l'ingester, avant toute interprétation :
 * le topic exact, le payload exact (même invalide, même hors contrat), les
 * métadonnées de livraison et l'instant de réception. Rien n'est extrait ni
 * validé ici — c'est ce qui permet de rejouer l'historique si une règle de
 * parsing ou de validation change (voir ADR 0013).
 */
export interface RawEvent {
  id: string
  topic: string
  /** Payload décodé en UTF-8, tel que publié (JSON valide ou non). */
  payload: string
  qos: number
  retain: boolean
  receivedAt: Date
}

export type NewRawEvent = Omit<RawEvent, 'id' | 'receivedAt'> & { receivedAt?: Date }

/**
 * Position du worker dans le flux d'événements bruts : `(receivedAt, id)`
 * est un ordre total, stable même quand plusieurs ingesters écrivent dans
 * la même milliseconde. Le worker n'a ainsi besoin d'aucune colonne
 * "traité" sur les événements eux-mêmes (voir ADR 0013).
 */
export interface RawEventCursor {
  receivedAt: Date
  id: string
}

export type DeadLetterReason =
  | 'unrecognized_topic'
  | 'invalid_json'
  | 'invalid_schema'
  | 'permanent_failure'

export interface DeadLetter {
  event: RawEvent
  reason: DeadLetterReason
  error?: string
  failedAt: Date
}
