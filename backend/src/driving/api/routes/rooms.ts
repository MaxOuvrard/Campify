import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { RoomRepository } from '../../../domain/ports/RoomRepository'
import { DeviceRepository } from '../../../domain/ports/DeviceRepository'

const createRoomSchema = z.object({ name: z.string().min(1) })

export interface RoomRoutesDeps {
  rooms: RoomRepository
  devices: DeviceRepository
}

export default async function roomRoutes(fastify: FastifyInstance, deps: RoomRoutesDeps): Promise<void> {
  fastify.get('/rooms', { preHandler: fastify.authenticate }, async () => {
    return deps.rooms.findAll()
  })

  fastify.get('/rooms/:id/devices', { preHandler: fastify.authenticate }, async (request) => {
    const { id } = request.params as { id: string }
    return deps.devices.findByRoom(id)
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
