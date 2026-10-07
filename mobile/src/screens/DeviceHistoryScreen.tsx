import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { ApiError, fetchDeviceHistory, HistoryPoint } from '../api/client'
import { readCache, writeCache } from '../storage/cache'
import { formatDateTime, formatTime, metricLabel } from '../utils/format'
import { HistoryTarget } from '../store/appStore'

interface DeviceHistoryScreenProps {
  token: string
  target: HistoryTarget
  onBack: () => void
}

const BAR_WIDTH = 8
const CHART_HEIGHT = 220
const TICK_AREA_HEIGHT = 22
const WINDOW_HOURS = 24
// Doit rester >= BAR_WIDTH + une marge, sinon deux minutes consécutives se
// chevauchent.
const PIXELS_PER_MINUTE = 12
const CHART_WIDTH = WINDOW_HOURS * 60 * PIXELS_PER_MINUTE
const TICK_STEP_HOURS = 2
const Y_AXIS_WIDTH = 44

/**
 * Regroupe les points par minute (moyenne des valeurs de chaque minute) —
 * le kit publie environ toutes les 2s, sans ça une fenêtre de 24h afficherait
 * jusqu'à 500 barres quasi collées, illisibles. Suppose `points` déjà trié
 * du plus ancien au plus récent (garanti par le backend, voir history.ts).
 *
 * La minute en cours au moment de l'appel est exclue : elle n'a souvent
 * reçu qu'une ou deux mesures (pas les ~30 d'une minute complète), donc sa
 * "moyenne" n'est pas comparable aux barres précédentes et fait sauter la
 * dernière barre du graphique sans raison réelle.
 */
function aggregateByMinute(points: HistoryPoint[], now: Date): HistoryPoint[] {
  const currentMinute = new Date(now)
  currentMinute.setSeconds(0, 0)
  const currentMinuteKey = currentMinute.toISOString()

  const buckets = new Map<string, { sum: number; count: number; sample: HistoryPoint }>()
  for (const point of points) {
    const minute = new Date(point.timestamp)
    minute.setSeconds(0, 0)
    const key = minute.toISOString()
    if (key === currentMinuteKey) continue
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.sum += point.value
      bucket.count += 1
    } else {
      buckets.set(key, { sum: point.value, count: 1, sample: point })
    }
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, bucket]) => ({
      ...bucket.sample,
      timestamp: key,
      value: Math.round((bucket.sum / bucket.count) * 100) / 100
    }))
}

export default function DeviceHistoryScreen({ token, target, onBack }: DeviceHistoryScreenProps) {
  const [points, setPoints] = useState<HistoryPoint[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [dataAsOf, setDataAsOf] = useState<string | null>(null)
  const hasData = useRef(false)
  const cacheKey = `device:${target.deviceId}:history:${target.type}`

  const load = useCallback(async () => {
    setLoading(!hasData.current)
    setError(null)
    try {
      // L'API renvoie tous les types de mesure du device sur la fenêtre par
      // défaut (24h, voir domain/services/history.ts côté backend) — on ne
      // garde ici que le type demandé, déjà trié du plus ancien au plus récent,
      // puis on moyenne minute par minute pour ne pas afficher jusqu'à 500
      // barres quasi collées.
      const all = await fetchDeviceHistory(token, target.deviceId)
      const filtered = all.filter((point) => point.type === target.type)
      const aggregated = aggregateByMinute(filtered, new Date())
      hasData.current = true
      setPoints(aggregated)
      setDataAsOf(new Date().toISOString())
      void writeCache(cacheKey, aggregated)
    } catch (err) {
      if (!hasData.current) {
        setError(err instanceof ApiError ? err.message : 'Erreur inattendue')
      }
    } finally {
      setLoading(false)
    }
  }, [token, target.deviceId, target.type, cacheKey])

  useEffect(() => {
    let cancelled = false
    hasData.current = false
    void readCache<HistoryPoint[]>(cacheKey).then((entry) => {
      if (cancelled || entry === null || hasData.current) return
      hasData.current = true
      setPoints(entry.data)
      setDataAsOf(entry.cachedAt)
      setLoading(false)
    })
    void load()
    return () => {
      cancelled = true
    }
  }, [load, cacheKey])

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={onBack}>
        <Text style={styles.back}>{'< Salle'}</Text>
      </TouchableOpacity>
      <Text style={styles.title}>{metricLabel(target.type)}</Text>
      <Text style={styles.subtitle}>{target.deviceName} — dernières 24h</Text>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => void load()}>
            <Text style={styles.retryButtonText}>Réessayer</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {dataAsOf && <Text style={styles.syncInfo}>Données du {formatDateTime(dataAsOf)}</Text>}
          {points && points.length === 0 ? (
            <Text style={styles.empty}>Aucune mesure sur les dernières 24h pour ce capteur.</Text>
          ) : (
            points && <HistoryChart points={points} windowEnd={dataAsOf ? new Date(dataAsOf) : new Date()} />
          )}
        </>
      )}
    </View>
  )
}

function HistoryChart({ points, windowEnd }: { points: HistoryPoint[]; windowEnd: Date }) {
  const values = points.map((p) => p.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  // Marge pour qu'une série plate (min === max) reste lisible au lieu de
  // donner des barres toutes à hauteur nulle ou toutes à hauteur max.
  const span = max - min || 1
  const latest = points[points.length - 1]
  // Pas de "survol" sur mobile : on tape une barre pour l'épingler, l'entête
  // affiche alors sa valeur et son heure à la place de "Dernière valeur".
  const [selected, setSelected] = useState<HistoryPoint | null>(null)
  const shown = selected ?? latest
  const scrollRef = useRef<ScrollView>(null)

  // Axe temporel réel sur 24h fixes : une barre est positionnée à l'endroit
  // exact de sa minute dans la fenêtre, pas à un index — les périodes sans
  // mesure (ex. capteur silencieux) apparaissent comme un vrai espace vide
  // plutôt que d'être invisiblement comprimées entre deux barres voisines.
  const windowStart = new Date(windowEnd.getTime() - WINDOW_HOURS * 60 * 60 * 1000)
  const xForTime = (iso: string) => {
    const minutesFromStart = (new Date(iso).getTime() - windowStart.getTime()) / 60000
    return Math.min(Math.max(minutesFromStart * PIXELS_PER_MINUTE, 0), CHART_WIDTH - BAR_WIDTH)
  }

  const ticks: { x: number; label: string }[] = []
  for (let h = 0; h <= WINDOW_HOURS; h += TICK_STEP_HOURS) {
    const tickDate = new Date(windowStart.getTime() + h * 60 * 60 * 1000)
    ticks.push({ x: h * 60 * PIXELS_PER_MINUTE, label: formatTime(tickDate.toISOString()) })
  }

  return (
    <View style={styles.chartWrap}>
      <View style={styles.summaryRow}>
        <TouchableOpacity onPress={() => setSelected(null)} disabled={selected === null} style={styles.summaryTouchable}>
          <Text style={styles.summaryLabel}>{selected ? formatTime(selected.timestamp) : 'Dernière valeur'}</Text>
          <Text style={styles.summaryValue}>
            {shown.value}
            {shown.unit ? ` ${shown.unit}` : ''}
          </Text>
          {selected && <Text style={styles.summaryHint}>Toucher pour revenir à la dernière valeur</Text>}
        </TouchableOpacity>
        <View style={styles.summaryMinMax}>
          <Text style={styles.summaryMinMaxText}>min {min}</Text>
          <Text style={styles.summaryMinMaxText}>max {max}</Text>
        </View>
      </View>

      <View style={styles.chartRow}>
        <View style={styles.yAxis}>
          <Text style={[styles.yAxisLabel, { top: -6 }]}>{max}</Text>
          <Text style={[styles.yAxisLabel, { top: CHART_HEIGHT / 2 - 6 }]}>{Math.round(((min + max) / 2) * 10) / 10}</Text>
          <Text style={[styles.yAxisLabel, { top: CHART_HEIGHT - 8 }]}>{min}</Text>
        </View>
        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chartScroll}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          <View style={styles.chartCanvas}>
            <View style={[styles.hGridLine, { top: 0 }]} />
            <View style={[styles.hGridLine, { top: CHART_HEIGHT / 2 }]} />
            <View style={[styles.hGridLine, { top: CHART_HEIGHT }]} />
            {ticks.map((tick) => (
              <View key={tick.x} style={[styles.gridLine, { left: tick.x }]} />
            ))}
            {points.map((point) => {
              const heightRatio = (point.value - min) / span
              const barHeight = Math.max(4, heightRatio * CHART_HEIGHT)
              const isSelected = selected?.id === point.id
              return (
                <TouchableOpacity
                  key={point.id}
                  style={[styles.barTouchable, { left: xForTime(point.timestamp) }]}
                  activeOpacity={0.7}
                  hitSlop={{ left: 3, right: 3, top: 0, bottom: 0 }}
                  onPress={() => setSelected(point)}
                >
                  <View style={[styles.bar, { height: barHeight }, isSelected && styles.barSelected]} />
                </TouchableOpacity>
              )
            })}
            {ticks.map((tick) => (
              <Text key={tick.x} style={[styles.tickLabel, { left: tick.x - 20 }]} numberOfLines={1}>
                {tick.label}
              </Text>
            ))}
          </View>
        </ScrollView>
      </View>
      <Text style={styles.hint}>Fais défiler pour parcourir les 24h — les espaces vides sont des périodes sans mesure</Text>
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
  back: {
    color: '#2563eb',
    marginBottom: 8
  },
  title: {
    fontSize: 24,
    fontWeight: '700'
  },
  subtitle: {
    fontSize: 13,
    color: '#666',
    marginBottom: 4
  },
  syncInfo: {
    fontSize: 12,
    color: '#888',
    marginBottom: 16
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
  },
  chartWrap: {
    backgroundColor: '#f4f6f8',
    borderRadius: 12,
    padding: 16
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 16
  },
  summaryTouchable: {
    flexShrink: 1
  },
  summaryLabel: {
    fontSize: 12,
    color: '#888'
  },
  summaryValue: {
    fontSize: 28,
    fontWeight: '700'
  },
  summaryHint: {
    fontSize: 11,
    color: '#2563eb',
    marginTop: 2
  },
  summaryMinMax: {
    alignItems: 'flex-end'
  },
  summaryMinMaxText: {
    fontSize: 12,
    color: '#888'
  },
  chartRow: {
    flexDirection: 'row'
  },
  yAxis: {
    width: Y_AXIS_WIDTH,
    height: CHART_HEIGHT + TICK_AREA_HEIGHT,
    position: 'relative'
  },
  yAxisLabel: {
    position: 'absolute',
    right: 8,
    fontSize: 11,
    fontWeight: '600',
    color: '#666'
  },
  chartScroll: {
    // Marge pour que les repères d'heure du tout premier et du tout dernier
    // point (qui débordent de leur colonne de 20px de chaque côté, voir
    // tickLabel) restent lisibles au lieu d'être coupés par le bord du
    // défilement.
    paddingHorizontal: 22
  },
  chartCanvas: {
    width: CHART_WIDTH,
    height: CHART_HEIGHT + TICK_AREA_HEIGHT,
    position: 'relative'
  },
  gridLine: {
    position: 'absolute',
    top: 0,
    width: 1,
    height: CHART_HEIGHT,
    backgroundColor: '#e2e5e9'
  },
  hGridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: '#e2e5e9'
  },
  barTouchable: {
    position: 'absolute',
    bottom: TICK_AREA_HEIGHT,
    height: CHART_HEIGHT,
    width: BAR_WIDTH,
    justifyContent: 'flex-end'
  },
  bar: {
    width: BAR_WIDTH,
    backgroundColor: '#2563eb',
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2
  },
  barSelected: {
    backgroundColor: '#c0392b'
  },
  tickLabel: {
    position: 'absolute',
    top: CHART_HEIGHT + 4,
    width: 50,
    fontSize: 10,
    color: '#888',
    textAlign: 'center'
  },
  hint: {
    fontSize: 11,
    color: '#aaa',
    marginTop: 8,
    textAlign: 'center'
  }
})
