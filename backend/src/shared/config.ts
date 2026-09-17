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
  JWT_SECRET: z.string(),
  DEVICE_STALE_THRESHOLD_MS: z.coerce.number().default(5 * 60 * 1000),
  LOG_LEVEL: z.string().default('info')
})

export type Config = z.infer<typeof envSchema>

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env)
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${parsed.error.message}`)
  }
  return parsed.data
}
