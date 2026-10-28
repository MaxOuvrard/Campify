import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { RoomRepository } from '../../../domain/ports/RoomRepository'
import { DeviceRepository } from '../../../domain/ports/DeviceRepository'
import { MeasurementRepository } from '../../../domain/ports/MeasurementRepository'
import { AlertRepository } from '../../../domain/ports/AlertRepository'
import { isFresh } from '../../../domain/services/freshness'
import { resolveHistoryRange } from '../../../domain/services/history'
import { alertStatus } from '../../../domain/services/alerts'

const createRoomSchema = z.object({ name: z.string().min(1) })

const alertsQuerySchema = z.object({
  status: z.enum(['open', 'all']).default('open'),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional()
})

export interface RoomRoutesDeps {
  rooms: RoomRepository
  devices: DeviceRepository
  measurements: MeasurementRepository
  alerts: AlertRepository
  staleThresholdMs: number
}

// Un device peut avoir plusieurs métriques (température, CO2...) qui ne se
// périment pas forcément au même rythme : la salle est signalée dès qu'au
// moins une métrique d'un de ses devices est périmée, cf. le badge "Capteur
// silencieux" de RoomDetailScreen sur cette même règle de fraîcheur.
async function roomHasSilentDevice(
  roomId: string,
  deps: Pick<RoomRoutesDeps, 'devices' | 'measurements' | 'staleThresholdMs'>
): Promise<boolean> {
  const devices = await deps.devices.findByRoom(roomId)
  const now = new Date()

  for (const device of devices) {
    const latest = await deps.measurements.findLatestByDeviceGroupedByType(device.id)
    if (latest.some((measurement) => !isFresh(measurement.timestamp, now, deps.staleThresholdMs))) {
      return true
    }
  }
  return false
}

export default async function roomRoutes(fastify: FastifyInstance, deps: RoomRoutesDeps): Promise<void> {
  fastify.get('/rooms', { preHandler: fastify.authenticate }, async () => {
    const [rooms, openAlerts] = await Promise.all([deps.rooms.findAll(), deps.alerts.countOpenByRoom()])
    return Promise.all(
      rooms.map(async (room) => ({
        ...room,
        hasSilentDevice: await roomHasSilentDevice(room.id, deps),
        openAlertCount: openAlerts.get(room.id) ?? 0
      }))
    )
  })

  fastify.get('/rooms/:id/devices', { preHandler: fastify.authenticate }, async (request) => {
    const { id } = request.params as { id: string }
    return deps.devices.findByRoom(id)
  })

  // Dernière valeur connue de chaque métrique (température, CO2, ...) pour
  // la salle : agrège la dernière mesure par type sur chacun de ses devices.
  fastify.get('/rooms/:id/measurements/latest', { preHandler: fastify.authenticate }, async (request) => {
    const { id } = request.params as { id: string }
    const devices = await deps.devices.findByRoom(id)
    const now = new Date()

    const perDevice = await Promise.all(
      devices.map(async (device) => {
        const latest = await deps.measurements.findLatestByDeviceGroupedByType(device.id)
        // Fraîcheur de cette mesure précise (son propre timestamp), à
        // distinguer de la présence du device exposée par GET /devices/:id
        // (dérivée de MAX(receivedAt) sur toutes ses mesures) : les deux
        // peuvent diverger sur un device multi-métriques dont les capteurs
        // n'envoient pas au même rythme.
        return latest.map((measurement) => ({
          ...measurement,
          deviceName: device.name,
          fresh: isFresh(measurement.timestamp, now, deps.staleThresholdMs)
        }))
      })
    )

    return perDevice.flat().sort((a, b) => a.type.localeCompare(b.type))
  })

  // Alertes de la salle (ADR 0014) : en cours par défaut — au plus une par
  // device+type, donc bornées par construction —, ou historique avec
  // `status=all`, borné comme celui des mesures (domain/services/history.ts).
  fastify.get('/rooms/:id/alerts', { preHandler: fastify.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const query = alertsQuerySchema.parse(request.query)
    const room = await deps.rooms.findById(id)
    if (room === null) return reply.code(404).send({ error: 'not found' })

    const devices = await deps.devices.findByRoom(id)
    const deviceIds = devices.map((d) => d.id)
    let alerts
    if (query.status === 'open') {
      alerts = await deps.alerts.findOpenByDevices(deviceIds)
    } else {
      const range = resolveHistoryRange(
        { from: query.from ? new Date(query.from) : undefined, to: query.to ? new Date(query.to) : undefined },
        new Date()
      )
      alerts = await deps.alerts.findByDevicesInRange(deviceIds, range.from, range.to, range.limit)
    }

    const nameById = new Map(devices.map((d) => [d.id, d.name]))
    return alerts.map((alert) => ({ ...alert, deviceName: nameById.get(alert.deviceId), status: alertStatus(alert) }))
  })

  fastify.post(
    '/rooms',
    { preHandler: [fastify.authenticate, fastify.requireRole('ADMIN', 'OPERATOR')] },
    async (request, reply) => {
      const body = createRoomSchema.parse(request.body)
      const room = await deps.rooms.create(body.name)
      return reply.code(201).send(room)
    }
  )
}
