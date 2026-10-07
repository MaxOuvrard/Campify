import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string(),
  // Journal brut (MongoDB) : un document par message MQTT reçu, avant tout
  // parsing/dédup — voir ADR 0013. Requis par l'ingester et le worker ; l'API
  // ne le lit jamais (elle ne sert que la base vérifiée) mais le schéma
  // d'environnement est partagé, d'où la valeur par défaut locale.
  MONGO_URL: z.string().default('mongodb://localhost:27017/campify_raw'),
  // Durée de conservation des événements bruts avant suppression automatique (index TTL).
  RAW_EVENTS_RETENTION_DAYS: z.coerce.number().default(30),
  MQTT_URL: z.string().default('mqtt://localhost:1883'),
  MQTT_TOPIC_PREFIX: z.string().default('campus'),
  // QoS de souscription : 1 par défaut (au moins une fois, ce que la dédup
  // par messageId est justement conçue pour absorber — voir ADR 0005).
  // Basculer à 0 pour le scénario J3 de comparaison QoS 0 vs QoS 1.
  MQTT_QOS: z
    .enum(['0', '1'])
    .default('1')
    .transform((v): 0 | 1 => (v === '1' ? 1 : 0)),
  // Groupe de souscription partagée (`$share/<groupe>/...`, ADR 0012) : vide
  // par défaut (souscription classique) pour ne pas casser une connexion
  // vers un broker qui ne le supporterait pas (ex. kit VPS, non vérifié).
  // À définir (ex. "campify-ingesters") pour répartir la charge entre
  // plusieurs instances de l'ingester plutôt que de dupliquer chaque
  // message vers chacune.
  MQTT_SHARED_GROUP: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  JWT_SECRET: z.string(),
  DEVICE_STALE_THRESHOLD_MS: z.coerce.number().default(5 * 60 * 1000),
  LOG_LEVEL: z.string().default('info'),
  // Worker de consolidation (ADR 0011, ADR 0013) : toutes les combien de temps
  // il relit le journal brut depuis son curseur, combien d'événements il
  // prend par lot (les lots pleins s'enchaînent sans attendre), et combien
  // de temps un événement doit "reposer" avant d'être lu (laisse les
  // insertions concurrentes d'autres ingesters devenir visibles). Polling
  // plutôt qu'une file d'attente (Redis) — pas de nouvelle techno, et le
  // délai induit (quelques secondes) est négligeable face aux seuils de
  // fraîcheur de l'app (minutes).
  CONSOLIDATION_POLL_INTERVAL_MS: z.coerce.number().default(3000),
  CONSOLIDATION_BATCH_SIZE: z.coerce.number().default(200),
  CONSOLIDATION_SETTLE_MS: z.coerce.number().default(1000)
})

export type Config = z.infer<typeof envSchema>

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env)
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${parsed.error.message}`)
  }
  return parsed.data
}
