import { act, renderHook } from '@testing-library/react-native'
import { AppState, AppStateStatus } from 'react-native'
import { useAppForeground } from '../useAppForeground'

function mockAppState(initial: AppStateStatus) {
  AppState.currentState = initial
  let handler: (state: AppStateStatus) => void = () => {}
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, cb) => {
    handler = cb as (state: AppStateStatus) => void
    return { remove: jest.fn() }
  })
  return {
    emit: (state: AppStateStatus) => handler(state)
  }
}

async function mount(onForeground: () => void) {
  await renderHook(() => useAppForeground(onForeground))
}

describe('useAppForeground', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('reprise de l’app : appelle le callback quand on repasse de background à active', async () => {
    const { emit } = mockAppState('background')
    const onForeground = jest.fn()
    await mount(onForeground)

    await act(async () => emit('active'))

    expect(onForeground).toHaveBeenCalledTimes(1)
  })

  it('déclenche aussi depuis inactive (verrouillage écran, multitâche iOS) vers active', async () => {
    const { emit } = mockAppState('inactive')
    const onForeground = jest.fn()
    await mount(onForeground)

    await act(async () => emit('active'))

    expect(onForeground).toHaveBeenCalledTimes(1)
  })

  it('ne déclenche rien quand l’app repasse simplement en arrière-plan', async () => {
    const { emit } = mockAppState('active')
    const onForeground = jest.fn()
    await mount(onForeground)

    await act(async () => emit('background'))

    expect(onForeground).not.toHaveBeenCalled()
  })

  it('ne déclenche rien deux fois de suite si l’état actif ne change pas', async () => {
    const { emit } = mockAppState('background')
    const onForeground = jest.fn()
    await mount(onForeground)

    await act(async () => emit('active'))
    await act(async () => emit('active'))

    expect(onForeground).toHaveBeenCalledTimes(1)
  })
})
