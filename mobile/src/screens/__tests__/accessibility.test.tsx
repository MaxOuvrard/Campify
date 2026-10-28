import { fireEvent, render } from '@testing-library/react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import LoginScreen from '../LoginScreen'
import RoomListScreen from '../RoomListScreen'
import RoomDetailScreen from '../RoomDetailScreen'
import DeviceHistoryScreen from '../DeviceHistoryScreen'
import * as client from '../../api/client'
import { LatestMeasurement, Room, RoomAlert } from '../../api/client'

// Ce que perçoit un lecteur d'écran (TalkBack/VoiceOver) : chaque élément
// actionnable est trouvé par son rôle et son nom, les erreurs ont le rôle
// `alert` (annoncées à leur apparition), les champs ont un libellé.

jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client')
  return {
    ...actual,
    login: jest.fn(),
    fetchRooms: jest.fn(),
    fetchLatestMeasurements: jest.fn(),
    fetchRoomAlerts: jest.fn(),
    fetchDeviceHistory: jest.fn()
  }
})

const login = client.login as jest.Mock
const fetchRooms = client.fetchRooms as jest.Mock
const fetchLatestMeasurements = client.fetchLatestMeasurements as jest.Mock
const fetchRoomAlerts = client.fetchRoomAlerts as jest.Mock
const fetchDeviceHistory = client.fetchDeviceHistory as jest.Mock

const room: Room = { id: 'room-1', name: 'Salle A', createdAt: '2026-01-01T00:00:00.000Z', hasSilentDevice: false, openAlertCount: 0 }

const co2: LatestMeasurement = {
  id: 'm1',
  deviceId: 'd1',
  deviceName: 'Capteur 1',
  type: 'co2',
  value: 1250,
  unit: 'ppm',
  timestamp: '2026-01-01T10:00:00.000Z',
  receivedAt: '2026-01-01T10:00:00.000Z',
  fresh: true
}

const openAlert: RoomAlert = {
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
  status: 'open'
}

beforeEach(async () => {
  // Uniquement les mocks du client : `resetAllMocks` viderait aussi ceux de
  // NetInfo/AppState posés par jest.setup.ts.
  for (const mock of [login, fetchRooms, fetchLatestMeasurements, fetchRoomAlerts, fetchDeviceHistory]) mock.mockReset()
  await AsyncStorage.clear()
})

describe('LoginScreen', () => {
  it('expose des champs libellés et un bouton nommé', async () => {
    const view = await render(<LoginScreen onLoggedIn={() => {}} />)

    expect(view.getByLabelText('Email')).toBeTruthy()
    expect(view.getByLabelText('Mot de passe')).toBeTruthy()
    expect(view.getByRole('button', { name: 'Se connecter' })).toBeTruthy()
    expect(view.getByRole('header', { name: 'Campify' })).toBeTruthy()
  })

  it("annonce l'erreur de connexion (rôle alert)", async () => {
    login.mockRejectedValueOnce(new client.ApiError('Email ou mot de passe incorrect', 401))
    const view = await render(<LoginScreen onLoggedIn={() => {}} />)

    await fireEvent.press(view.getByRole('button', { name: 'Se connecter' }))

    expect(await view.findByRole('alert')).toHaveTextContent('Email ou mot de passe incorrect')
  })
})

describe('RoomListScreen', () => {
  it('annonce chaque salle comme un bouton portant ses badges dans son nom', async () => {
    fetchRooms.mockResolvedValueOnce([{ ...room, openAlertCount: 2, hasSilentDevice: true }])
    const view = await render(<RoomListScreen token="t" onSelectRoom={() => {}} />)

    expect(await view.findByRole('button', { name: 'Salle A, 2 alertes en cours, capteur silencieux' })).toBeTruthy()
    expect(view.getByRole('header', { name: 'Salles' })).toBeTruthy()
  })

  it("annonce l'erreur de chargement et propose un bouton Réessayer", async () => {
    fetchRooms.mockRejectedValueOnce(new client.ApiError('Impossible de joindre le serveur'))
    const view = await render(<RoomListScreen token="t" onSelectRoom={() => {}} />)

    expect(await view.findByRole('alert')).toHaveTextContent('Impossible de joindre le serveur')
    expect(view.getByRole('button', { name: 'Réessayer' })).toBeTruthy()
  })
})

describe('RoomDetailScreen', () => {
  function renderDetail() {
    return render(<RoomDetailScreen token="t" room={room} onBack={() => {}} onScanDevice={() => {}} onOpenHistory={() => {}} />)
  }

  it('nomme le retour « Retour aux salles » plutôt que « < Salles »', async () => {
    fetchLatestMeasurements.mockResolvedValue([co2])
    fetchRoomAlerts.mockResolvedValue([])
    const view = await renderDetail()

    expect(await view.findByRole('button', { name: 'Retour aux salles' })).toBeTruthy()
    expect(view.getByRole('button', { name: 'Scanner un équipement' })).toBeTruthy()
  })

  it("annonce l'alerte en entier et la métrique en alerte comme bouton vers l'historique", async () => {
    fetchLatestMeasurements.mockResolvedValue([co2])
    fetchRoomAlerts.mockResolvedValue([openAlert])
    const view = await renderDetail()

    expect(await view.findByLabelText(/^Alerte : CO₂ trop élevé, Capteur 1, 1250 ppm, seuil 1000 ppm, en cours depuis le/)).toBeTruthy()
    expect(view.getByRole('button', { name: 'CO₂ 1250 ppm, en alerte' })).toBeTruthy()
    expect(view.getByRole('header', { name: 'Alertes en cours' })).toBeTruthy()
  })

  it('annonce l’état replié/déplié de « Revenues à la normale »', async () => {
    fetchLatestMeasurements.mockResolvedValue([co2])
    fetchRoomAlerts.mockResolvedValue([{ ...openAlert, status: 'resolved', resolvedAt: '2026-01-01T09:30:00.000Z', resolvedValue: 880 }])
    const view = await renderDetail()

    const toggle = await view.findByRole('button', { name: 'Revenues à la normale sur 24 heures : 1' })
    expect(toggle).toBeCollapsed()

    await fireEvent.press(toggle)

    expect(view.getByRole('button', { name: 'Revenues à la normale sur 24 heures : 1' })).toBeExpanded()
  })

  it("annonce « Alertes indisponibles » quand l'appel échoue", async () => {
    fetchLatestMeasurements.mockResolvedValue([co2])
    fetchRoomAlerts.mockRejectedValue(new client.ApiError('Erreur serveur', 500))
    const view = await renderDetail()

    expect(await view.findByRole('alert')).toHaveTextContent('Alertes indisponibles')
  })
})

describe('DeviceHistoryScreen', () => {
  it('nomme le retour et chaque barre du graphique par son heure et sa valeur', async () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000)
    tenMinutesAgo.setSeconds(0, 0)
    fetchDeviceHistory.mockResolvedValueOnce([
      { id: 'p1', deviceId: 'd1', type: 'co2', value: 812, unit: 'ppm', timestamp: tenMinutesAgo.toISOString() }
    ])
    const view = await render(
      <DeviceHistoryScreen token="t" target={{ deviceId: 'd1', deviceName: 'Capteur 1', type: 'co2' }} onBack={() => {}} />
    )

    expect(await view.findByRole('button', { name: 'Retour à la salle' })).toBeTruthy()
    expect(view.getByRole('button', { name: /^\d{2}:\d{2} : 812 ppm$/ })).toBeTruthy()
  })
})
