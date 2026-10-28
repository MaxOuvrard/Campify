import { Logger } from '../../domain/ports/Logger'
import { CommandTimeoutService } from '../../domain/services/CommandTimeoutService'

export interface CommandTimeoutPollerDeps {
  timeouts: CommandTimeoutService
  logger: Logger
  intervalMs: number
}

/**
 * Déclenche périodiquement la règle de timeout des commandes
 * (`CommandTimeoutService.expireOverdue()`, ADR 0014) depuis le worker.
 * Aucune règle ici : seulement le « quand ». Un échec (base injoignable)
 * est journalisé et retenté au prochain passage — l'état est en base,
 * rien n'est perdu entre deux passages ni au redémarrage du worker.
 */
export function startCommandTimeoutPolling(deps: CommandTimeoutPollerDeps): () => void {
  let stopped = false
  let timer: NodeJS.Timeout | null = null

  const tick = async (): Promise<void> => {
    try {
      await deps.timeouts.expireOverdue()
    } catch (err) {
      deps.logger.error('command timeout sweep failed', {
        eventType: 'command_lifecycle',
        status: 'error',
        reason: 'timeout_sweep_failed',
        error: (err as Error).message
      })
    }
    if (!stopped) timer = setTimeout(() => void tick(), deps.intervalMs)
  }

  timer = setTimeout(() => void tick(), deps.intervalMs)

  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
}
