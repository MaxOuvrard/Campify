import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'

export const REFRESH_INTERVAL_MS = 30_000

/**
 * Appelle `onTick` toutes les `intervalMs` tant que l'écran est monté et
 * l'app au premier plan — sans ça, une alerte ouverte pendant qu'on regarde
 * l'écran n'apparaîtrait qu'au prochain retour au premier plan ou
 * rafraîchissement manuel. En arrière-plan, les ticks sont ignorés (pas de
 * requêtes inutiles) ; le retour au premier plan est déjà couvert par
 * `useAppForeground`.
 */
export function usePeriodicRefresh(onTick: () => void, intervalMs: number = REFRESH_INTERVAL_MS): void {
  const callback = useRef(onTick)
  callback.current = onTick

  useEffect(() => {
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') callback.current()
    }, intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
}
