import { DeadLetter } from '../entities/RawEvent'

/**
 * Événements bruts que le worker ne peut pas transformer en mesure (payload
 * illisible, hors contrat, device inconnu…). Ils sont conservés avec leur
 * motif au lieu d'être perdus ou de bloquer la file — voir ADR 0013.
 */
export interface DeadLetterRepository {
  record(deadLetter: DeadLetter): Promise<void>
}
