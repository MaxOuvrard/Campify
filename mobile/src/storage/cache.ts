import AsyncStorage from '@react-native-async-storage/async-storage'

const CACHE_PREFIX = 'campify:cache:'

export interface CachedEntry<T> {
  data: T
  cachedAt: string
}

/**
 * Dernière réponse connue pour une clé donnée, survit à la perte réseau et
 * au redémarrage de l'app. Ce n'est qu'un confort d'affichage (montrer
 * "dernière synchro" plutôt qu'un écran vide) : une lecture/écriture ratée
 * ne doit jamais bloquer l'écran, donc toute erreur AsyncStorage est avalée.
 */
export async function readCache<T>(key: string): Promise<CachedEntry<T> | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_PREFIX + key)
    if (raw === null) return null
    return JSON.parse(raw) as CachedEntry<T>
  } catch {
    return null
  }
}

export async function writeCache<T>(key: string, data: T): Promise<void> {
  try {
    const entry: CachedEntry<T> = { data, cachedAt: new Date().toISOString() }
    await AsyncStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry))
  } catch {
    // best-effort
  }
}
