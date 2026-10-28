import { render } from '@testing-library/react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import RoomDetailScreen from '../RoomDetailScreen'
import * as client from '../../api/client'
import { LatestMeasurement, Room } from '../../api/client'

jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client')
  return { ...actual, fetchLatestMeasurements: jest.fn() }
})

const fetchLatestMeasurements = client.fetchLatestMeasurements as jest.Mock

const room: Room = { id: 'room-1', name: 'Salle A', createdAt: '2026-01-01T00:00:00.000Z', hasSilentDevice: false, openAlertCount: 0 }

const measurement: LatestMeasurement = {
  id: 'm1',
  deviceId: 'sensor-001',
  deviceName: 'Capteur 1',
  type: 'co2',
  value: 800,
  unit: 'ppm',
  timestamp: '2026-01-01T10:00:00.000Z',
  receivedAt: '2026-01-01T10:00:00.000Z',
  fresh: true
}

function tokenWithRole(role: string): string {
  const encode = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '')
  return `${encode({ alg: 'HS256' })}.${encode({ sub: 'u1', role })}.sig`
}

describe('RoomDetailScreen — pilotage de la ventilation selon le rôle', () => {
  beforeEach(async () => {
    fetchLatestMeasurements.mockReset()
    await AsyncStorage.clear()
  })

  it('un OPERATOR voit les commandes de ventilation sur chaque capteur', async () => {
    fetchLatestMeasurements.mockResolvedValueOnce([measurement])
    const view = await render(
      <RoomDetailScreen token={tokenWithRole('OPERATOR')} room={room} onBack={() => {}} onScanDevice={() => {}} onOpenHistory={() => {}} />
    )
    await view.findByText('800 ppm')

    expect(view.getByText('Ventilation')).toBeTruthy()
    expect(view.getByText('Allumer')).toBeTruthy()
  })

  it('un VIEWER ne les voit pas (le backend refuserait de toute façon)', async () => {
    fetchLatestMeasurements.mockResolvedValueOnce([measurement])
    const view = await render(
      <RoomDetailScreen token={tokenWithRole('VIEWER')} room={room} onBack={() => {}} onScanDevice={() => {}} onOpenHistory={() => {}} />
    )
    await view.findByText('800 ppm')

    expect(view.queryByText('Allumer')).toBeNull()
  })
})
