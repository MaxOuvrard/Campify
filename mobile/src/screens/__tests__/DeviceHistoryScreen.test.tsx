import { fireEvent, render } from '@testing-library/react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import DeviceHistoryScreen from '../DeviceHistoryScreen'
import * as client from '../../api/client'
import { MetricHistory } from '../../api/client'

jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client')
  return { ...actual, fetchMetricHistory: jest.fn() }
})

const fetchMetricHistory = client.fetchMetricHistory as jest.Mock
const target = { deviceId: 'd1', deviceName: 'Capteur 1', type: 'co2' }
const HOUR = 60 * 60 * 1000

function history(overrides: Partial<MetricHistory> = {}): MetricHistory {
  const to = new Date()
  return {
    type: 'co2',
    unit: 'ppm',
    from: new Date(to.getTime() - 24 * HOUR).toISOString(),
    to: to.toISOString(),
    bucketMs: 5 * 60 * 1000,
    buckets: [
      // Début de fenêtre : la preuve que les 24h sont couvertes, pas seulement les dernières minutes.
      { start: new Date(to.getTime() - 23 * HOUR).toISOString(), avg: 610, min: 600, max: 620, count: 150 },
      { start: new Date(to.getTime() - 10 * 60 * 1000).toISOString(), avg: 980.25, min: 700, max: 1650, count: 150 }
    ],
    ...overrides
  }
}

beforeEach(async () => {
  fetchMetricHistory.mockReset()
  await AsyncStorage.clear()
})

it('demande l’historique agrégé de la seule métrique affichée et annonce la granularité', async () => {
  fetchMetricHistory.mockResolvedValueOnce(history())

  const view = await render(<DeviceHistoryScreen token="t" target={target} onBack={() => {}} />)

  await view.findByText('Capteur 1 — dernières 24h, moyenne par 5 min')
  expect(fetchMetricHistory).toHaveBeenCalledWith('t', 'd1', 'co2')
  expect(view.getAllByRole('button', { name: /moyenne/ })).toHaveLength(2)
})

it('montre le dernier intervalle avec ses extrêmes, et les extrêmes 24h (un pic bref reste visible)', async () => {
  fetchMetricHistory.mockResolvedValueOnce(history())

  const view = await render(<DeviceHistoryScreen token="t" target={target} onBack={() => {}} />)

  await view.findByText('980.3 ppm')
  expect(view.getByText('min 700 · max 1650 · 150 mesures')).toBeTruthy()
  expect(view.getByText('max 24h 1650')).toBeTruthy()
  expect(view.getByText('min 24h 600')).toBeTruthy()
})

it('épingle un intervalle touché et revient au dernier', async () => {
  fetchMetricHistory.mockResolvedValueOnce(history())
  const view = await render(<DeviceHistoryScreen token="t" target={target} onBack={() => {}} />)
  await view.findByText('980.3 ppm')

  await fireEvent.press(view.getByRole('button', { name: /moyenne 610 ppm/ }))
  expect(view.getByText('610 ppm')).toBeTruthy()
  expect(view.getByText('min 600 · max 620 · 150 mesures')).toBeTruthy()

  await fireEvent.press(view.getByText('Toucher pour revenir au dernier intervalle'))
  expect(view.getByText('980.3 ppm')).toBeTruthy()
})

it('affiche un message clair quand la métrique n’a aucune mesure sur 24h', async () => {
  fetchMetricHistory.mockResolvedValueOnce(history({ buckets: [], unit: null }))

  const view = await render(<DeviceHistoryScreen token="t" target={target} onBack={() => {}} />)

  await view.findByText('Aucune mesure sur les dernières 24h pour ce capteur.')
})

it('annonce l’erreur et propose de réessayer quand rien n’a encore pu être affiché', async () => {
  fetchMetricHistory.mockRejectedValueOnce(new client.ApiError('Impossible de joindre le serveur'))

  const view = await render(<DeviceHistoryScreen token="t" target={target} onBack={() => {}} />)

  expect(await view.findByRole('alert')).toHaveTextContent('Impossible de joindre le serveur')
  fetchMetricHistory.mockResolvedValueOnce(history())
  await fireEvent.press(view.getByRole('button', { name: 'Réessayer' }))
  await view.findByText('980.3 ppm')
})
