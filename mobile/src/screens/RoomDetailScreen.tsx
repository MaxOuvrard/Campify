import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { ApiError, fetchLatestMeasurements, LatestMeasurement, Room } from '../api/client'
import { readCache, writeCache } from '../storage/cache'
import { useNetworkStatus } from '../hooks/useNetworkStatus'
import { useAppForeground } from '../hooks/useAppForeground'
import { formatDateTime } from '../utils/format'

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

export default function RoomDetailScreen({ token, room, onBack }: RoomDetailScreenProps) {
  const [measurements, setMeasurements] = useState<LatestMeasurement[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [cachedAt, setCachedAt] = useState<string | null>(null)
  const isConnected = useNetworkStatus()
  const hasData = useRef(false)
  const cacheKey = `room:${room.id}:measurements`

  const load = useCallback(
    async (isRefresh: boolean) => {
      isRefresh ? setRefreshing(true) : setLoading(!hasData.current)
      setError(null)
      try {
        const fresh = await fetchLatestMeasurements(token, room.id)
        hasData.current = true
        setMeasurements(fresh)
        setCachedAt(null)
        void writeCache(cacheKey, fresh)
      } catch (err) {
        // Idem : si on a déjà quelque chose à l'écran (frais ou en cache),
        // une requête ratée ne doit pas le remplacer par un écran d'erreur.
        if (!hasData.current) {
          setError(err instanceof ApiError ? err.message : 'Erreur inattendue')
        }
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [token, room.id, cacheKey]
  )

  useEffect(() => {
    let cancelled = false
    hasData.current = false
    void readCache<LatestMeasurement[]>(cacheKey).then((entry) => {
      if (cancelled || entry === null || hasData.current) return
      hasData.current = true
      setMeasurements(entry.data)
      setCachedAt(entry.cachedAt)
      setLoading(false)
    })
    void load(false)
    return () => {
      cancelled = true
    }
  }, [load, cacheKey])

  useAppForeground(() => void load(false))

  const wasConnected = useRef(isConnected)
  useEffect(() => {
    if (wasConnected.current === false && isConnected === true) {
      void load(false)
    }
    wasConnected.current = isConnected
  }, [isConnected, load])

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
        <>
          {isConnected === false && (
            <View style={styles.banner}>
              <Text style={styles.bannerText}>
                Téléphone hors ligne{cachedAt ? ` — dernières données du ${formatDateTime(cachedAt)}` : ''}
              </Text>
            </View>
          )}
          <ScrollView
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />}
          >
            {measurements && measurements.length === 0 ? (
              <Text style={styles.empty}>Aucune mesure reçue pour l'instant pour cette salle.</Text>
            ) : (
              measurements?.map((measurement) => (
                <View key={measurement.type} style={[styles.card, !measurement.fresh && styles.cardStale]}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.metricLabel}>{metricLabel(measurement.type)}</Text>
                    {!measurement.fresh && (
                      <View style={styles.staleBadge}>
                        <Text style={styles.staleBadgeText}>Capteur silencieux</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.metricValue}>
                    {measurement.value}
                    {measurement.unit ? ` ${measurement.unit}` : ''}
                  </Text>
                  <Text style={styles.metricDate}>
                    {measurement.fresh ? 'Mesuré le' : 'Dernière mesure connue le'} {formatDateTime(measurement.timestamp)}
                  </Text>
                </View>
              ))
            )}
          </ScrollView>
        </>
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
  list: {
    gap: 12
  },
  card: {
    backgroundColor: '#f4f6f8',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12
  },
  cardStale: {
    backgroundColor: '#fdf2f2',
    opacity: 0.85
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  metricLabel: {
    fontSize: 14,
    color: '#555'
  },
  staleBadge: {
    backgroundColor: '#c0392b',
    borderRadius: 6,
    paddingVertical: 2,
    paddingHorizontal: 8
  },
  staleBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600'
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
