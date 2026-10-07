import { Db, MongoClient } from 'mongodb'

export interface MongoConnection {
  client: MongoClient
  db: Db
}

/**
 * La base utilisée est celle du chemin de l'URL (`mongodb://host:27017/campify_raw`).
 * Le driver ne se connecte qu'au premier appel : un Mongo indisponible au
 * démarrage ne bloque donc pas le process, mais fait échouer les écritures
 * (journalisées par le handler MQTT) jusqu'au retour de la base.
 */
export function createMongoConnection(url: string): MongoConnection {
  const client = new MongoClient(url)
  return { client, db: client.db() }
}
