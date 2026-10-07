import { Collection, Db, ObjectId } from 'mongodb'
import { ConsolidationCheckpointRepository } from '../../domain/ports/ConsolidationCheckpointRepository'
import { RawEventCursor } from '../../domain/entities/RawEvent'

interface CheckpointDocument {
  _id: string
  receivedAt: Date
  eventId: ObjectId
  updatedAt: Date
}

export const CHECKPOINTS_COLLECTION = 'consolidation_checkpoints'

/**
 * Un document par consommateur, réécrit (upsert) à chaque lot : la
 * progression du worker vit dans une collection à part, pas dans les
 * événements bruts, qui restent immuables (ADR 0013).
 */
export class MongoConsolidationCheckpointRepository implements ConsolidationCheckpointRepository {
  private readonly checkpoints: Collection<CheckpointDocument>

  constructor(db: Db) {
    this.checkpoints = db.collection<CheckpointDocument>(CHECKPOINTS_COLLECTION)
  }

  async load(consumer: string): Promise<RawEventCursor | null> {
    const doc = await this.checkpoints.findOne({ _id: consumer })
    return doc ? { receivedAt: doc.receivedAt, id: doc.eventId.toHexString() } : null
  }

  async save(consumer: string, cursor: RawEventCursor): Promise<void> {
    await this.checkpoints.updateOne(
      { _id: consumer },
      { $set: { receivedAt: cursor.receivedAt, eventId: new ObjectId(cursor.id), updatedAt: new Date() } },
      { upsert: true }
    )
  }
}
