import { act, fireEvent, render } from '@testing-library/react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import NetInfo from '@react-native-community/netinfo'
import { AppState, AppStateStatus } from 'react-native'
import RoomDetailScreen from '../RoomDetailScreen'
import * as client from '../../api/client'
import { LatestMeasurement, Room, RoomAlert } from '../../api/client'
import { REFRESH_INTERVAL_MS } from '../../hooks/usePeriodicRefresh'

jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client')
  return { ...actual, fetchLatestMeasurements: jest.fn(), fetchRoomAlerts: jest.fn() }
})

const fetchLatestMeasurements = client.fetchLatestMeasurements as jest.Mock
const fetchRoomAlerts = client.fetchRoomAlerts as jest.Mock

const room: Room = { id: 'room-1', name: 'Salle A', createdAt: '2026-01-01T00:00:00.000Z', hasSilentDevice: false, openAlertCount: 0 }

function measurement(overrides: Partial<LatestMeasurement> = {}): LatestMeasurement {
  return {
    id: 'm1',
    deviceId: 'd1',
    deviceName: 'Capteur 1',
    type: 'temperature',
    value: 21,
    unit: '°C',
    timestamp: '2026-01-01T10:00:00.000Z',
    receivedAt: '2026-01-01T10:00:00.000Z',
    fresh: true,
    ...overrides
  }
}

type NetInfoState = { isConnected: boolean | null; isInternetReachable: boolean | null }

function mockNetInfoListener() {
  let listener: (state: NetInfoState) => void = () => {}
  ;(NetInfo.addEventListener as jest.Mock).mockImplementation((cb: (state: NetInfoState) => void) => {
    listener = cb
    return jest.fn()
  })
  return { emit: (state: NetInfoState) => act(async () => listener(state)) }
}

function mockAppStateListener(initial: AppStateStatus) {
  AppState.currentState = initial
  let handler: (state: AppStateStatus) => void = () => {}
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, cb) => {
    handler = cb as (state: AppStateStatus) => void
    return { remove: jest.fn() }
  })
  return {
    goTo: (state: AppStateStatus) => {
      AppState.currentState = state
      return act(async () => handler(state))
    }
  }
}

describe('RoomDetailScreen — coupure réseau, retour réseau, reprise de l’app', () => {
  beforeEach(async () => {
    fetchLatestMeasurements.mockReset()
    fetchRoomAlerts.mockReset()
    fetchRoomAlerts.mockResolvedValue([])
    await AsyncStorage.clear()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('coupure réseau : les mesures affichées restent à l’écran et une bannière hors-ligne apparaît', async () => {
    fetchLatestMeasurements.mockResolvedValueOnce([measurement({ value: 21 })])
    const netInfo = mockNetInfoListener()
    mockAppStateListener('active')

    const view = await render(<RoomDetailScreen token="t" room={room} onBack={() => {}} onScanDevice={() => {}} onOpenHistory={() => {}} />)
    await view.findByText('21 °C')

    await netInfo.emit({ isConnected: false, isInternetReachable: false })

    expect(view.getByText(/Téléphone hors ligne/)).toBeTruthy()
    // La donnée déjà affichée n'a pas été effacée par la coupure.
    expect(view.getByText('21 °C')).toBeTruthy()
    expect(fetchLatestMeasurements).toHaveBeenCalledTimes(1)
  })

  it('retour réseau : redemande automatiquement les mesures et remplace l’ancienne valeur par la nouvelle', async () => {
    fetchLatestMeasurements.mockResolvedValueOnce([measurement({ value: 21 })])
    const netInfo = mockNetInfoListener()
    mockAppStateListener('active')

    const view = await render(<RoomDetailScreen token="t" room={room} onBack={() => {}} onScanDevice={() => {}} onOpenHistory={() => {}} />)
    await view.findByText('21 °C')

    await netInfo.emit({ isConnected: false, isInternetReachable: false })
    expect(view.getByText(/Téléphone hors ligne/)).toBeTruthy()

    fetchLatestMeasurements.mockResolvedValueOnce([measurement({ value: 23 })])
    await netInfo.emit({ isConnected: true, isInternetReachable: true })

    await view.findByText('23 °C')
    expect(view.queryByText(/Téléphone hors ligne/)).toBeNull()
    expect(fetchLatestMeasurements).toHaveBeenCalledTimes(2)
  })

  it('reprise de l’app : un retour au premier plan redemande les mesures', async () => {
    fetchLatestMeasurements.mockResolvedValueOnce([measurement({ value: 21 })])
    mockNetInfoListener()
    const appState = mockAppStateListener('background')

    const view = await render(<RoomDetailScreen token="t" room={room} onBack={() => {}} onScanDevice={() => {}} onOpenHistory={() => {}} />)
    await view.findByText('21 °C')

    fetchLatestMeasurements.mockResolvedValueOnce([measurement({ value: 19 })])
    await appState.goTo('active')

    await view.findByText('19 °C')
    expect(fetchLatestMeasurements).toHaveBeenCalledTimes(2)
  })

  it('capteur silencieux : une mesure non fraîche reste affichée avec son badge, sans faire disparaître la salle', async () => {
    fetchLatestMeasurements.mockResolvedValueOnce([measurement({ value: 21, fresh: false })])
    mockNetInfoListener()
    mockAppStateListener('active')

    const view = await render(<RoomDetailScreen token="t" room={room} onBack={() => {}} onScanDevice={() => {}} onOpenHistory={() => {}} />)

    await view.findByText('Capteur silencieux')
    expect(view.getByText('21 °C')).toBeTruthy()
  })
})

function alert(overrides: Partial<RoomAlert> = {}): RoomAlert {
  return {
    id: 'a1',
    deviceId: 'd1',
    deviceName: 'Capteur 1',
    measurementType: 'co2',
    reason: 'above_max',
    threshold: 1000,
    triggerValue: 1200,
    openedAt: '2026-01-01T09:00:00.000Z',
    lastValue: 1250,
    lastSeenAt: '2026-01-01T10:00:00.000Z',
    resolvedAt: null,
    resolvedValue: null,
    status: 'open',
    ...overrides
  }
}

const co2 = (overrides: Partial<LatestMeasurement> = {}) => measurement({ type: 'co2', value: 1250, unit: 'ppm', ...overrides })

function renderScreen() {
  return render(<RoomDetailScreen token="t" room={room} onBack={() => {}} onScanDevice={() => {}} onOpenHistory={() => {}} />)
}

describe('RoomDetailScreen — alertes', () => {
  beforeEach(async () => {
    fetchLatestMeasurements.mockReset()
    fetchRoomAlerts.mockReset()
    mockNetInfoListener()
    mockAppStateListener('active')
    await AsyncStorage.clear()
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('affiche une alerte en cours avec son libellé, sa valeur, son seuil et sa date, et marque la métrique', async () => {
    fetchLatestMeasurements.mockResolvedValue([co2()])
    fetchRoomAlerts.mockResolvedValue([alert()])

    const view = await renderScreen()

    await view.findByText('Alertes en cours')
    expect(view.getByText('⚠ CO₂ trop élevé · Capteur 1')).toBeTruthy()
    expect(view.getByText('1250 ppm (seuil 1000 ppm)')).toBeTruthy()
    expect(view.getByText(/^En cours depuis le/)).toBeTruthy()
    expect(view.getByText('En alerte')).toBeTruthy()
    expect(view.queryByText(/Capteur silencieux : état actuel inconnu/)).toBeNull()
  })

  it("n'affiche pas de bloc d'alertes quand il n'y en a aucune", async () => {
    fetchLatestMeasurements.mockResolvedValue([co2({ value: 600 })])
    fetchRoomAlerts.mockResolvedValue([])

    const view = await renderScreen()

    await view.findByText('600 ppm')
    expect(view.queryByText('Alertes en cours')).toBeNull()
    expect(view.queryByText('En alerte')).toBeNull()
  })

  it('signale une alerte dont le capteur s’est tu : état actuel inconnu', async () => {
    fetchLatestMeasurements.mockResolvedValue([co2({ fresh: false })])
    fetchRoomAlerts.mockResolvedValue([alert()])

    const view = await renderScreen()

    await view.findByText('Capteur silencieux : état actuel inconnu')
  })

  it('range les alertes résolues dans « Revenues à la normale », dépliable', async () => {
    fetchLatestMeasurements.mockResolvedValue([co2({ value: 800 })])
    fetchRoomAlerts.mockResolvedValue([alert({ status: 'resolved', resolvedAt: '2026-01-01T09:30:00.000Z', resolvedValue: 880 })])

    const view = await renderScreen()

    const toggle = await view.findByText(/Revenues à la normale \(24h\) : 1/)
    expect(view.queryByText('Alertes en cours')).toBeNull()
    expect(view.queryByText(/^CO₂ trop élevé · Capteur 1, du/)).toBeNull()

    await fireEvent.press(toggle)

    expect(view.getByText(/^CO₂ trop élevé · Capteur 1, du/)).toBeTruthy()
  })

  it("échec des alertes : les mesures restent affichées et l'écran dit « Alertes indisponibles », pas « aucune alerte »", async () => {
    fetchLatestMeasurements.mockResolvedValue([co2()])
    fetchRoomAlerts.mockRejectedValue(new client.ApiError('Erreur serveur', 500))

    const view = await renderScreen()

    await view.findByText('Alertes indisponibles')
    expect(view.getByText('1250 ppm')).toBeTruthy()
    expect(view.queryByText(/Impossible|Erreur serveur/)).toBeNull()
  })

  it('échec des alertes après un premier succès : garde la dernière liste connue et le dit', async () => {
    fetchLatestMeasurements.mockResolvedValue([co2()])
    fetchRoomAlerts.mockResolvedValueOnce([alert()])
    const appState = mockAppStateListener('active')

    const view = await renderScreen()
    await view.findByText('Alertes en cours')

    fetchRoomAlerts.mockRejectedValueOnce(new client.ApiError('Impossible de joindre le serveur'))
    await appState.goTo('background')
    await appState.goTo('active')

    await view.findByText(/^Alertes indisponibles — dernière liste connue du/)
    expect(view.getByText('⚠ CO₂ trop élevé · Capteur 1')).toBeTruthy()
  })

  it("rafraîchit toutes les 30 s : une alerte ouverte pendant qu'on regarde l'écran apparaît sans action", async () => {
    jest.useFakeTimers()
    fetchLatestMeasurements.mockResolvedValue([co2({ value: 900 })])
    fetchRoomAlerts.mockResolvedValueOnce([])

    const view = await renderScreen()
    await view.findByText('900 ppm')
    expect(view.queryByText('Alertes en cours')).toBeNull()

    fetchLatestMeasurements.mockResolvedValue([co2({ value: 1250 })])
    fetchRoomAlerts.mockResolvedValue([alert()])
    await act(async () => {
      jest.advanceTimersByTime(REFRESH_INTERVAL_MS)
    })

    await view.findByText('Alertes en cours')
    expect(view.getByText('1250 ppm')).toBeTruthy()
    expect(fetchRoomAlerts).toHaveBeenCalledTimes(2)
  })
})
