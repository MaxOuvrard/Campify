import { act, fireEvent, render } from '@testing-library/react-native'
import DeviceCommandPanel from '../DeviceCommandPanel'
import * as client from '../../api/client'
import { ApiError, Command } from '../../api/client'

jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client')
  return { ...actual, sendCommand: jest.fn(), fetchCommand: jest.fn() }
})

const sendCommand = client.sendCommand as jest.Mock
const fetchCommand = client.fetchCommand as jest.Mock

function command(overrides: Partial<Command> = {}): Command {
  return {
    id: 'cmd-1',
    deviceId: 'sensor-001',
    type: 'set_ventilation',
    params: { on: true },
    status: 'SENT',
    createdAt: '2026-10-08T10:00:00.000Z',
    expiresAt: '2026-10-08T10:00:15.000Z',
    sentAt: '2026-10-08T10:00:00.050Z',
    ackedAt: null,
    timedOutAt: null,
    failureReason: null,
    reportedState: null,
    lateAck: null,
    ...overrides
  }
}

const advance = (ms: number) => act(async () => jest.advanceTimersByTimeAsync(ms))

function isDisabled(view: Awaited<ReturnType<typeof render>>, label: string): boolean {
  return Boolean(view.getByRole('button', { name: label }).props.accessibilityState?.disabled)
}

describe('DeviceCommandPanel — attente, confirmation, incertitude', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    sendCommand.mockReset()
    fetchCommand.mockReset()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it("affiche l'attente puis le résultat confirmé par l'ACK — jamais « allumée » avant", async () => {
    sendCommand.mockResolvedValueOnce(command({ status: 'SENT' }))
    fetchCommand
      .mockResolvedValueOnce(command({ status: 'SENT' }))
      .mockResolvedValueOnce(command({ status: 'ACKNOWLEDGED', ackedAt: '2026-10-08T10:00:01.500Z', reportedState: { ventilation: 'on' } }))

    const view = await render(<DeviceCommandPanel token="t" deviceId="sensor-001" offline={false} />)
    await act(async () => fireEvent.press(view.getByText('Allumer')))

    expect(view.getByText(/En attente de confirmation de l'objet/)).toBeTruthy()
    expect(view.queryByText(/Ventilation allumée/)).toBeNull()
    // Pas de nouvel appui possible tant que la commande est en cours.
    expect(isDisabled(view, 'Allumer')).toBe(true)

    await advance(1_000)
    expect(view.queryByText(/Ventilation allumée/)).toBeNull()

    await advance(1_000)
    expect(view.getByText('✓ Ventilation allumée')).toBeTruthy()
    expect(isDisabled(view, 'Allumer')).toBe(false)
    expect(sendCommand).toHaveBeenCalledWith('t', 'sensor-001', { type: 'set_ventilation', params: { on: true } }, expect.any(String))
  })

  it('réessaie après une erreur réseau avec la MÊME clé d’idempotence', async () => {
    sendCommand.mockRejectedValueOnce(new ApiError('Impossible de joindre le serveur')).mockResolvedValueOnce(command({ status: 'SENT' }))
    fetchCommand.mockResolvedValue(command({ status: 'SENT' }))

    const view = await render(<DeviceCommandPanel token="t" deviceId="sensor-001" offline={false} />)
    await act(async () => fireEvent.press(view.getByText('Allumer')))
    expect(view.getByText(/nouvel essai/)).toBeTruthy()

    await advance(1_000)

    expect(sendCommand).toHaveBeenCalledTimes(2)
    const [firstKey, secondKey] = sendCommand.mock.calls.map((call) => call[3])
    expect(secondKey).toBe(firstKey)
    expect(view.getByText(/En attente de confirmation/)).toBeTruthy()
  })

  it('deux appuis distincts utilisent deux clés différentes', async () => {
    sendCommand.mockResolvedValue(command({ status: 'FAILED', failureReason: 'broker_unavailable' }))

    const view = await render(<DeviceCommandPanel token="t" deviceId="sensor-001" offline={false} />)
    await act(async () => fireEvent.press(view.getByText('Allumer')))
    await act(async () => fireEvent.press(view.getByText('Allumer')))

    expect(sendCommand.mock.calls[0][3]).not.toBe(sendCommand.mock.calls[1][3])
  })

  it("après des erreurs réseau répétées, dit qu'on ne sait pas si la demande est arrivée", async () => {
    sendCommand.mockRejectedValue(new ApiError('Impossible de joindre le serveur'))

    const view = await render(<DeviceCommandPanel token="t" deviceId="sensor-001" offline={false} />)
    await act(async () => fireEvent.press(view.getByText('Allumer')))
    await advance(1_000)
    await advance(1_000)

    expect(sendCommand).toHaveBeenCalledTimes(3)
    expect(view.getByText(/impossible de savoir si la demande est arrivée/)).toBeTruthy()
  })

  it('TIMEOUT : état inconnu, puis ACK tardif signalé', async () => {
    sendCommand.mockResolvedValueOnce(command({ status: 'SENT' }))
    fetchCommand
      .mockResolvedValueOnce(command({ status: 'TIMEOUT', timedOutAt: '2026-10-08T10:00:20.000Z' }))
      .mockResolvedValueOnce(command({ status: 'TIMEOUT', lateAck: { status: 'executed', at: '2026-10-08T10:00:25.000Z' } }))

    const view = await render(<DeviceCommandPanel token="t" deviceId="sensor-001" offline={false} />)
    await act(async () => fireEvent.press(view.getByText('Allumer')))
    await advance(1_000)

    expect(view.getByText(/Pas de confirmation de l'objet/)).toBeTruthy()
    expect(view.getByText(/état réel est inconnu/)).toBeTruthy()
    expect(view.queryByText(/échec/i)).toBeNull()

    await advance(3_000)
    expect(view.getByText(/finalement confirmé/)).toBeTruthy()
  })

  it('FAILED : la raison est expliquée', async () => {
    sendCommand.mockResolvedValueOnce(command({ status: 'FAILED', failureReason: 'broker_unavailable' }))

    const view = await render(<DeviceCommandPanel token="t" deviceId="sensor-001" offline={false} />)
    await act(async () => fireEvent.press(view.getByText('Éteindre')))

    expect(view.getByText(/rien n'a été envoyé/)).toBeTruthy()
  })

  it('téléphone hors ligne : boutons désactivés', async () => {
    const view = await render(<DeviceCommandPanel token="t" deviceId="sensor-001" offline={true} />)

    expect(isDisabled(view, 'Allumer')).toBe(true)
    expect(view.getByText(/hors ligne/)).toBeTruthy()
    fireEvent.press(view.getByText('Allumer'))
    expect(sendCommand).not.toHaveBeenCalled()
  })
})
