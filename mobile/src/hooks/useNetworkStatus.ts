import { useEffect, useState } from 'react'
import NetInfo from '@react-native-community/netinfo'

/**
 * Connectivité du téléphone (pas celle du capteur : voir le champ `fresh`
 * renvoyé par l'API). `null` tant que le premier état n'est pas connu.
 */
export function useNetworkStatus(): boolean | null {
  const [isConnected, setIsConnected] = useState<boolean | null>(null)

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsConnected(state.isConnected === true && state.isInternetReachable !== false)
    })
    return unsubscribe
  }, [])

  return isConnected
}
