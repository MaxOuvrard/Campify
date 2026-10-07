import { Collection, Db, ObjectId } from 'mongodb'
import { RawEventRepository } from '../../domain/ports/RawEventRepository'
import { NewRawEvent, RawEvent, RawEventCursor } from '../../domain/entities/RawEvent'

interface RawEventDocument {
  _id: ObjectId
  topic: string
  payload: string
  qos: number
  retain: boolean
  receivedAt: Date
}

export const RAW_EVENTS_COLLECTION = 'raw_events'

function toDomain(doc: RawEventDocument): RawEvent {
  return {
    id: doc._id.toHexString(),
    topic: doc.topic,
    payload: doc.payload,
    qos: doc.qos,
    retain: doc.retain,
    receivedAt: doc.receivedAt
  }
}

function afterCursor(cursor: RawEventCursor | null): Record<string, unknown> {
  if (cursor === null) return {}
  return {
    $or: [
      { receivedAt: { $gt: cursor.receivedAt } },
      { receivedAt: cursor.receivedAt, _id: { $gt: new ObjectId(cursor.id) } }
    ]
  }
}

/**
 * Journal brut des messages MQTT dans MongoDB : un document par message,
 * inséré tel que reçu, jamais modifié (ADR 0013). Document plutôt que
 * table parce que le payload n'a volontairement aucun schéma imposé — un
 * message hors contrat doit pouvoir être stocké comme les autres.
 */
export class MongoRawEventRepository implements RawEventRepository {
  private readonly events: Collection<RawEventDocument>

  constructor(db: Db) {
    this.events = db.collection<RawEventDocument>(RAW_EVENTS_COLLECTION)
  }

  /**
   * Index de lecture du worker (`receivedAt`, `_id`) et index TTL : MongoDB
   * supprime seul les événements plus vieux que `retentionDays`. L'écriture
   * du journal n'est jamais bloquée par du nettoyage applicatif.
   */
  async ensureIndexes(retentionDays: number): Promise<void> {
    await this.events.createIndex({ receivedAt: 1, _id: 1 }, { name: 'receivedAt_id' })
    await this.events.createIndex({ receivedAt: 1 }, { name: 'receivedAt_ttl', expireAfterSeconds: retentionDays * 24 * 3600 })
  }

  async record(event: NewRawEvent): Promise<RawEvent> {
    const doc: RawEventDocument = {
      _id: new ObjectId(),
      topic: event.topic,
      payload: event.payload,
      qos: event.qos,
      retain: event.retain,
      receivedAt: event.receivedAt ?? new Date()
    }
    await this.events.insertOne(doc)
    return toDomain(doc)
  }

  async findAfter(cursor: RawEventCursor | null, limit: number, receivedBefore: Date): Promise<RawEvent[]> {
    const docs = await this.events
      .find({ $and: [afterCursor(cursor), { receivedAt: { $lt: receivedBefore } }] })
      .sort({ receivedAt: 1, _id: 1 })
      .limit(limit)
      .toArray()
    return docs.map(toDomain)
  }

  async countAfter(cursor: RawEventCursor | null): Promise<number> {
    return this.events.countDocuments(afterCursor(cursor))
  }
}
