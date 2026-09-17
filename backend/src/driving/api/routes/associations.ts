import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { DeviceAssociationService } from '../../../domain/services/deviceAssociation'

const associateSchema = z.object({ identifier: z.string().min(1) })

export interface AssociationRoutesDeps {
  deviceAssociationService: DeviceAssociationService
}

export default async function associationRoutes(fastify: FastifyInstance, deps: AssociationRoutesDeps): Promise<void> {
  fastify.post(
    '/rooms/:id/devices/associate',
    { preHandler: [fastify.authenticate, fastify.requireRole('ADMIN', 'OPERATOR')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const body = associateSchema.parse(request.body)
      const device = await deps.deviceAssociationService.associate(body.identifier, id)
      return reply.code(200).send(device)
    }
  )
}
