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
  onScanDevice: () => void
}

const METRIC_LABELS: Record<string, string> = {
  temperature: 'Température',
  co2: 'CO₂'
}

function metricLabel(type: string): string {
  return METRIC_LABELS[type] ?? type
}

interface DeviceGroup {
  deviceId: string
  deviceName: string
  measurements: LatestMeasurement[]
}

// Un capteur peut remonter plusieurs métriques (température, CO2...) : elles
// sont affichées ensemble dans une seule carte par capteur plutôt qu'éclatées
// en une carte par métrique, pour qu'on sache d'un coup d'œil quel capteur
// remonte quoi.
function groupByDevice(measurements: LatestMeasurement[]): DeviceGroup[] {
  const groups = new Map<string, DeviceGroup>()
  for (const measurement of measurements) {
    const existing = groups.get(measurement.deviceId)
    if (existing) {
      existing.measurements.push(measurement)
    } else {
      groups.set(measurement.deviceId, {
        deviceId: measurement.deviceId,
        deviceName: measurement.deviceName,
        measurements: [measurement]
      })
    }
  }
  return [...groups.values()].sort((a, b) => a.deviceName.localeCompare(b.deviceName))
}

export default function RoomDetailScreen({ token, room, onBack, onScanDevice }: RoomDetailScreenProps) {
  const [measurements, setMeasurements] = useState<LatestMeasurement[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  // Date des données actuellement affichées, cf. RoomListScreen : dernier
  // fetch réussi, ou date du cache tant qu'aucun fetch n'a encore abouti.
  const [dataAsOf, setDataAsOf] = useState<string | null>(null)
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
        setDataAsOf(new Date().toISOString())
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
      setDataAsOf(entry.cachedAt)
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
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.back}>{'< Salles'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onScanDevice}>
          <Text style={styles.scanLink}>Scanner un équipement</Text>
        </TouchableOpacity>
      </View>
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
          {dataAsOf && <Text style={styles.syncInfo}>Données du {formatDateTime(dataAsOf)}</Text>}
          {isConnected === false && (
            <View style={styles.banner}>
              <Text style={styles.bannerText}>Téléphone hors ligne — affichage des dernières données reçues</Text>
            </View>
          )}
          <ScrollView
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />}
          >
            {measurements && measurements.length === 0 ? (
              <Text style={styles.empty}>Aucune mesure reçue pour l'instant pour cette salle.</Text>
            ) : (
              measurements &&
              groupByDevice(measurements).map((group) => (
                <View key={group.deviceId} style={styles.card}>
                  <Text style={styles.deviceName}>{group.deviceName}</Text>
                  <View style={styles.metricsRow}>
                    {group.measurements.map((measurement, index) => (
                      <View
                        key={measurement.type}
                        style={[styles.metricColumn, index > 0 && styles.metricColumnDivider, !measurement.fresh && styles.metricColumnStale]}
                      >
                        <View style={styles.cardHeader}>
                          <Text style={styles.metricLabel}>{metricLabel(measurement.type)}</Text>
                        </View>
                        <Text style={styles.metricValue}>
                          {measurement.value}
                          {measurement.unit ? ` ${measurement.unit}` : ''}
                        </Text>
                        <Text style={styles.metricDate}>
                          {measurement.fresh ? 'Mesuré le' : 'Dernière mesure connue le'} {formatDateTime(measurement.timestamp)}
                        </Text>
                        {!measurement.fresh && (
                          <View style={styles.staleBadge}>
                            <Text style={styles.staleBadgeText}>Capteur silencieux</Text>
                          </View>
                        )}
                      </View>
                    ))}
                  </View>
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
    padding: 24,
    marginTop: 36
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8
  },
  back: {
    color: '#2563eb'
  },
  scanLink: {
    color: '#2563eb',
    fontWeight: '600'
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 4
  },
  syncInfo: {
    fontSize: 12,
    color: '#888',
    marginBottom: 12
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
  deviceName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#333',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12
  },
  metricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap'
  },
  metricColumn: {
    flexGrow: 1,
    flexBasis: '45%'
  },
  metricColumnDivider: {
    borderLeftWidth: 1,
    borderLeftColor: '#e2e5e9',
    paddingLeft: 16,
    marginLeft: 16
  },
  metricColumnStale: {
    opacity: 0.75
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
    paddingHorizontal: 8,
    marginTop: 6,
    alignSelf: 'flex-start'
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
