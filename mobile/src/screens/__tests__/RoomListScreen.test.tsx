import { act, render } from '@testing-library/react-native'
import { AppState } from 'react-native'
import RoomListScreen, { sortRooms } from '../RoomListScreen'
import { REFRESH_INTERVAL_MS } from '../../hooks/usePeriodicRefresh'
import * as client from '../../api/client'
import { Room } from '../../api/client'

jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client')
  return { ...actual, fetchRooms: jest.fn() }
})

const fetchRooms = client.fetchRooms as jest.Mock

function room(overrides: Partial<Room> = {}): Room {
  return { id: 'room-1', name: 'Salle A', createdAt: '2026-01-01T00:00:00.000Z', hasSilentDevice: false, openAlertCount: 0, ...overrides }
}

beforeEach(() => {
  fetchRooms.mockReset()
})

test('affiche un badge "Capteur silencieux" pour une salle qui en a un', async () => {
  fetchRooms.mockResolvedValueOnce([room({ id: 'room-1', name: 'Salle A', hasSilentDevice: true }), room({ id: 'room-2', name: 'Salle B', hasSilentDevice: false })])

  const view = await render(<RoomListScreen token="t" onSelectRoom={() => {}} />)
  await view.findByText('Salle A')

  expect(view.getByText('⚠️ Capteur silencieux')).toBeTruthy()
  expect(view.getByText('Salle B')).toBeTruthy()
})

test("n'affiche aucun badge quand aucune salle n'a de capteur silencieux", async () => {
  fetchRooms.mockResolvedValueOnce([room({ id: 'room-1', name: 'Salle A', hasSilentDevice: false })])

  const view = await render(<RoomListScreen token="t" onSelectRoom={() => {}} />)
  await view.findByText('Salle A')

  expect(view.queryByText('⚠️ Capteur silencieux')).toBeNull()
})

test('affiche le nombre d’alertes en cours, accordé au singulier et au pluriel', async () => {
  fetchRooms.mockResolvedValueOnce([
    room({ id: 'room-1', name: 'Salle A', openAlertCount: 1 }),
    room({ id: 'room-2', name: 'Salle B', openAlertCount: 3 }),
    room({ id: 'room-3', name: 'Salle C', openAlertCount: 0 })
  ])

  const view = await render(<RoomListScreen token="t" onSelectRoom={() => {}} />)
  await view.findByText('Salle A')

  expect(view.getByText('1 alerte en cours')).toBeTruthy()
  expect(view.getByText('3 alertes en cours')).toBeTruthy()
  expect(view.queryByText('0 alertes en cours')).toBeNull()
})

test('remonte les salles en alerte en haut de la liste, puis ordre alphabétique', () => {
  const sorted = sortRooms([
    room({ id: '1', name: 'Amphi', openAlertCount: 0 }),
    room({ id: '2', name: 'Labo', openAlertCount: 1 }),
    room({ id: '3', name: 'Bureau', openAlertCount: 0 }),
    room({ id: '4', name: 'Cantine', openAlertCount: 2 })
  ])

  expect(sorted.map((r) => r.name)).toEqual(['Cantine', 'Labo', 'Amphi', 'Bureau'])
})

test('rafraîchit la liste toutes les 30 s tant que l’app est au premier plan', async () => {
  jest.useFakeTimers()
  AppState.currentState = 'active'
  fetchRooms.mockResolvedValueOnce([room({ name: 'Salle A', openAlertCount: 0 })])

  const view = await render(<RoomListScreen token="t" onSelectRoom={() => {}} />)
  await view.findByText('Salle A')

  fetchRooms.mockResolvedValueOnce([room({ name: 'Salle A', openAlertCount: 1 })])
  await act(async () => {
    jest.advanceTimersByTime(REFRESH_INTERVAL_MS)
  })

  await view.findByText('1 alerte en cours')
  jest.useRealTimers()
})
