import fp from 'fastify-plugin'
import jwt from '@fastify/jwt'
import { FastifyReply, FastifyRequest } from 'fastify'
import { Role } from '../../../domain/entities/User'

export interface AuthPluginOptions {
  secret: string
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; role: Role }
    user: { sub: string; role: Role }
  }
}

export default fp<AuthPluginOptions>(async (fastify, opts) => {
  await fastify.register(jwt, { secret: opts.secret })

  fastify.decorate('authenticate', async function (request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify()
    } catch {
      await reply.code(401).send({ error: 'unauthorized' })
    }
  })
})
