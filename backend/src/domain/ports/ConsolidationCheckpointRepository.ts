import { RawEventCursor } from '../entities/RawEvent'

/** Mémorise jusqu'où un consommateur (le worker) a traité le journal brut. */
export interface ConsolidationCheckpointRepository {
  load(consumer: string): Promise<RawEventCursor | null>
  save(consumer: string, cursor: RawEventCursor): Promise<void>
}
