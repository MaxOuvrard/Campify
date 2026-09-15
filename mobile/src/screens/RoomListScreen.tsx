import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { ApiError, fetchRooms, Room } from '../api/client'

interface RoomListScreenProps {
  token: string
  onSelectRoom: (room: Room) => void
}

export default function RoomListScreen({ token, onSelectRoom }: RoomListScreenProps) {
  const [rooms, setRooms] = useState<Room[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setRooms(await fetchRooms(token))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur inattendue')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

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
