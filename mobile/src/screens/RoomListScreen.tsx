import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { ApiError, fetchRooms, Room } from '../api/client'
import { readCache, writeCache } from '../storage/cache'
import { useNetworkStatus } from '../hooks/useNetworkStatus'
import { useAppForeground } from '../hooks/useAppForeground'
import { formatDateTime } from '../utils/format'

interface RoomListScreenProps {
  token: string
  onSelectRoom: (room: Room) => void
}

const CACHE_KEY = 'rooms'

export default function RoomListScreen({ token, onSelectRoom }: RoomListScreenProps) {
  const [rooms, setRooms] = useState<Room[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [cachedAt, setCachedAt] = useState<string | null>(null)
  const isConnected = useNetworkStatus()
  const hasData = useRef(false)

  const load = useCallback(async () => {
    setLoading(!hasData.current)
    setError(null)
    try {
      const fresh = await fetchRooms(token)
      hasData.current = true
      setRooms(fresh)
      setCachedAt(null)
      void writeCache(CACHE_KEY, fresh)
    } catch (err) {
      // Une requête ratée ne doit pas remplacer des salles déjà affichées
      // par un écran d'erreur : on ne bascule en erreur que si on n'a rien
      // à montrer, sinon on garde ce qui est à l'écran.
      if (!hasData.current) {
        setError(err instanceof ApiError ? err.message : 'Erreur inattendue')
      }
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    let cancelled = false
    void readCache<Room[]>(CACHE_KEY).then((entry) => {
      if (cancelled || entry === null || hasData.current) return
      hasData.current = true
      setRooms(entry.data)
      setCachedAt(entry.cachedAt)
      setLoading(false)
    })
    void load()
    return () => {
      cancelled = true
    }
  }, [load])

  useAppForeground(() => void load())

  const wasConnected = useRef(isConnected)
  useEffect(() => {
    if (wasConnected.current === false && isConnected === true) {
      void load()
    }
    wasConnected.current = isConnected
  }, [isConnected, load])

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    )
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => void load()}>
          <Text style={styles.retryButtonText}>Réessayer</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Salles</Text>
      {isConnected === false && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            Téléphone hors ligne{cachedAt ? ` — dernières données du ${formatDateTime(cachedAt)}` : ''}
          </Text>
        </View>
      )}
      <FlatList
        data={rooms ?? []}
        keyExtractor={(room) => room.id}
        ListEmptyComponent={<Text style={styles.empty}>Aucune salle enregistrée.</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => onSelectRoom(item)}>
            <Text style={styles.roomName}>{item.name}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    padding: 24
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 16
  },
  banner: {
    backgroundColor: '#fef3c7',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12
  },
  bannerText: {
    color: '#92400e',
    fontSize: 13,
    textAlign: 'center'
  },
  row: {
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee'
  },
  roomName: {
    fontSize: 17
  },
  empty: {
    color: '#666',
    textAlign: 'center',
    marginTop: 24
  },
  error: {
    color: '#c0392b',
    marginBottom: 12,
    textAlign: 'center'
  },
  retryButton: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 20
  },
  retryButtonText: {
    color: '#fff',
    fontWeight: '600'
  }
})
