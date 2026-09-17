import { act, render } from '@testing-library/react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import NetInfo from '@react-native-community/netinfo'
import { AppState, AppStateStatus } from 'react-native'
import RoomDetailScreen from '../RoomDetailScreen'
import * as client from '../../api/client'
import { LatestMeasurement, Room } from '../../api/client'

jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client')
  return { ...actual, fetchLatestMeasurements: jest.fn() }
})

const fetchLatestMeasurements = client.fetchLatestMeasurements as jest.Mock

const room: Room = { id: 'room-1', name: 'Salle A', createdAt: '2026-01-01T00:00:00.000Z' }

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
    await AsyncStorage.clear()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('coupure réseau : les mesures affichées restent à l’écran et une bannière hors-ligne apparaît', async () => {
    fetchLatestMeasurements.mockResolvedValueOnce([measurement({ value: 21 })])
    const netInfo = mockNetInfoListener()
    mockAppStateListener('active')

    const view = await render(<RoomDetailScreen token="t" room={room} onBack={() => {}} onScanDevice={() => {}} />)
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

    const view = await render(<RoomDetailScreen token="t" room={room} onBack={() => {}} onScanDevice={() => {}} />)
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

    const view = await render(<RoomDetailScreen token="t" room={room} onBack={() => {}} onScanDevice={() => {}} />)
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

    const view = await render(<RoomDetailScreen token="t" room={room} onBack={() => {}} onScanDevice={() => {}} />)

    await view.findByText('Capteur silencieux')
    expect(view.getByText('21 °C')).toBeTruthy()
  })
})
