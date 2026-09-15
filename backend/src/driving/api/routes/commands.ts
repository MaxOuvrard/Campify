import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { CommandService } from '../../../domain/services/CommandService'
import { CommandRepository } from '../../../domain/ports/CommandRepository'

const createCommandSchema = z.object({
  type: z.string().min(1),
  payload: z.record(z.unknown()).optional()
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
        payload: body.payload ?? null
      })
      return reply.code(201).send(command)
    }
  )

  fastify.get('/commands/:id', { preHandler: fastify.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const command = await deps.commands.findById(id)
    if (command === null) return reply.code(404).send({ error: 'not found' })
    return command
  })
}
