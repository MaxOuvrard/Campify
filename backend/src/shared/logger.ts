import pino from 'pino'
import { Logger } from '../domain/ports/Logger'

export const pinoInstance = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty' }
})

export const logger: Logger = {
  info: (msg, meta) => pinoInstance.info(meta ?? {}, msg),
  warn: (msg, meta) => pinoInstance.warn(meta ?? {}, msg),
  error: (msg, meta) => pinoInstance.error(meta ?? {}, msg)
}
