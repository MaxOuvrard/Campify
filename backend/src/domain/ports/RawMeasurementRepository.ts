import { NewMeasurement } from '../entities/Measurement'
import { RawMeasurement } from '../entities/RawMeasurement'

/**
 * Zone d'atterrissage : enregistre toute mesure entrante telle quelle, sans
 * filtre (y compris doublons/retards) — voir ADR 0005. La base vérifiée
 * (MeasurementRepository) n'est jamais alimentée directement depuis
 * l'entrée MQTT : MeasurementIngestionService relit systématiquement la
 * ligne via `findById` avant de décider quoi en faire, pour que la
 * validation porte sur ce que la base brute a réellement persisté.
 */
export interface RawMeasurementRepository {
  record(input: NewMeasurement): Promise<RawMeasurement>
  findById(id: string): Promise<RawMeasurement | null>
}
