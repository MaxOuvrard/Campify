import { test } from 'node:test'
import * as assert from 'node:assert'
import bcrypt from 'bcryptjs'
import { buildApiServer } from '../../../src/driving/api/server'
import { CommandService } from '../../../src/domain/services/CommandService'
import {
  InMemoryRoomRepository,
  InMemoryDeviceRepository,
  InMemoryMeasurementRepository,
  InMemoryCommandRepository,
  InMemoryUserRepository
} from '../../fakes/inMemoryRepositories'
import { FixedClock, FakeMqttPublisher } from '../../fakes/testDoubles'

async function buildTestApp() {
  const rooms = new InMemoryRoomRepository()
  const devices = new InMemoryDeviceRepository()
  const measurements = new InMemoryMeasurementRepository()
  const commands = new InMemoryCommandRepository()
  const users = new InMemoryUserRepository()
  const publisher = new FakeMqttPublisher()
  const clock = new FixedClock(new Date('2024-01-01T00:00:00Z'))
  const commandService = new CommandService(commands, devices, publisher, clock)

  const room = await rooms.create('Salle Test')
  const device = await devices.create({ name: 'Sensor 1', type: 'temperature', roomId: room.id })

  users.seed({
    id: 'user-admin',
    email: 'admin@test.local',
    passwordHash: await bcrypt.hash('admin-pass', 4),
    role: 'ADMIN',
    createdAt: new Date()
  })
  users.seed({
    id: 'user-viewer',
    email: 'viewer@test.local',
    passwordHash: await bcrypt.hash('viewer-pass', 4),
    role: 'VIEWER',
    createdAt: new Date()
  })

  const app = buildApiServer({
    jwtSecret: 'test-secret',
    users,
    rooms,
    devices,
    measurements,
    commandService,
    commands,
    staleThresholdMs: 5 * 60 * 1000
  })

  return { app, rooms, devices, measurements, commands, users, publisher, room, device }
}

async function loginAs(app: Awaited<ReturnType<typeof buildTestApp>>['app'], email: string, password: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } })
  return (response.json() as { token: string }).token
}

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` }
}

test('POST /auth/login returns a token for valid credentials', async (t) => {
  const { app } = await buildTestApp()
  t.after(() => app.close())

  const response = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 'admin@test.local', password: 'admin-pass' }
  })

  assert.equal(response.statusCode, 200)
  assert.ok((response.json() as { token: string }).token)
})

test('POST /auth/login rejects a wrong password', async (t) => {
  const { app } = await buildTestApp()
  t.after(() => app.close())

  const response = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 'admin@test.local', password: 'wrong-pass' }
  })

  assert.equal(response.statusCode, 401)
})

test('POST /auth/login rejects an unknown email', async (t) => {
  const { app } = await buildTestApp()
  t.after(() => app.close())

  const response = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 'nobody@test.local', password: 'whatever' }
  })

  assert.equal(response.statusCode, 401)
})

test('POST /auth/login rejects a malformed body', async (t) => {
  const { app } = await buildTestApp()
  t.after(() => app.close())

  const response = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 'not-an-email', password: 'x' }
  })

  assert.equal(response.statusCode, 400)
  assert.equal((response.json() as { error: string }).error, 'validation_error')
})

test('GET /rooms requires authentication', async (t) => {
  const { app } = await buildTestApp()
  t.after(() => app.close())

  const response = await app.inject({ method: 'GET', url: '/rooms' })

  assert.equal(response.statusCode, 401)
})

test('GET /rooms returns the seeded room for an authenticated viewer', async (t) => {
  const { app, room } = await buildTestApp()
  t.after(() => app.close())
  const token = await loginAs(app, 'viewer@test.local', 'viewer-pass')

  const response = await app.inject({ method: 'GET', url: '/rooms', headers: authHeader(token) })

  assert.equal(response.statusCode, 200)
  const body = response.json() as Array<{ id: string }>
  assert.ok(body.some((r) => r.id === room.id))
})

test('GET /rooms/:id/devices returns the devices of that room', async (t) => {
  const { app, room, device } = await buildTestApp()
  t.after(() => app.close())
  const token = await loginAs(app, 'viewer@test.local', 'viewer-pass')

  const response = await app.inject({ method: 'GET', url: `/rooms/${room.id}/devices`, headers: authHeader(token) })

  assert.equal(response.statusCode, 200)
  const body = response.json() as Array<{ id: string }>
  assert.deepEqual(body.map((d) => d.id), [device.id])
})

test('GET /rooms/:id/measurements/latest aggregates the latest value per metric type, sorted by type', async (t) => {
  const { app, room, device, measurements } = await buildTestApp()
  t.after(() => app.close())
  const token = await loginAs(app, 'viewer@test.local', 'viewer-pass')

  await measurements.create({ deviceId: device.id, type: 'temperature', value: 20, unit: '°C', timestamp: new Date('2024-01-01T10:00:00Z') })
  await measurements.create({ deviceId: device.id, type: 'temperature', value: 21.7, unit: '°C', timestamp: new Date('2024-01-01T11:00:00Z') })
  await measurements.create({ deviceId: device.id, type: 'co2', value: 2500, unit: 'ppm', timestamp: new Date('2024-01-01T11:00:00Z') })

  const response = await app.inject({
    method: 'GET',
    url: `/rooms/${room.id}/measurements/latest`,
    headers: authHeader(token)
  })

  assert.equal(response.statusCode, 200)
  const body = response.json() as Array<{ type: string; value: number; deviceName: string }>
  assert.deepEqual(
    body.map((m) => m.type),
    ['co2', 'temperature']
  )
  assert.equal(body.find((m) => m.type === 'temperature')?.value, 21.7)
  assert.ok(body.every((m) => m.deviceName === 'Sensor 1'))
})

test('GET /rooms/:id/measurements/latest marks fresh:true for a recent measurement and fresh:false for a stale one', async (t) => {
  const { app, room, device, measurements } = await buildTestApp()
  t.after(() => app.close())
  const token = await loginAs(app, 'viewer@test.local', 'viewer-pass')

  await measurements.create({ deviceId: device.id, type: 'temperature', value: 21, unit: '°C', timestamp: new Date() })
  await measurements.create({
    deviceId: device.id,
    type: 'co2',
    value: 2500,
    unit: 'ppm',
    timestamp: new Date('2024-01-01T00:00:00Z')
  })

  const response = await app.inject({
    method: 'GET',
    url: `/rooms/${room.id}/measurements/latest`,
    headers: authHeader(token)
  })

  assert.equal(response.statusCode, 200)
  const body = response.json() as Array<{ type: string; fresh: boolean }>
  assert.equal(body.find((m) => m.type === 'temperature')?.fresh, true)
  assert.equal(body.find((m) => m.type === 'co2')?.fresh, false)
})

test('GET /rooms/:id/measurements/latest returns an empty list when the room has no measurement yet', async (t) => {
  const { app, room } = await buildTestApp()
  t.after(() => app.close())
  const token = await loginAs(app, 'viewer@test.local', 'viewer-pass')

  const response = await app.inject({
    method: 'GET',
    url: `/rooms/${room.id}/measurements/latest`,
    headers: authHeader(token)
  })

  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), [])
})

test('POST /rooms is forbidden for a VIEWER', async (t) => {
  const { app } = await buildTestApp()
  t.after(() => app.close())
  const token = await loginAs(app, 'viewer@test.local', 'viewer-pass')

  const response = await app.inject({
    method: 'POST',
    url: '/rooms',
    headers: authHeader(token),
    payload: { name: 'Salle 2' }
  })

  assert.equal(response.statusCode, 403)
})

test('POST /rooms creates a room for an ADMIN', async (t) => {
  const { app, rooms } = await buildTestApp()
  t.after(() => app.close())
  const token = await loginAs(app, 'admin@test.local', 'admin-pass')

  const response = await app.inject({
    method: 'POST',
    url: '/rooms',
    headers: authHeader(token),
    payload: { name: 'Salle 2' }
  })

  assert.equal(response.statusCode, 201)
  const created = response.json() as { id: string; name: string }
  assert.equal(created.name, 'Salle 2')
  assert.ok(await rooms.findById(created.id))
})

test('GET /devices/:id returns 404 for an unknown device', async (t) => {
  const { app } = await buildTestApp()
  t.after(() => app.close())
  const token = await loginAs(app, 'viewer@test.local', 'viewer-pass')

  const response = await app.inject({ method: 'GET', url: '/devices/missing-device', headers: authHeader(token) })

  assert.equal(response.statusCode, 404)
})

test('GET /devices/:id returns the device when it exists', async (t) => {
  const { app, device } = await buildTestApp()
  t.after(() => app.close())
  const token = await loginAs(app, 'viewer@test.local', 'viewer-pass')

  const response = await app.inject({ method: 'GET', url: `/devices/${device.id}`, headers: authHeader(token) })

  assert.equal(response.statusCode, 200)
  assert.equal((response.json() as { id: string }).id, device.id)
})

test('GET /devices/:id reports present:false when the device has never been seen', async (t) => {
  const { app, device } = await buildTestApp()
  t.after(() => app.close())
  const token = await loginAs(app, 'viewer@test.local', 'viewer-pass')

  const response = await app.inject({ method: 'GET', url: `/devices/${device.id}`, headers: authHeader(token) })

  assert.equal(response.statusCode, 200)
  assert.equal((response.json() as { present: boolean }).present, false)
})

test('GET /devices/:id reports present:true when the device has a recent measurement', async (t) => {
  const { app, device, measurements } = await buildTestApp()
  t.after(() => app.close())
  const token = await loginAs(app, 'viewer@test.local', 'viewer-pass')

  await measurements.create({ deviceId: device.id, type: 'temperature', value: 21, timestamp: new Date() })

  const response = await app.inject({ method: 'GET', url: `/devices/${device.id}`, headers: authHeader(token) })

  assert.equal(response.statusCode, 200)
  assert.equal((response.json() as { present: boolean }).present, true)
})

test('GET /devices/:id/measurements defaults to the last 24 hours', async (t) => {
  const { app, device, measurements } = await buildTestApp()
  t.after(() => app.close())
  const token = await loginAs(app, 'viewer@test.local', 'viewer-pass')

  const now = Date.now()
  await measurements.create({ deviceId: device.id, type: 'temperature', value: 19, timestamp: new Date(now - 1000) })
  await measurements.create({ deviceId: device.id, type: 'temperature', value: 18, timestamp: new Date(now - 48 * 60 * 60 * 1000) })

  const response = await app.inject({ method: 'GET', url: `/devices/${device.id}/measurements`, headers: authHeader(token) })

  assert.equal(response.statusCode, 200)
  const body = response.json() as Array<{ value: number }>
  assert.equal(body.length, 1)
  assert.equal(body[0].value, 19)
})

test('GET /devices/:id/measurements clamps a "from" older than the max history span', async (t) => {
  const { app, device, measurements } = await buildTestApp()
  t.after(() => app.close())
  const token = await loginAs(app, 'viewer@test.local', 'viewer-pass')

  const now = Date.now()
  await measurements.create({ deviceId: device.id, type: 'temperature', value: 19, timestamp: new Date(now - 60 * 60 * 1000) })
  await measurements.create({ deviceId: device.id, type: 'temperature', value: 18, timestamp: new Date(now - 10 * 24 * 60 * 60 * 1000) })

  const tenDaysAgo = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString()
  const response = await app.inject({
    method: 'GET',
    url: `/devices/${device.id}/measurements?from=${tenDaysAgo}`,
    headers: authHeader(token)
  })

  assert.equal(response.statusCode, 200)
  const body = response.json() as Array<{ value: number }>
  assert.equal(body.length, 1)
  assert.equal(body[0].value, 19)
})

test('GET /devices/:id/measurements rejects an invalid date range', async (t) => {
  const { app, device } = await buildTestApp()
  t.after(() => app.close())
  const token = await loginAs(app, 'viewer@test.local', 'viewer-pass')

  const response = await app.inject({
    method: 'GET',
    url: `/devices/${device.id}/measurements?from=not-a-date`,
    headers: authHeader(token)
  })

  assert.equal(response.statusCode, 400)
})

test('POST /devices/:id/commands is forbidden for a VIEWER', async (t) => {
  const { app, device } = await buildTestApp()
  t.after(() => app.close())
  const token = await loginAs(app, 'viewer@test.local', 'viewer-pass')

  const response = await app.inject({
    method: 'POST',
    url: `/devices/${device.id}/commands`,
    headers: authHeader(token),
    payload: { type: 'reboot' }
  })

  assert.equal(response.statusCode, 403)
})

test('POST /devices/:id/commands dispatches a command for an ADMIN and publishes it', async (t) => {
  const { app, device, publisher } = await buildTestApp()
  t.after(() => app.close())
  const token = await loginAs(app, 'admin@test.local', 'admin-pass')

  const response = await app.inject({
    method: 'POST',
    url: `/devices/${device.id}/commands`,
    headers: authHeader(token),
    payload: { type: 'reboot' }
  })

  assert.equal(response.statusCode, 201)
  const created = response.json() as { id: string; status: string }
  assert.equal(created.status, 'SENT')
  assert.equal(publisher.published.length, 1)
  assert.equal(publisher.published[0].deviceId, device.id)
})

test('POST /devices/:id/commands returns 404 for an unknown device', async (t) => {
  const { app } = await buildTestApp()
  t.after(() => app.close())
  const token = await loginAs(app, 'admin@test.local', 'admin-pass')

  const response = await app.inject({
    method: 'POST',
    url: '/devices/missing-device/commands',
    headers: authHeader(token),
    payload: { type: 'reboot' }
  })

  assert.equal(response.statusCode, 404)
})

test('GET /commands/:id returns 404 for an unknown command', async (t) => {
  const { app } = await buildTestApp()
  t.after(() => app.close())
  const token = await loginAs(app, 'viewer@test.local', 'viewer-pass')

  const response = await app.inject({ method: 'GET', url: '/commands/missing-command', headers: authHeader(token) })

  assert.equal(response.statusCode, 404)
})

test('GET /commands/:id returns the command once it has been dispatched', async (t) => {
  const { app, device } = await buildTestApp()
  t.after(() => app.close())
  const adminToken = await loginAs(app, 'admin@test.local', 'admin-pass')
  const dispatch = await app.inject({
    method: 'POST',
    url: `/devices/${device.id}/commands`,
    headers: authHeader(adminToken),
    payload: { type: 'reboot' }
  })
  const commandId = (dispatch.json() as { id: string }).id

  const viewerToken = await loginAs(app, 'viewer@test.local', 'viewer-pass')
  const response = await app.inject({ method: 'GET', url: `/commands/${commandId}`, headers: authHeader(viewerToken) })

  assert.equal(response.statusCode, 200)
  assert.equal((response.json() as { id: string }).id, commandId)
})
