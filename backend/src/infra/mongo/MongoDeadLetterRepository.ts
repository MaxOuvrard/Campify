import { Collection, Db, ObjectId } from 'mongodb'
import { DeadLetterRepository } from '../../domain/ports/DeadLetterRepository'
import { DeadLetter } from '../../domain/entities/RawEvent'

interface DeadLetterDocument {
  _id: ObjectId
  event: { topic: string; payload: string; qos: number; retain: boolean; receivedAt: Date }
  reason: string
  error?: string
  failedAt: Date
}

export const DEAD_LETTERS_COLLECTION = 'dead_letters'

/** `_id` = id de l'événement brut : rejouer deux fois le même échec ne crée qu'une entrée. */
export class MongoDeadLetterRepository implements DeadLetterRepository {
  private readonly deadLetters: Collection<DeadLetterDocument>

  constructor(db: Db) {
    this.deadLetters = db.collection<DeadLetterDocument>(DEAD_LETTERS_COLLECTION)
  }

  async record(deadLetter: DeadLetter): Promise<void> {
    const { event } = deadLetter
    await this.deadLetters.replaceOne(
      { _id: new ObjectId(event.id) },
      {
        event: { topic: event.topic, payload: event.payload, qos: event.qos, retain: event.retain, receivedAt: event.receivedAt },
        reason: deadLetter.reason,
        ...(deadLetter.error !== undefined ? { error: deadLetter.error } : {}),
        failedAt: deadLetter.failedAt
      },
      { upsert: true }
    )
  }
}
