/**
 * Logs JSON du simulateur, au même format que le backend (shared/logger.ts :
 * `level`, `time`, `service`, `msg` + champs de corrélation `eventType`,
 * `commandId`, `deviceId`, `status`, `reason`). Une ligne par événement sur
 * stdout : collectée par Promtail quand le simulateur tourne en conteneur
 * (service `simulator` du docker-compose), ce qui permet de suivre un
 * `commandId` jusque dans l'objet. Voir ADR 0014.
 */
type Level = 'info' | 'warn' | 'error'

const SERVICE = 'device-simulator'

// Niveaux numériques de pino (30/40/50), comme les lignes du backend.
const PINO_LEVELS: Record<Level, number> = { info: 30, warn: 40, error: 50 }

export function log(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level: PINO_LEVELS[level], time: Date.now(), service: SERVICE, msg, ...fields })
  if (level === 'error') console.error(line)
  else console.log(line)
}
