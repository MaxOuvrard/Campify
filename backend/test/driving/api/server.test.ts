import { test } from 'node:test'
import * as assert from 'node:assert'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { buildApiServer } from '../../../src/driving/api/server'
import { CommandService } from '../../../src/domain/services/CommandService'
import { DeviceAssociationService } from '../../../src/domain/services/deviceAssociation'
import {
  InMemoryRoomRepository,
  InMemoryDeviceRepository,
  InMemoryMeasurementRepository,
  InMemoryCommandRepository,
  InMemoryUserRepository,
  InMemoryAlertRepository
} from '../../fakes/inMemoryRepositories'
import { FixedClock, FakeLogger, FakeMqttPublisher } from '../../fakes/testDoubles'

async function buildTestApp() {
  const rooms = new InMemoryRoomRepository()
  const devices = new InMemoryDeviceRepository()
  const measurements = new InMemoryMeasurementRepository()
  const commands = new InMemoryCommandRepository()
  const users = new InMemoryUserRepository()
  const alerts = new InMemoryAlertRepository(devices)
  const publisher = new FakeMqttPublisher()
  const clock = new FixedClock(new Date('2024-01-01T00:00:00Z'))
  const commandService = new CommandService(commands, devices, publisher, clock, new FakeLogger())
  const deviceAssociationService = new DeviceAssociationService(devices, rooms)

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
    alerts,
    commandService,
    commands,
    logger: new FakeLogger(),
    deviceAssociationService,
    staleThresholdMs: 5 * 60 * 1000
  })

  return { app, rooms, devices, measurements, alerts, commands, users, publisher, room, device }
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

test('GET /rooms reports hasSilentDevice:false when the room only has fresh measurements', async (t) => {
  const { app, room, device, measurements } = await buildTestApp()
  t.after(() => app.close())
  const token = await loginAs(app, 'viewer@test.local', 'viewer-pass')

  await measurements.create({ deviceId: device.id, type: 'temperature', value: 21, timestamp: new Date() })

  const response = await app.inject({ method: 'GET', url: '/rooms', headers: authHeader(token) })

  assert.equal(response.statusCode, 200)
  const body = response.json() as Array<{ id: string; hasSilentDevice: boolean }>
  assert.equal(body.find((r) => r.id === room.id)?.hasSilentDevice, false)
})

test('GET /rooms reports hasSilentDevice:true as soon as one measurement of the room is stale', async (t) => {
  const { app, room, device, measurements } = await buildTestApp()
  t.after(() => app.close())
  const token = await loginAs(app, 'viewer@test.local', 'viewer-pass')

  await measurements.create({ deviceId: device.id, type: 'temperature', value: 21, timestamp: new Date('2024-01-01T00:00:00Z') })

  const response = await app.inject({ method: 'GET', url: '/rooms', headers: authHeader(token) })

  assert.equal(response.statusCode, 200)
  const body = response.json() as Array<{ id: string; hasSilentDevice: boolean }>
  assert.equal(body.find((r) => r.id === room.id)?.hasSilentDevice, true)
})

test('GET /rooms reports hasSilentDevice:false for a room with no device/measurement yet', async (t) => {
  const { app, rooms } = await buildTestApp()
  t.after(() => app.close())
  const token = await loginAs(app, 'viewer@test.local', 'viewer-pass')
  const emptyRoom = await rooms.create('Salle vide')

  const response = await app.inject({ method: 'GET', url: '/rooms', headers: authHeader(token) })

  assert.equal(response.statusCode, 200)
  const body = response.json() as Array<{ id: string; hasSilentDevice: boolean }>
  assert.equal(body.find((r) => r.id === emptyRoom.id)?.hasSilentDevice, false)
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

function openCo2Alert(alerts: InMemoryAlertRepository, deviceId: string, openedAt: Date) {
  return alerts.open({ deviceId, measurementType: 'co2', reason: 'above_max', threshold: 1000, triggerValue: 1200, openedAt, openedEventId: 'msg-open' })
}

test('GET /rooms reports openAlertCount per room, across several rooms', async (t) => {
  const { app, rooms, devices, alerts, room, device } = await buildTestApp()
  t.after(() => app.close())
  const token = await loginAs(app, 'viewer@test.local', 'viewer-pass')
  const calmRoom = await rooms.create('Salle Calme')
  await devices.create({ name: 'Sensor 2', type: 'co2', roomId: calmRoom.id })
  await openCo2Alert(alerts, device.id, new Date())
  await alerts.open({ deviceId: device.id, measurementType: 'temperature', reason: 'below_min', threshold: 16, triggerValue: 14, openedAt: new Date(), openedEventId: null })

  const response = await app.inject({ method: 'GET', url: '/rooms', headers: authHeader(token) })

  assert.equal(response.statusCode, 200)
  const body = response.json() as Array<{ id: string; openAlertCount: number }>
  assert.equal(body.find((r) => r.id === room.id)?.openAlertCount, 2)
  assert.equal(body.find((r) => r.id === calmRoom.id)?.openAlertCount, 0)
})

test('GET /rooms/:id/alerts requires authentication', async (t) => {
  const { app, room } = await buildTestApp()
  t.after(() => app.close())

  const response = await app.inject({ method: 'GET', url: `/rooms/${room.id}/alerts` })

  assert.equal(response.statusCode, 401)
})

test('GET /rooms/:id/alerts returns 404 for an unknown room', async (t) => {
  const { app } = await buildTestApp()
  t.after(() => app.close())
  const token = await loginAs(app, 'viewer@test.local', 'viewer-pass')

  const response = await app.inject({ method: 'GET', url: '/rooms/unknown-room/alerts', headers: authHeader(token) })

  assert.equal(response.statusCode, 404)
})

test('GET /rooms/:id/alerts rejects an invalid status', async (t) => {
  const { app, room } = await buildTestApp()
  t.after(() => app.close())
  const token = await loginAs(app, 'viewer@test.local', 'viewer-pass')

  const response = await app.inject({ method: 'GET', url: `/rooms/${room.id}/alerts?status=foo`, headers: authHeader(token) })

  assert.equal(response.statusCode, 400)
  assert.equal((response.json() as { error: string }).error, 'validation_error')
})

test('GET /rooms/:id/alerts returns an empty list when the room has no alert', async (t) => {
  const { app, room } = await buildTestApp()
  t.after(() => app.close())
  const token = await loginAs(app, 'viewer@test.local', 'viewer-pass')

  const response = await app.inject({ method: 'GET', url: `/rooms/${room.id}/alerts`, headers: authHeader(token) })

  assert.equal(response.statusCode, 200)
  assert.deepStrictEqual(response.json(), [])
})

test('GET /rooms/:id/alerts returns only open alerts by default, with deviceName and status', async (t) => {
  const { app, alerts, room, device } = await buildTestApp()
  t.after(() => app.close())
  const token = await loginAs(app, 'viewer@test.local', 'viewer-pass')
  const now = Date.now()
  const resolved = await openCo2Alert(alerts, device.id, new Date(now - 2 * 60 * 60 * 1000))
  await alerts.resolve(resolved.id, { value: 850, at: new Date(now - 60 * 60 * 1000), eventId: 'msg-resolve' })
  const open = await openCo2Alert(alerts, device.id, new Date(now - 10 * 60 * 1000))

  const response = await app.inject({ method: 'GET', url: `/rooms/${room.id}/alerts`, headers: authHeader(token) })

  assert.equal(response.statusCode, 200)
  const body = response.json() as Array<{ id: string; deviceName: string; status: string }>
  assert.deepStrictEqual(body.map((a) => a.id), [open.id])
  assert.equal(body[0].deviceName, 'Sensor 1')
  assert.equal(body[0].status, 'open')
})

test('GET /rooms/:id/alerts?status=all returns the history including resolved alerts, newest first', async (t) => {
  const { app, alerts, room, device } = await buildTestApp()
  t.after(() => app.close())
  const token = await loginAs(app, 'viewer@test.local', 'viewer-pass')
  const now = Date.now()
  const resolved = await openCo2Alert(alerts, device.id, new Date(now - 2 * 60 * 60 * 1000))
  await alerts.resolve(resolved.id, { value: 850, at: new Date(now - 60 * 60 * 1000), eventId: 'msg-resolve' })
  const open = await openCo2Alert(alerts, device.id, new Date(now - 10 * 60 * 1000))

  const response = await app.inject({ method: 'GET', url: `/rooms/${room.id}/alerts?status=all`, headers: authHeader(token) })

  assert.equal(response.statusCode, 200)
  const body = response.json() as Array<{ id: string; status: string }>
  assert.deepStrictEqual(body.map((a) => [a.id, a.status]), [[open.id, 'open'], [resolved.id, 'resolved']])
})

test('GET /rooms/:id/alerts?status=all clamps a "from" older than the max history span', async (t) => {
  const { app, alerts, room, device } = await buildTestApp()
  t.after(() => app.close())
  const token = await loginAs(app, 'viewer@test.local', 'viewer-pass')
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000
  const old = await openCo2Alert(alerts, device.id, new Date(now - 20 * day))
  await alerts.resolve(old.id, { value: 850, at: new Date(now - 19 * day), eventId: null })
  const recent = await openCo2Alert(alerts, device.id, new Date(now - day))
  await alerts.resolve(recent.id, { value: 850, at: new Date(now - day / 2), eventId: null })

  const thirtyDaysAgo = new Date(now - 30 * day).toISOString()
  const response = await app.inject({
    method: 'GET',
    url: `/rooms/${room.id}/alerts?status=all&from=${thirtyDaysAgo}`,
    headers: authHeader(token)
  })

  assert.equal(response.statusCode, 200)
  assert.deepStrictEqual((response.json() as Array<{ id: string }>).map((a) => a.id), [recent.id])
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

test('GET /devices/:id/history summarizes a whole 24h window of one metric in bounded buckets, keeping peaks', async (t) => {
  const { app, device, measurements } = await buildTestApp()
  t.after(() => app.close())
  const token = await loginAs(app, 'viewer@test.local', 'viewer-pass')
  const now = Date.now()
  // Une mesure par minute sur 23h (1380 mesures), plus de 500 au total : l'ancien
  // historique brut n'en aurait gardé que les 500 dernières (~8h).
  for (let i = 0; i < 23 * 60; i++) {
    await measurements.create({ deviceId: device.id, type: 'co2', value: i === 60 ? 1800 : 600, unit: 'ppm', timestamp: new Date(now - (i + 1) * 60 * 1000) })
  }
  await measurements.create({ deviceId: device.id, type: 'temperature', value: 21, unit: '°C', timestamp: new Date(now - 60 * 1000) })

  const response = await app.inject({ method: 'GET', url: `/devices/${device.id}/history?type=co2`, headers: authHeader(token) })

  assert.equal(response.statusCode, 200)
  const body = response.json() as { type: string; unit: string; bucketMs: number; buckets: Array<{ start: string; avg: number; min: number; max: number; count: number }> }
  assert.equal(body.type, 'co2')
  assert.equal(body.unit, 'ppm')
  assert.equal(body.bucketMs, 5 * 60 * 1000)
  assert.ok(body.buckets.length <= 500)
  // Toute la fenêtre est couverte, pas seulement la fin.
  assert.ok(now - new Date(body.buckets[0].start).getTime() > 22 * 60 * 60 * 1000)
  assert.equal(body.buckets.reduce((n, b) => n + b.count, 0), 23 * 60)
  // Le pic isolé reste visible dans max ; la température ne s'est pas mélangée.
  assert.equal(Math.max(...body.buckets.map((b) => b.max)), 1800)
  assert.ok(body.buckets.every((b) => b.min >= 600))
})

test('GET /devices/:id/history requires a metric type', async (t) => {
  const { app, device } = await buildTestApp()
  t.after(() => app.close())
  const token = await loginAs(app, 'viewer@test.local', 'viewer-pass')

  const response = await app.inject({ method: 'GET', url: `/devices/${device.id}/history`, headers: authHeader(token) })

  assert.equal(response.statusCode, 400)
})

test('GET /devices/:id/history returns 404 for an unknown device', async (t) => {
  const { app } = await buildTestApp()
  t.after(() => app.close())
  const token = await loginAs(app, 'viewer@test.local', 'viewer-pass')

  const response = await app.inject({ method: 'GET', url: '/devices/unknown/history?type=co2', headers: authHeader(token) })

  assert.equal(response.statusCode, 404)
})

test('GET /devices/:id/history returns no bucket and a null unit for a metric never measured', async (t) => {
  const { app, device } = await buildTestApp()
  t.after(() => app.close())
  const token = await loginAs(app, 'viewer@test.local', 'viewer-pass')

  const response = await app.inject({ method: 'GET', url: `/devices/${device.id}/history?type=co2`, headers: authHeader(token) })

  assert.equal(response.statusCode, 200)
  const body = response.json() as { unit: string | null; buckets: unknown[] }
  assert.equal(body.unit, null)
  assert.deepStrictEqual(body.buckets, [])
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
    headers: { ...authHeader(token), 'idempotency-key': randomUUID() },
    payload: { type: 'set_ventilation', params: { on: true } }
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
    headers: { ...authHeader(token), 'idempotency-key': randomUUID() },
    payload: { type: 'set_ventilation', params: { on: true } }
  })

  // 202 : acceptée, exécution pas encore confirmée par l'objet.
  assert.equal(response.statusCode, 202)
  const created = response.json() as { id: string; status: string }
  assert.equal(created.status, 'SENT')
  assert.equal(publisher.published.length, 1)
  assert.equal(publisher.published[0].deviceId, device.id)
})

test('POST /devices/:id/commands returns 400 for an unsupported command type and publishes nothing', async (t) => {
  const { app, device, publisher } = await buildTestApp()
  t.after(() => app.close())
  const token = await loginAs(app, 'admin@test.local', 'admin-pass')

  const response = await app.inject({
    method: 'POST',
    url: `/devices/${device.id}/commands`,
    headers: { ...authHeader(token), 'idempotency-key': randomUUID() },
    payload: { type: 'reboot' }
  })

  assert.equal(response.statusCode, 400)
  assert.equal(publisher.published.length, 0)
})

test('POST /devices/:id/commands returns 400 for invalid params', async (t) => {
  const { app, device, publisher } = await buildTestApp()
  t.after(() => app.close())
  const token = await loginAs(app, 'admin@test.local', 'admin-pass')

  const response = await app.inject({
    method: 'POST',
    url: `/devices/${device.id}/commands`,
    headers: { ...authHeader(token), 'idempotency-key': randomUUID() },
    payload: { type: 'set_target_temperature', params: { value: 99 } }
  })

  assert.equal(response.statusCode, 400)
  assert.equal(publisher.published.length, 0)
})

test('POST /devices/:id/commands returns 400 without an Idempotency-Key header', async (t) => {
  const { app, device, publisher } = await buildTestApp()
  t.after(() => app.close())
  const token = await loginAs(app, 'admin@test.local', 'admin-pass')

  const response = await app.inject({
    method: 'POST',
    url: `/devices/${device.id}/commands`,
    headers: authHeader(token),
    payload: { type: 'set_ventilation', params: { on: true } }
  })

  assert.equal(response.statusCode, 400)
  assert.equal((response.json() as { error: string }).error, 'idempotency_key_required')
  assert.equal(publisher.published.length, 0)
})

test('POST /devices/:id/commands replayed with the same Idempotency-Key returns the same command (200) without republishing', async (t) => {
  const { app, device, publisher } = await buildTestApp()
  t.after(() => app.close())
  const token = await loginAs(app, 'admin@test.local', 'admin-pass')
  const send = () =>
    app.inject({
      method: 'POST',
      url: `/devices/${device.id}/commands`,
      headers: { ...authHeader(token), 'idempotency-key': 'tap-42' },
      payload: { type: 'set_ventilation', params: { on: true } }
    })

  const first = await send()
  const second = await send()

  assert.equal(first.statusCode, 202)
  assert.equal(second.statusCode, 200)
  assert.equal(second.headers['idempotent-replayed'], 'true')
  assert.equal((second.json() as { id: string }).id, (first.json() as { id: string }).id)
  assert.equal(publisher.published.length, 1)
})

test('POST /devices/:id/commands with a reused Idempotency-Key for another command returns 409', async (t) => {
  const { app, device, publisher } = await buildTestApp()
  t.after(() => app.close())
  const token = await loginAs(app, 'admin@test.local', 'admin-pass')
  const send = (on: boolean) =>
    app.inject({
      method: 'POST',
      url: `/devices/${device.id}/commands`,
      headers: { ...authHeader(token), 'idempotency-key': 'tap-42' },
      payload: { type: 'set_ventilation', params: { on } }
    })

  await send(true)
  const conflict = await send(false)

  assert.equal(conflict.statusCode, 409)
  assert.equal(publisher.published.length, 1)
})

test('POST /devices/:id/commands returns 404 for an unknown device', async (t) => {
  const { app } = await buildTestApp()
  t.after(() => app.close())
  const token = await loginAs(app, 'admin@test.local', 'admin-pass')

  const response = await app.inject({
    method: 'POST',
    url: '/devices/missing-device/commands',
    headers: { ...authHeader(token), 'idempotency-key': randomUUID() },
    payload: { type: 'set_ventilation', params: { on: true } }
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
    headers: { ...authHeader(adminToken), 'idempotency-key': randomUUID() },
    payload: { type: 'set_ventilation', params: { on: true } }
  })
  const commandId = (dispatch.json() as { id: string }).id

  const viewerToken = await loginAs(app, 'viewer@test.local', 'viewer-pass')
  const response = await app.inject({ method: 'GET', url: `/commands/${commandId}`, headers: authHeader(viewerToken) })

  assert.equal(response.statusCode, 200)
  assert.equal((response.json() as { id: string }).id, commandId)
})

test('POST /rooms/:id/devices/associate is forbidden for a VIEWER', async (t) => {
  const { app, room, device } = await buildTestApp()
  t.after(() => app.close())
  const token = await loginAs(app, 'viewer@test.local', 'viewer-pass')

  const response = await app.inject({
    method: 'POST',
    url: `/rooms/${room.id}/devices/associate`,
    headers: authHeader(token),
    payload: { identifier: `campus-device:v1:${device.id}` }
  })

  assert.equal(response.statusCode, 403)
})

test('POST /rooms/:id/devices/associate associates the scanned device to the room for an ADMIN', async (t) => {
  const { app, rooms, device } = await buildTestApp()
  t.after(() => app.close())
  const token = await loginAs(app, 'admin@test.local', 'admin-pass')
  const targetRoom = await rooms.create('Salle 2')

  const response = await app.inject({
    method: 'POST',
    url: `/rooms/${targetRoom.id}/devices/associate`,
    headers: authHeader(token),
    payload: { identifier: `campus-device:v1:${device.id}` }
  })

  assert.equal(response.statusCode, 200)
  assert.equal((response.json() as { roomId: string }).roomId, targetRoom.id)
})

test('POST /rooms/:id/devices/associate returns 400 for an invalid QR format', async (t) => {
  const { app, room } = await buildTestApp()
  t.after(() => app.close())
  const token = await loginAs(app, 'admin@test.local', 'admin-pass')

  const response = await app.inject({
    method: 'POST',
    url: `/rooms/${room.id}/devices/associate`,
    headers: authHeader(token),
    payload: { identifier: 'ceci-n-est-pas-un-objet' }
  })

  assert.equal(response.statusCode, 400)
})

test('POST /rooms/:id/devices/associate returns 404 for a well-formed but unknown device', async (t) => {
  const { app, room } = await buildTestApp()
  t.after(() => app.close())
  const token = await loginAs(app, 'admin@test.local', 'admin-pass')

  const response = await app.inject({
    method: 'POST',
    url: `/rooms/${room.id}/devices/associate`,
    headers: authHeader(token),
    payload: { identifier: 'campus-device:v1:sensor-999' }
  })

  assert.equal(response.statusCode, 404)
})
