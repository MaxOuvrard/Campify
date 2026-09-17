import { render } from '@testing-library/react-native'
import RoomListScreen from '../RoomListScreen'
import * as client from '../../api/client'
import { Room } from '../../api/client'

jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client')
  return { ...actual, fetchRooms: jest.fn() }
})

const fetchRooms = client.fetchRooms as jest.Mock

function room(overrides: Partial<Room> = {}): Room {
  return { id: 'room-1', name: 'Salle A', createdAt: '2026-01-01T00:00:00.000Z', hasSilentDevice: false, ...overrides }
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
