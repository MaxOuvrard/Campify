import { NewMeasurement } from '../entities/Measurement'
import { RawMeasurement } from '../entities/RawMeasurement'

/**
 * Zone d'atterrissage : enregistre toute mesure entrante telle quelle, sans
 * filtre (y compris doublons/retards) — voir ADR 0005. La base vérifiée
 * (MeasurementRepository) n'est jamais alimentée directement depuis
 * l'entrée MQTT : le worker de consolidation (ADR 0011) relit chaque ligne
 * via `findUnconsolidated` avant de décider quoi en faire, pour que la
 * validation porte sur ce que la base brute a réellement persisté.
 */
export interface RawMeasurementRepository {
  record(input: NewMeasurement): Promise<RawMeasurement>
  findById(id: string): Promise<RawMeasurement | null>
  /** Lignes pas encore traitées par le worker de consolidation, les plus anciennes d'abord — voir ADR 0011. */
  findUnconsolidated(limit: number): Promise<RawMeasurement[]>
  /** Marque ces lignes comme traitées (acceptées ou rejetées, peu importe) pour que le worker ne les reprenne jamais. */
  markConsolidated(ids: string[]): Promise<void>
}
