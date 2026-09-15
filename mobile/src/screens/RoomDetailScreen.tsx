import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { ApiError, fetchLatestMeasurements, LatestMeasurement, Room } from '../api/client'

interface RoomDetailScreenProps {
  token: string
  room: Room
  onBack: () => void
}

const METRIC_LABELS: Record<string, string> = {
  temperature: 'Température',
  co2: 'CO₂'
}

function metricLabel(type: string): string {
  return METRIC_LABELS[type] ?? type
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' })
}

export default function RoomDetailScreen({ token, room, onBack }: RoomDetailScreenProps) {
  const [measurements, setMeasurements] = useState<LatestMeasurement[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(
    async (isRefresh: boolean) => {
      isRefresh ? setRefreshing(true) : setLoading(true)
      setError(null)
      try {
        setMeasurements(await fetchLatestMeasurements(token, room.id))
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Erreur inattendue')
      } finally {
        isRefresh ? setRefreshing(false) : setLoading(false)
      }
    },
    [token, room.id]
  )

  useEffect(() => {
    void load(false)
  }, [load])

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={onBack}>
        <Text style={styles.back}>{'< Salles'}</Text>
      </TouchableOpacity>
      <Text style={styles.title}>{room.name}</Text>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => void load(false)}>
            <Text style={styles.retryButtonText}>Réessayer</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />}
        >
          {measurements && measurements.length === 0 ? (
            <Text style={styles.empty}>Aucune mesure reçue pour l'instant pour cette salle.</Text>
          ) : (
            measurements?.map((measurement) => (
              <View key={measurement.type} style={styles.card}>
                <Text style={styles.metricLabel}>{metricLabel(measurement.type)}</Text>
                <Text style={styles.metricValue}>
                  {measurement.value}
                  {measurement.unit ? ` ${measurement.unit}` : ''}
                </Text>
                <Text style={styles.metricDate}>Mesuré le {formatDate(measurement.timestamp)}</Text>
              </View>
            ))
          )}
        </ScrollView>
      )}
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
    justifyContent: 'center'
  },
  back: {
    color: '#2563eb',
    marginBottom: 8
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 16
  },
  list: {
    gap: 12
  },
  card: {
    backgroundColor: '#f4f6f8',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12
  },
  metricLabel: {
    fontSize: 14,
    color: '#555'
  },
  metricValue: {
    fontSize: 32,
    fontWeight: '700',
    marginVertical: 4
  },
  metricDate: {
    fontSize: 12,
    color: '#888'
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
