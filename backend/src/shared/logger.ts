import pino from 'pino'
import { Logger } from '../domain/ports/Logger'

// `service` sur chaque ligne : indispensable pour filtrer dans une stack de
// logs centralisée (Loki/Grafana) une fois plusieurs services en présence.
//
// Format JSON forcé par `LOG_FORMAT=json` (mis par docker-compose.yml sur
// le conteneur backend, pour que Promtail/Loki reçoivent du JSON parsable
// — voir backend/observability/) indépendamment de NODE_ENV. Sans cette
// variable, on garde le format lisible (pino-pretty) hors production, pour
// `npm run dev` en local.
const usePretty = process.env.LOG_FORMAT ? process.env.LOG_FORMAT !== 'json' : process.env.NODE_ENV !== 'production'

// Nom de service par process (`campify-api`, `campify-ingester`,
// `campify-worker`, fixés par docker-compose.yml) : les trois process
// partagent ce logger, et sans ça une timeline de commande ne dirait pas
// QUI a traité chaque étape (ADR 0014). `campify-backend` à défaut.
export const pinoInstance = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: process.env.SERVICE_NAME ?? 'campify-backend' },
  transport: usePretty ? { target: 'pino-pretty' } : undefined
})

export const logger: Logger = {
  info: (msg, meta) => pinoInstance.info(meta ?? {}, msg),
  warn: (msg, meta) => pinoInstance.warn(meta ?? {}, msg),
  error: (msg, meta) => pinoInstance.error(meta ?? {}, msg)
}
