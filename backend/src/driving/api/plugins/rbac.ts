import fp from 'fastify-plugin'
import { FastifyReply, FastifyRequest } from 'fastify'
import { Role } from '../../../domain/entities/User'

declare module 'fastify' {
  interface FastifyInstance {
    requireRole: (...roles: Role[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

/**
 * Distingue droits de consultation (toute route avec `authenticate` seul)
 * et droits de commande (routes qui ajoutent `requireRole('ADMIN', 'OPERATOR')`).
 */
export default fp(async (fastify) => {
  fastify.decorate('requireRole', (...roles: Role[]) => {
    return async function (request: FastifyRequest, reply: FastifyReply) {
      if (!roles.includes(request.user.role)) {
        await reply.code(403).send({ error: 'forbidden' })
      }
    }
  })
})
