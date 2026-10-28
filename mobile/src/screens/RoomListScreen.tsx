import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { ApiError, fetchRooms, Room } from '../api/client'
import { readCache, writeCache } from '../storage/cache'
import { useNetworkStatus } from '../hooks/useNetworkStatus'
import { useAppForeground } from '../hooks/useAppForeground'
import { usePeriodicRefresh } from '../hooks/usePeriodicRefresh'
import { formatDateTime, openAlertCountLabel } from '../utils/format'
import { colors } from '../theme/colors'

interface RoomListScreenProps {
  token: string
  onSelectRoom: (room: Room) => void
}

const CACHE_KEY = 'rooms'

// Salles en alerte d'abord (les plus touchées en tête), puis ordre
// alphabétique : avec plusieurs salles, le problème se voit sans défiler.
// Une ligne est lue d'un seul tenant par le lecteur d'écran : tout ce que
// montrent les badges doit donc aussi être dans le libellé.
export function roomAccessibilityLabel(room: Room): string {
  const parts = [room.name]
  if (room.openAlertCount > 0) parts.push(openAlertCountLabel(room.openAlertCount))
  if (room.hasSilentDevice) parts.push('capteur silencieux')
  return parts.join(', ')
}

export function sortRooms(rooms: Room[]): Room[] {
  return [...rooms].sort((a, b) => (b.openAlertCount ?? 0) - (a.openAlertCount ?? 0) || a.name.localeCompare(b.name))
}

export default function RoomListScreen({ token, onSelectRoom }: RoomListScreenProps) {
  const [rooms, setRooms] = useState<Room[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // Date des données actuellement affichées : celle du dernier fetch réussi,
  // ou celle du cache tant qu'aucun fetch n'a encore abouti — toujours
  // renseignée, pour qu'on sache d'un coup d'œil si ce qu'on regarde est à
  // jour ou périmé, réseau coupé ou pas.
  const [dataAsOf, setDataAsOf] = useState<string | null>(null)
  const isConnected = useNetworkStatus()
  const hasData = useRef(false)

  const load = useCallback(async () => {
    setLoading(!hasData.current)
    setError(null)
    try {
      const fresh = await fetchRooms(token)
      hasData.current = true
      setRooms(fresh)
      setDataAsOf(new Date().toISOString())
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
      setDataAsOf(entry.cachedAt)
      setLoading(false)
    })
    void load()
    return () => {
      cancelled = true
    }
  }, [load])

  useAppForeground(() => void load())
  usePeriodicRefresh(() => void load())

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
        <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
          {error}
        </Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => void load()} accessibilityRole="button">
          <Text style={styles.retryButtonText}>Réessayer</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title} accessibilityRole="header">
        Salles
      </Text>
      {dataAsOf && <Text style={styles.syncInfo}>Données du {formatDateTime(dataAsOf)}</Text>}
      {isConnected === false && (
        <View style={styles.banner} accessible accessibilityRole="alert" accessibilityLiveRegion="polite">
          <Text style={styles.bannerText}>Téléphone hors ligne — affichage des dernières données reçues</Text>
        </View>
      )}
      <FlatList
        data={sortRooms(rooms ?? [])}
        keyExtractor={(room) => room.id}
        ListEmptyComponent={<Text style={styles.empty}>Aucune salle enregistrée.</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.row}
            onPress={() => onSelectRoom(item)}
            accessibilityRole="button"
            accessibilityLabel={roomAccessibilityLabel(item)}
            accessibilityHint="Ouvre le détail de la salle"
          >
            <Text style={styles.roomName}>{item.name}</Text>
            <View style={styles.badges}>
              {item.openAlertCount > 0 && (
                <View style={styles.alertBadge}>
                  <Text style={styles.alertBadgeText}>{openAlertCountLabel(item.openAlertCount)}</Text>
                </View>
              )}
              {item.hasSilentDevice && (
                <View style={styles.silentBadge}>
                  <Text style={styles.silentBadgeText}>⚠️ Capteur silencieux</Text>
                </View>
              )}
            </View>
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
    padding: 24,
    marginTop: 36
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
    marginBottom: 4
  },
  syncInfo: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 12
  },
  banner: {
    backgroundColor: colors.warningSurface,
    borderRadius: 8,
    padding: 10,
    marginBottom: 12
  },
  bannerText: {
    color: colors.warning,
    fontSize: 13,
    textAlign: 'center'
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator
  },
  roomName: {
    fontSize: 17
  },
  badges: {
    alignItems: 'flex-end',
    gap: 4
  },
  alertBadge: {
    backgroundColor: colors.filledAlert,
    borderRadius: 6,
    paddingVertical: 2,
    paddingHorizontal: 8
  },
  alertBadgeText: {
    color: colors.onFilled,
    fontSize: 12,
    fontWeight: '700'
  },
  silentBadge: {
    backgroundColor: colors.silentSurface,
    borderRadius: 6,
    paddingVertical: 2,
    paddingHorizontal: 8
  },
  silentBadgeText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '600'
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
  }
})
