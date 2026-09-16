import { useEffect, useRef } from 'react'
import { AppState, AppStateStatus } from 'react-native'

/**
 * Appelle `onForeground` quand l'app repasse au premier plan (l'utilisateur
 * revient d'un switch d'app ou du verrouillage écran) — c'est le moment où
 * les données affichées ont le plus de chances d'être périmées.
 */
export function useAppForeground(onForeground: () => void): void {
  const appState = useRef(AppState.currentState)
  const callback = useRef(onForeground)
  callback.current = onForeground

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && next === 'active') {
        callback.current()
      }
      appState.current = next
    })
    return () => subscription.remove()
  }, [])
}
