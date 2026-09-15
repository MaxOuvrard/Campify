import Fastify, { FastifyInstance } from 'fastify'
import sensible from '@fastify/sensible'
import { ZodError } from 'zod'
import authPlugin from './plugins/auth'
import rbacPlugin from './plugins/rbac'
import authRoutes, { AuthRoutesDeps } from './routes/auth'
import roomRoutes, { RoomRoutesDeps } from './routes/rooms'
import deviceRoutes, { DeviceRoutesDeps } from './routes/devices'
import commandRoutes, { CommandRoutesDeps } from './routes/commands'
import { NotFoundError, ValidationError, ConflictError } from '../../shared/errors'

export interface ApiDeps extends AuthRoutesDeps, RoomRoutesDeps, DeviceRoutesDeps, CommandRoutesDeps {
  jwtSecret: string
}

export function buildApiServer(deps: ApiDeps): FastifyInstance {
  const fastify = Fastify({ logger: true })

  void fastify.register(sensible)
  void fastify.register(authPlugin, { secret: deps.jwtSecret })
  void fastify.register(rbacPlugin)

  void fastify.register(authRoutes, deps)
  void fastify.register(roomRoutes, deps)
  void fastify.register(deviceRoutes, deps)
  void fastify.register(commandRoutes, deps)

  fastify.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: 'validation_error', details: error.issues })
    }
    if (error instanceof NotFoundError) {
      return reply.code(404).send({ error: error.message })
    }
    if (error instanceof ValidationError) {
      return reply.code(400).send({ error: error.message })
    }
    if (error instanceof ConflictError) {
      return reply.code(409).send({ error: error.message })
    }
    request.log.error(error)
    return reply.code(500).send({ error: 'internal_server_error' })
  })

  return fastify
}
