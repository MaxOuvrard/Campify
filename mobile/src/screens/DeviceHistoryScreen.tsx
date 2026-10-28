import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { ApiError, fetchMetricHistory, HistoryBucket, MetricHistory } from '../api/client'
import { readCache, writeCache } from '../storage/cache'
import { formatBucketDuration, formatDateTime, formatTime, metricLabel } from '../utils/format'
import { HistoryTarget } from '../store/appStore'
import { colors } from '../theme/colors'

interface DeviceHistoryScreenProps {
  token: string
  target: HistoryTarget
  onBack: () => void
}

const BAR_WIDTH = 8
// Doit rester >= BAR_WIDTH + une marge, sinon deux intervalles consécutifs
// se chevauchent.
const PIXELS_PER_BUCKET = 12
const CHART_HEIGHT = 220
const TICK_AREA_HEIGHT = 22
const TICK_STEP_MS = 2 * 60 * 60 * 1000
const Y_AXIS_WIDTH = 44

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function bucketLabel(bucket: HistoryBucket, unit: string | null): string {
  const u = unit ? ` ${unit}` : ''
  return `${formatTime(bucket.start)} : moyenne ${round1(bucket.avg)}${u}, min ${round1(bucket.min)}, max ${round1(bucket.max)}`
}

export default function DeviceHistoryScreen({ token, target, onBack }: DeviceHistoryScreenProps) {
  const [history, setHistory] = useState<MetricHistory | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [dataAsOf, setDataAsOf] = useState<string | null>(null)
  const hasData = useRef(false)
  // Clé distincte de l'ancien cache (mesures brutes) : un cache écrit par une
  // version précédente de l'app n'a pas la même forme.
  const cacheKey = `device:${target.deviceId}:history:${target.type}:buckets`

  const load = useCallback(async () => {
    setLoading(!hasData.current)
    setError(null)
    try {
      // Le backend résume déjà toute la fenêtre (24h par défaut) en au plus
      // 500 intervalles de cette seule métrique — voir
      // domain/services/history.ts : rien à filtrer ni à moyenner ici, et
      // l'écran couvre vraiment 24h quel que soit le débit du capteur.
      const fresh = await fetchMetricHistory(token, target.deviceId, target.type)
      hasData.current = true
      setHistory(fresh)
      setDataAsOf(new Date().toISOString())
      void writeCache(cacheKey, fresh)
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
    void readCache<MetricHistory>(cacheKey).then((entry) => {
      if (cancelled || entry === null || hasData.current) return
      hasData.current = true
      setHistory(entry.data)
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
      <TouchableOpacity onPress={onBack} accessibilityRole="button" accessibilityLabel="Retour à la salle">
        <Text style={styles.back}>{'< Salle'}</Text>
      </TouchableOpacity>
      <Text style={styles.title} accessibilityRole="header">
        {metricLabel(target.type)}
      </Text>
      <Text style={styles.subtitle}>
        {target.deviceName} — dernières 24h{history ? `, moyenne par ${formatBucketDuration(history.bucketMs)}` : ''}
      </Text>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
            {error}
          </Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => void load()} accessibilityRole="button">
            <Text style={styles.retryButtonText}>Réessayer</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {dataAsOf && <Text style={styles.syncInfo}>Données du {formatDateTime(dataAsOf)}</Text>}
          {history && history.buckets.length === 0 ? (
            <Text style={styles.empty}>Aucune mesure sur les dernières 24h pour ce capteur.</Text>
          ) : (
            history && <HistoryChart history={history} />
          )}
        </>
      )}
    </View>
  )
}

function HistoryChart({ history }: { history: MetricHistory }) {
  const { buckets, bucketMs, unit } = history
  const u = unit ? ` ${unit}` : ''
  // Échelle des barres sur les moyennes ; les extrêmes affichés en tête
  // viennent des min/max des intervalles, pour qu'un pic bref reste lisible.
  const avgs = buckets.map((b) => b.avg)
  const low = Math.min(...avgs)
  const high = Math.max(...avgs)
  // Marge pour qu'une série plate (low === high) reste lisible au lieu de
  // donner des barres toutes à hauteur nulle ou toutes à hauteur max.
  const span = high - low || 1
  const lowest = Math.min(...buckets.map((b) => b.min))
  const highest = Math.max(...buckets.map((b) => b.max))
  const latest = buckets[buckets.length - 1]
  // Pas de "survol" sur mobile : on tape une barre pour l'épingler, l'entête
  // affiche alors son intervalle à la place de "Dernière valeur".
  const [selected, setSelected] = useState<HistoryBucket | null>(null)
  const shown = selected ?? latest
  const scrollRef = useRef<ScrollView>(null)

  // Axe temporel réel : une barre est placée à la position de son intervalle
  // dans la fenêtre, pas à un index — les périodes sans mesure (ex. capteur
  // silencieux) apparaissent comme un vrai espace vide.
  const windowStart = new Date(history.from).getTime()
  const windowEnd = new Date(history.to).getTime()
  const slots = Math.max(Math.ceil((windowEnd - windowStart) / bucketMs), 1)
  const chartWidth = slots * PIXELS_PER_BUCKET
  const xForTime = (ms: number) => {
    const slot = Math.floor((ms - windowStart) / bucketMs)
    return Math.min(Math.max(slot * PIXELS_PER_BUCKET, 0), chartWidth - BAR_WIDTH)
  }

  const ticks: { x: number; label: string }[] = []
  for (let t = windowStart; t <= windowEnd; t += TICK_STEP_MS) {
    ticks.push({ x: ((t - windowStart) / bucketMs) * PIXELS_PER_BUCKET, label: formatTime(new Date(t).toISOString()) })
  }

  return (
    <View style={styles.chartWrap}>
      <View style={styles.summaryRow}>
        <TouchableOpacity
          onPress={() => setSelected(null)}
          disabled={selected === null}
          style={styles.summaryTouchable}
          accessibilityRole={selected ? 'button' : 'text'}
          accessibilityLabel={selected ? bucketLabel(selected, unit) : `Dernier intervalle, ${bucketLabel(latest, unit)}`}
          accessibilityHint={selected ? 'Revient au dernier intervalle' : undefined}
        >
          <Text style={styles.summaryLabel}>
            {selected ? `${formatTime(selected.start)} (${formatBucketDuration(bucketMs)})` : 'Dernier intervalle'}
          </Text>
          <Text style={styles.summaryValue}>
            {round1(shown.avg)}
            {u}
          </Text>
          <Text style={styles.summaryLabel}>
            min {round1(shown.min)} · max {round1(shown.max)} · {shown.count} mesure{shown.count > 1 ? 's' : ''}
          </Text>
          {selected && <Text style={styles.summaryHint}>Toucher pour revenir au dernier intervalle</Text>}
        </TouchableOpacity>
        <View style={styles.summaryMinMax}>
          <Text style={styles.summaryMinMaxText}>min 24h {round1(lowest)}</Text>
          <Text style={styles.summaryMinMaxText}>max 24h {round1(highest)}</Text>
        </View>
      </View>

      <View style={styles.chartRow}>
        <View style={styles.yAxis}>
          <Text style={[styles.yAxisLabel, { top: -6 }]}>{round1(high)}</Text>
          <Text style={[styles.yAxisLabel, { top: CHART_HEIGHT / 2 - 6 }]}>{round1((low + high) / 2)}</Text>
          <Text style={[styles.yAxisLabel, { top: CHART_HEIGHT - 8 }]}>{round1(low)}</Text>
        </View>
        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chartScroll}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          <View style={[styles.chartCanvas, { width: chartWidth }]}>
            <View style={[styles.hGridLine, { top: 0 }]} />
            <View style={[styles.hGridLine, { top: CHART_HEIGHT / 2 }]} />
            <View style={[styles.hGridLine, { top: CHART_HEIGHT }]} />
            {ticks.map((tick) => (
              <View key={tick.x} style={[styles.gridLine, { left: tick.x }]} />
            ))}
            {buckets.map((bucket) => {
              const heightRatio = (bucket.avg - low) / span
              const barHeight = Math.max(4, heightRatio * CHART_HEIGHT)
              const isSelected = selected?.start === bucket.start
              return (
                <TouchableOpacity
                  key={bucket.start}
                  style={[styles.barTouchable, { left: xForTime(new Date(bucket.start).getTime()) }]}
                  activeOpacity={0.7}
                  hitSlop={{ left: 2, right: 2, top: 0, bottom: 0 }}
                  onPress={() => setSelected(bucket)}
                  accessibilityRole="button"
                  accessibilityLabel={bucketLabel(bucket, unit)}
                  accessibilityState={{ selected: isSelected }}
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
    color: colors.link,
    marginBottom: 8
  },
  title: {
    fontSize: 24,
    fontWeight: '700'
  },
  subtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 4
  },
  syncInfo: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 16
  },
  empty: {
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 24
  },
  error: {
    color: colors.danger,
    marginBottom: 12,
    textAlign: 'center'
  },
  retryButton: {
    backgroundColor: colors.filledPrimary,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 20
  },
  retryButtonText: {
    color: colors.onFilled,
    fontWeight: '600'
  },
  chartWrap: {
    backgroundColor: colors.surface,
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
    color: colors.textMuted
  },
  summaryValue: {
    fontSize: 28,
    fontWeight: '700'
  },
  summaryHint: {
    fontSize: 12,
    color: colors.link,
    marginTop: 2
  },
  summaryMinMax: {
    alignItems: 'flex-end'
  },
  summaryMinMaxText: {
    fontSize: 12,
    color: colors.textMuted
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
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary
  },
  chartScroll: {
    // Marge pour que les repères d'heure du tout premier et du tout dernier
    // point (qui débordent de leur colonne de 20px de chaque côté, voir
    // tickLabel) restent lisibles au lieu d'être coupés par le bord du
    // défilement.
    paddingHorizontal: 22
  },
  chartCanvas: {
    height: CHART_HEIGHT + TICK_AREA_HEIGHT,
    position: 'relative'
  },
  gridLine: {
    position: 'absolute',
    top: 0,
    width: 1,
    height: CHART_HEIGHT,
    backgroundColor: colors.divider
  },
  hGridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: colors.divider
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
    backgroundColor: colors.filledPrimary,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2
  },
  barSelected: {
    backgroundColor: colors.filledDanger
  },
  tickLabel: {
    position: 'absolute',
    top: CHART_HEIGHT + 4,
    width: 50,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center'
  },
  hint: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 8,
    textAlign: 'center'
  }
})
