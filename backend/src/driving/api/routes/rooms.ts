import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { RoomRepository } from '../../../domain/ports/RoomRepository'
import { DeviceRepository } from '../../../domain/ports/DeviceRepository'
import { MeasurementRepository } from '../../../domain/ports/MeasurementRepository'

const createRoomSchema = z.object({ name: z.string().min(1) })

export interface RoomRoutesDeps {
  rooms: RoomRepository
  devices: DeviceRepository
  measurements: MeasurementRepository
}

export default async function roomRoutes(fastify: FastifyInstance, deps: RoomRoutesDeps): Promise<void> {
  fastify.get('/rooms', { preHandler: fastify.authenticate }, async () => {
    return deps.rooms.findAll()
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

    const perDevice = await Promise.all(
      devices.map(async (device) => {
        const latest = await deps.measurements.findLatestByDeviceGroupedByType(device.id)
        return latest.map((measurement) => ({ ...measurement, deviceName: device.name }))
      })
    )

    return perDevice.flat().sort((a, b) => a.type.localeCompare(b.type))
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
