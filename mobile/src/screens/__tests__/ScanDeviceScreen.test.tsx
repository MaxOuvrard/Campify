import { act, fireEvent, render } from '@testing-library/react-native'
import ScanDeviceScreen from '../ScanDeviceScreen'
import * as client from '../../api/client'
import { ApiError, AssociatedDevice, Room } from '../../api/client'

const mockRequestPermission = jest.fn()
const mockUseCameraPermissions = jest.fn()

jest.mock('expo-camera', () => {
  // require() inline : le factory de jest.mock ne peut pas fermer sur des
  // imports du module — react-native est donc chargé ici, pas en haut de fichier.
  const { Text, TouchableOpacity } = require('react-native')
  return {
    useCameraPermissions: () => mockUseCameraPermissions(),
    // Mock minimal : expose un bouton pour déclencher un scan dans les tests,
    // la vraie caméra n'existe pas en environnement Jest.
    CameraView: ({ onBarcodeScanned }: { onBarcodeScanned: (result: { data: string }) => void }) => (
      <TouchableOpacity testID="fake-camera" onPress={() => onBarcodeScanned({ data: 'campus-device:v1:sensor-001' })}>
        <Text>camera</Text>
      </TouchableOpacity>
    )
  }
})

jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client')
  return { ...actual, associateDevice: jest.fn() }
})

const associateDevice = client.associateDevice as jest.Mock

const room: Room = { id: 'room-1', name: 'Salle A', createdAt: '2026-01-01T00:00:00.000Z' }

function device(overrides: Partial<AssociatedDevice> = {}): AssociatedDevice {
  return { id: 'sensor-001', name: 'Capteur 1', type: 'temperature', roomId: room.id, createdAt: '2026-01-01T00:00:00.000Z', ...overrides }
}

beforeEach(() => {
  mockRequestPermission.mockReset()
  mockUseCameraPermissions.mockReset()
  associateDevice.mockReset()
})

test("permission caméra refusée définitivement : propose d'ouvrir les réglages et une saisie manuelle", async () => {
  mockUseCameraPermissions.mockReturnValue([{ granted: false, canAskAgain: false }, mockRequestPermission])
  associateDevice.mockResolvedValue(device())

  const view = await render(<ScanDeviceScreen token="t" room={room} onAssociated={() => {}} onCancel={() => {}} />)

  expect(view.getByText('Ouvrir les réglages')).toBeTruthy()
  expect(view.queryByTestId('fake-camera')).toBeNull()

  await act(async () => {
    fireEvent.changeText(view.getByPlaceholderText('campus-device:v1:...'), 'campus-device:v1:sensor-001')
  })
  await act(async () => {
    fireEvent.press(view.getByText('Valider'))
  })

  expect(associateDevice).toHaveBeenCalledWith('t', room.id, 'campus-device:v1:sensor-001')
  expect(view.getByText('Équipement associé')).toBeTruthy()
})

test('permission accordée : un scan valide associe l\'équipement et affiche le succès', async () => {
  mockUseCameraPermissions.mockReturnValue([{ granted: true, canAskAgain: true }, mockRequestPermission])
  associateDevice.mockResolvedValue(device({ name: 'Ventilation Salle A' }))

  const view = await render(<ScanDeviceScreen token="t" room={room} onAssociated={() => {}} onCancel={() => {}} />)

  await act(async () => {
    fireEvent.press(view.getByTestId('fake-camera'))
  })

  expect(associateDevice).toHaveBeenCalledWith('t', room.id, 'campus-device:v1:sensor-001')
  expect(view.getByText(/Ventilation Salle A/)).toBeTruthy()
})

test('une erreur d\'association affiche le message et permet de réessayer', async () => {
  mockUseCameraPermissions.mockReturnValue([{ granted: true, canAskAgain: true }, mockRequestPermission])
  associateDevice.mockRejectedValue(new ApiError('Aucun équipement ne correspond à ce code', 404))

  const view = await render(<ScanDeviceScreen token="t" room={room} onAssociated={() => {}} onCancel={() => {}} />)

  await act(async () => {
    fireEvent.press(view.getByTestId('fake-camera'))
  })

  expect(view.getByText('Association impossible')).toBeTruthy()
  expect(view.getByText('Aucun équipement ne correspond à ce code')).toBeTruthy()

  await act(async () => {
    fireEvent.press(view.getByText('Réessayer'))
  })
  expect(view.getByTestId('fake-camera')).toBeTruthy()
})
