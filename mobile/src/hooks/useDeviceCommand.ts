import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, Command, CommandRequest, fetchCommand, sendCommand } from '../api/client'
import { generateIdempotencyKey } from '../utils/idempotencyKey'
import { isOpen } from '../utils/commandStatus'

/** Suivi par polling de GET /commands/:id (ADR 0014) : simple, borné, sans nouvelle infra côté backend. */
export const POLL_INTERVAL_MS = 1_000
/** Après un TIMEOUT, on continue d'écouter au ralenti pour afficher un éventuel ACK tardif. */
export const LATE_ACK_POLL_INTERVAL_MS = 3_000
export const LATE_ACK_WATCH_MS = 30_000
/** Garde-fou : on n'interroge jamais une commande ouverte plus longtemps que ça (worker arrêté…). */
export const MAX_TRACKING_MS = 90_000
/** Nouveaux essais automatiques sur erreur réseau, avec la MÊME clé d'idempotence. */
export const MAX_NETWORK_RETRIES = 2
export const RETRY_DELAY_MS = 1_000

export type CommandPhase =
  | { kind: 'idle' }
  | { kind: 'sending'; attempt: number }
  | { kind: 'tracking'; command: Command }
  | { kind: 'stale'; command: Command }
  | { kind: 'error'; message: string }

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Envoie une commande puis suit son état jusqu'à la réponse de l'objet.
 * Ne présente JAMAIS une commande comme réussie avant que le backend ne
 * l'ait vue ACKNOWLEDGED — l'état affiché est toujours celui renvoyé par
 * le serveur, jamais une supposition locale.
 */
export function useDeviceCommand(token: string, deviceId: string) {
  const [phase, setPhase] = useState<CommandPhase>({ kind: 'idle' })
  const mounted = useRef(true)
  // Incrémenté à chaque envoi : un polling d'une commande précédente
  // s'arrête de lui-même au lieu d'écraser l'état de la nouvelle.
  const generation = useRef(0)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const track = useCallback(
    async (initial: Command, gen: number) => {
      const startedAt = Date.now()
      let command = initial
      let timedOutAt: number | null = null
      const alive = () => mounted.current && generation.current === gen

      while (alive()) {
        if (isOpen(command)) {
          if (Date.now() - startedAt > MAX_TRACKING_MS) {
            setPhase({ kind: 'stale', command })
            return
          }
          await sleep(POLL_INTERVAL_MS)
        } else if (command.status === 'TIMEOUT' && command.lateAck === null) {
          timedOutAt ??= Date.now()
          if (Date.now() - timedOutAt > LATE_ACK_WATCH_MS) return
          await sleep(LATE_ACK_POLL_INTERVAL_MS)
        } else {
          return // état final (et ACK tardif éventuel) connu
        }

        if (!alive()) return
        try {
          command = await fetchCommand(token, command.id)
          if (alive()) setPhase({ kind: 'tracking', command })
        } catch {
          // Échec ponctuel de lecture (réseau) : on garde le dernier état
          // connu affiché et on réessaie au prochain tour.
        }
      }
    },
    [token]
  )

  const send = useCallback(
    async (request: CommandRequest) => {
      const gen = ++generation.current
      // Une clé par appui, conservée pour tous les nouveaux essais de cet appui.
      const idempotencyKey = generateIdempotencyKey()

      for (let attempt = 1; attempt <= MAX_NETWORK_RETRIES + 1; attempt++) {
        setPhase({ kind: 'sending', attempt })
        try {
          const command = await sendCommand(token, deviceId, request, idempotencyKey)
          if (!mounted.current || generation.current !== gen) return
          setPhase({ kind: 'tracking', command })
          void track(command, gen)
          return
        } catch (err) {
          if (!mounted.current || generation.current !== gen) return
          const networkError = err instanceof ApiError && err.status === undefined
          if (networkError && attempt <= MAX_NETWORK_RETRIES) {
            // Afficher le nouvel essai dès la coupure constatée, pas après l'attente.
            setPhase({ kind: 'sending', attempt: attempt + 1 })
            await sleep(RETRY_DELAY_MS)
            if (!mounted.current || generation.current !== gen) return
            continue
          }
          setPhase({
            kind: 'error',
            message: networkError
              ? "Serveur injoignable : impossible de savoir si la demande est arrivée. Vérifie l'état avant de réessayer."
              : err instanceof ApiError
                ? err.message
                : 'Erreur inattendue'
          })
          return
        }
      }
    },
    [token, deviceId, track]
  )

  const busy = phase.kind === 'sending' || (phase.kind === 'tracking' && isOpen(phase.command))

  return { phase, send, busy }
}
