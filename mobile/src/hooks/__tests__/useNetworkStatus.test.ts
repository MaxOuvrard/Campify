import { act, renderHook } from '@testing-library/react-native'
import NetInfo from '@react-native-community/netinfo'
import { useNetworkStatus } from '../useNetworkStatus'

type Listener = (state: { isConnected: boolean | null; isInternetReachable: boolean | null }) => void

function getRegisteredListener(): Listener {
  const mock = NetInfo.addEventListener as jest.Mock
  return mock.mock.calls[mock.mock.calls.length - 1][0]
}

describe('useNetworkStatus', () => {
  it('démarre sans avis tant qu’aucun état réseau n’a été reçu', async () => {
    const { result } = await renderHook(() => useNetworkStatus())
    expect(result.current).toBeNull()
  })

  it('coupure réseau : passe à false quand NetInfo signale la perte de connexion', async () => {
    const { result } = await renderHook(() => useNetworkStatus())
    const listener = getRegisteredListener()

    await act(async () => listener({ isConnected: false, isInternetReachable: false }))

    expect(result.current).toBe(false)
  })

  it('retour réseau : repasse à true quand la connexion et l’accès internet reviennent', async () => {
    const { result } = await renderHook(() => useNetworkStatus())
    const listener = getRegisteredListener()

    await act(async () => listener({ isConnected: false, isInternetReachable: false }))
    expect(result.current).toBe(false)

    await act(async () => listener({ isConnected: true, isInternetReachable: true }))
    expect(result.current).toBe(true)
  })

  it('connecté au wifi mais sans accès internet réel reste considéré hors ligne', async () => {
    const { result } = await renderHook(() => useNetworkStatus())
    const listener = getRegisteredListener()

    await act(async () => listener({ isConnected: true, isInternetReachable: false }))

    expect(result.current).toBe(false)
  })

  it('se désabonne du listener au démontage', async () => {
    const unsubscribe = jest.fn()
    ;(NetInfo.addEventListener as jest.Mock).mockReturnValueOnce(unsubscribe)

    const { unmount } = await renderHook(() => useNetworkStatus())
    await unmount()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
