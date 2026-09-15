import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { UserRepository } from '../../../domain/ports/UserRepository'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
})

export interface AuthRoutesDeps {
  users: UserRepository
}

export default async function authRoutes(fastify: FastifyInstance, deps: AuthRoutesDeps): Promise<void> {
  fastify.post('/auth/login', async (request, reply) => {
    const body = loginSchema.parse(request.body)
    const user = await deps.users.findByEmail(body.email)
    if (user === null) {
      return reply.code(401).send({ error: 'invalid credentials' })
    }

    const valid = await bcrypt.compare(body.password, user.passwordHash)
    if (!valid) {
      return reply.code(401).send({ error: 'invalid credentials' })
    }

    const token = await reply.jwtSign({ sub: user.id, role: user.role })
    return { token }
  })
}
