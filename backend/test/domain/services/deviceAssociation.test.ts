import { test } from 'node:test'
import * as assert from 'node:assert'
import { DeviceAssociationService, parseDeviceIdentifier } from '../../../src/domain/services/deviceAssociation'
import { NotFoundError, ValidationError } from '../../../src/shared/errors'
import { InMemoryDeviceRepository, InMemoryRoomRepository } from '../../fakes/inMemoryRepositories'

test('parseDeviceIdentifier extracts the device id from a valid QR content', () => {
  assert.equal(parseDeviceIdentifier('campus-device:v1:sensor-001'), 'sensor-001')
})

test('parseDeviceIdentifier returns null for an invalid format', () => {
  assert.equal(parseDeviceIdentifier('ceci-n-est-pas-un-objet'), null)
})

test('associate moves an existing device to the target room', async () => {
  const devices = new InMemoryDeviceRepository()
  const rooms = new InMemoryRoomRepository()
  const originalRoom = await rooms.create('Salle A')
  const targetRoom = await rooms.create('Salle B')
  const device = await devices.create({ name: 'Capteur 1', type: 'temperature', roomId: originalRoom.id })
  const service = new DeviceAssociationService(devices, rooms)

  const result = await service.associate(`campus-device:v1:${device.id}`, targetRoom.id)

  assert.equal(result.roomId, targetRoom.id)
  assert.equal((await devices.findById(device.id))?.roomId, targetRoom.id)
})

test('associate rejects an invalid QR format', async () => {
  const devices = new InMemoryDeviceRepository()
  const rooms = new InMemoryRoomRepository()
  const room = await rooms.create('Salle A')
  const service = new DeviceAssociationService(devices, rooms)

  await assert.rejects(() => service.associate('ceci-n-est-pas-un-objet', room.id), ValidationError)
})

test('associate rejects a well-formed but unknown device identifier', async () => {
  const devices = new InMemoryDeviceRepository()
  const rooms = new InMemoryRoomRepository()
  const room = await rooms.create('Salle A')
  const service = new DeviceAssociationService(devices, rooms)

  await assert.rejects(() => service.associate('campus-device:v1:sensor-999', room.id), NotFoundError)
})

test('associate rejects an unknown target room', async () => {
  const devices = new InMemoryDeviceRepository()
  const rooms = new InMemoryRoomRepository()
  const originalRoom = await rooms.create('Salle A')
  const device = await devices.create({ name: 'Capteur 1', type: 'temperature', roomId: originalRoom.id })
  const service = new DeviceAssociationService(devices, rooms)

  await assert.rejects(() => service.associate(`campus-device:v1:${device.id}`, 'missing-room'), NotFoundError)
})
