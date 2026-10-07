import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string(),
  // Base brute (TimescaleDB) : landing zone des mesures avant dedup/fraîcheur — voir ADR 0005.
  RAW_MEASUREMENTS_DATABASE_URL: z.string(),
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
  // Worker de consolidation (ADR 0011) : toutes les combien de temps il va
  // chercher les lignes brutes pas encore traitées, et combien il en prend
  // par passage. Polling plutôt qu'une file d'attente (Redis) — plus simple,
  // pas de nouvelle techno, et le délai induit (quelques secondes max) est
  // négligeable face aux seuils de fraîcheur de l'app (minutes).
  CONSOLIDATION_POLL_INTERVAL_MS: z.coerce.number().default(3000),
  CONSOLIDATION_BATCH_SIZE: z.coerce.number().default(200)
})

export type Config = z.infer<typeof envSchema>

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env)
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${parsed.error.message}`)
  }
  return parsed.data
}
