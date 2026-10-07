import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { CommandService } from '../../../domain/services/CommandService'
import { CommandRepository } from '../../../domain/ports/CommandRepository'

// Forme seulement : le type et les paramètres autorisés sont une règle
// métier, validée par le domaine (commandCatalog, ADR 0014).
const createCommandSchema = z.object({
  type: z.string().min(1),
  params: z.record(z.unknown()).default({})
})

export interface CommandRoutesDeps {
  commandService: CommandService
  commands: CommandRepository
}

export default async function commandRoutes(fastify: FastifyInstance, deps: CommandRoutesDeps): Promise<void> {
  fastify.post(
    '/devices/:id/commands',
    { preHandler: [fastify.authenticate, fastify.requireRole('ADMIN', 'OPERATOR')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const body = createCommandSchema.parse(request.body)
      const command = await deps.commandService.dispatch({
        deviceId: id,
        type: body.type,
        params: body.params
      })
      // 202 Accepted, pas 201 : la demande est acceptée mais son exécution
      // n'est PAS encore confirmée — suivre son état via GET /commands/:id.
      return reply.code(202).send(command)
    }
  )

  fastify.get('/commands/:id', { preHandler: fastify.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const command = await deps.commands.findById(id)
    if (command === null) return reply.code(404).send({ error: 'not found' })
    return command
  })
}
