import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { ApiError, fetchLatestMeasurements, fetchRoomAlerts, LatestMeasurement, Room, RoomAlert } from '../api/client'
import { readCache, writeCache } from '../storage/cache'
import { useNetworkStatus } from '../hooks/useNetworkStatus'
import { useAppForeground } from '../hooks/useAppForeground'
import { usePeriodicRefresh } from '../hooks/usePeriodicRefresh'
import { alertLabel, formatDateTime, metricLabel } from '../utils/format'
import { HistoryTarget } from '../store/appStore'

interface RoomDetailScreenProps {
  token: string
  room: Room
  onBack: () => void
  onScanDevice: () => void
  onOpenHistory: (target: HistoryTarget) => void
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

function metricKey(deviceId: string, type: string): string {
  return `${deviceId}:${type}`
}

export default function RoomDetailScreen({ token, room, onBack, onScanDevice, onOpenHistory }: RoomDetailScreenProps) {
  const [measurements, setMeasurements] = useState<LatestMeasurement[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  // Date des données actuellement affichées, cf. RoomListScreen : dernier
  // fetch réussi, ou date du cache tant qu'aucun fetch n'a encore abouti.
  const [dataAsOf, setDataAsOf] = useState<string | null>(null)
  // Alertes chargées à part des mesures : un échec ne doit jamais se lire
  // comme « aucune alerte » — on garde la dernière liste connue et on
  // signale qu'elle n'a pas pu être mise à jour (`alertsUnavailable`).
  const [alerts, setAlerts] = useState<RoomAlert[] | null>(null)
  const [alertsAsOf, setAlertsAsOf] = useState<string | null>(null)
  const [alertsUnavailable, setAlertsUnavailable] = useState(false)
  const [showResolved, setShowResolved] = useState(false)
  const isConnected = useNetworkStatus()
  const hasData = useRef(false)
  const cacheKey = `room:${room.id}:measurements`
  const alertsCacheKey = `room:${room.id}:alerts`

  const load = useCallback(
    async (isRefresh: boolean) => {
      isRefresh ? setRefreshing(true) : setLoading(!hasData.current)
      setError(null)
      const [measurementsResult, alertsResult] = await Promise.allSettled([
        fetchLatestMeasurements(token, room.id),
        fetchRoomAlerts(token, room.id)
      ])

      if (measurementsResult.status === 'fulfilled') {
        hasData.current = true
        setMeasurements(measurementsResult.value)
        setDataAsOf(new Date().toISOString())
        void writeCache(cacheKey, measurementsResult.value)
      } else if (!hasData.current) {
        // Idem : si on a déjà quelque chose à l'écran (frais ou en cache),
        // une requête ratée ne doit pas le remplacer par un écran d'erreur.
        const err = measurementsResult.reason
        setError(err instanceof ApiError ? err.message : 'Erreur inattendue')
      }

      if (alertsResult.status === 'fulfilled') {
        setAlerts(alertsResult.value)
        setAlertsAsOf(new Date().toISOString())
        setAlertsUnavailable(false)
        void writeCache(alertsCacheKey, alertsResult.value)
      } else {
        setAlertsUnavailable(true)
      }

      setLoading(false)
      setRefreshing(false)
    },
    [token, room.id, cacheKey, alertsCacheKey]
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
    void readCache<RoomAlert[]>(alertsCacheKey).then((entry) => {
      if (cancelled || entry === null) return
      setAlerts((current) => current ?? entry.data)
      setAlertsAsOf((current) => current ?? entry.cachedAt)
    })
    void load(false)
    return () => {
      cancelled = true
    }
  }, [load, cacheKey, alertsCacheKey])

  useAppForeground(() => void load(false))
  usePeriodicRefresh(() => void load(false))

  const wasConnected = useRef(isConnected)
  useEffect(() => {
    if (wasConnected.current === false && isConnected === true) {
      void load(false)
    }
    wasConnected.current = isConnected
  }, [isConnected, load])

  const openAlerts = (alerts ?? []).filter((a) => a.status === 'open')
  const resolvedAlerts = (alerts ?? []).filter((a) => a.status === 'resolved')
  const measurementByKey = new Map((measurements ?? []).map((m) => [metricKey(m.deviceId, m.type), m]))
  const alertKeys = new Set(openAlerts.map((a) => metricKey(a.deviceId, a.measurementType)))

  const unitOf = (alert: RoomAlert): string => {
    const unit = measurementByKey.get(metricKey(alert.deviceId, alert.measurementType))?.unit
    return unit ? ` ${unit}` : ''
  }

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
            {alertsUnavailable && (
              <View style={styles.banner}>
                <Text style={styles.bannerText}>
                  {alerts !== null && alertsAsOf
                    ? `Alertes indisponibles — dernière liste connue du ${formatDateTime(alertsAsOf)}`
                    : 'Alertes indisponibles'}
                </Text>
              </View>
            )}

            {openAlerts.length > 0 && (
              <View style={styles.alertSection}>
                <Text style={styles.sectionTitle}>Alertes en cours</Text>
                {openAlerts.map((alert) => {
                  const measurement = measurementByKey.get(metricKey(alert.deviceId, alert.measurementType))
                  return (
                    <View key={alert.id} style={styles.alertCard}>
                      <Text style={styles.alertTitle}>
                        ⚠ {alertLabel(alert.measurementType, alert.reason)} · {alert.deviceName}
                      </Text>
                      <Text style={styles.alertValue}>
                        {alert.lastValue}
                        {unitOf(alert)} (seuil {alert.threshold}
                        {unitOf(alert)})
                      </Text>
                      <Text style={styles.alertDate}>En cours depuis le {formatDateTime(alert.openedAt)}</Text>
                      {measurement && !measurement.fresh && (
                        <Text style={styles.alertStale}>Capteur silencieux : état actuel inconnu</Text>
                      )}
                    </View>
                  )
                })}
              </View>
            )}

            {resolvedAlerts.length > 0 && (
              <View style={styles.resolvedSection}>
                <TouchableOpacity onPress={() => setShowResolved((v) => !v)}>
                  <Text style={styles.resolvedToggle}>
                    {showResolved ? '▾' : '▸'} Revenues à la normale (24h) : {resolvedAlerts.length}
                  </Text>
                </TouchableOpacity>
                {showResolved &&
                  resolvedAlerts.map((alert) => (
                    <Text key={alert.id} style={styles.resolvedItem}>
                      {alertLabel(alert.measurementType, alert.reason)} · {alert.deviceName}, du {formatDateTime(alert.openedAt)} au{' '}
                      {formatDateTime(alert.resolvedAt as string)}
                    </Text>
                  ))}
              </View>
            )}

            {measurements && measurements.length === 0 ? (
              <Text style={styles.empty}>Aucune mesure reçue pour l'instant pour cette salle.</Text>
            ) : (
              measurements &&
              groupByDevice(measurements).map((group) => (
                <View key={group.deviceId} style={styles.card}>
                  <Text style={styles.deviceName}>{group.deviceName}</Text>
                  <View style={styles.metricsRow}>
                    {group.measurements.map((measurement, index) => {
                      const inAlert = alertKeys.has(metricKey(group.deviceId, measurement.type))
                      return (
                        <TouchableOpacity
                          key={measurement.type}
                          style={[
                            styles.metricColumn,
                            index > 0 && styles.metricColumnDivider,
                            !measurement.fresh && styles.metricColumnStale,
                            inAlert && styles.metricColumnAlert
                          ]}
                          onPress={() =>
                            onOpenHistory({ deviceId: group.deviceId, deviceName: group.deviceName, type: measurement.type })
                          }
                        >
                          <View style={styles.cardHeader}>
                            <Text style={styles.metricLabel}>{metricLabel(measurement.type)}</Text>
                            {inAlert && <Text style={styles.inAlertText}>En alerte</Text>}
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
                          <Text style={styles.historyHint}>Voir l'historique ›</Text>
                        </TouchableOpacity>
                      )
                    })}
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
  alertSection: {
    marginBottom: 12
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#991b1b',
    marginBottom: 8
  },
  alertCard: {
    backgroundColor: '#fef2f2',
    borderLeftWidth: 4,
    borderLeftColor: '#b91c1c',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8
  },
  alertTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#991b1b'
  },
  alertValue: {
    fontSize: 15,
    color: '#1f2937',
    marginTop: 4
  },
  alertDate: {
    fontSize: 13,
    color: '#4b5563',
    marginTop: 2
  },
  alertStale: {
    fontSize: 13,
    fontWeight: '600',
    color: '#92400e',
    marginTop: 4
  },
  resolvedSection: {
    marginBottom: 12
  },
  resolvedToggle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#166534'
  },
  resolvedItem: {
    fontSize: 13,
    color: '#374151',
    marginTop: 6
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
  metricColumnAlert: {
    borderWidth: 2,
    borderColor: '#b91c1c',
    borderRadius: 8,
    padding: 8
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
  inAlertText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#991b1b'
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
  historyHint: {
    fontSize: 11,
    color: '#2563eb',
    marginTop: 6
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
