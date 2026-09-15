import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { MeasurementRepository } from '../../../domain/ports/MeasurementRepository'
import { DeviceRepository } from '../../../domain/ports/DeviceRepository'

const rangeQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional()
})

export interface DeviceRoutesDeps {
  devices: DeviceRepository
  measurements: MeasurementRepository
}

export default async function deviceRoutes(fastify: FastifyInstance, deps: DeviceRoutesDeps): Promise<void> {
  fastify.get('/devices/:id', { preHandler: fastify.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const device = await deps.devices.findById(id)
    if (device === null) return reply.code(404).send({ error: 'not found' })
    return device
  })

  fastify.get('/devices/:id/measurements', { preHandler: fastify.authenticate }, async (request) => {
    const { id } = request.params as { id: string }
    const query = rangeQuerySchema.parse(request.query)
    const to = query.to ? new Date(query.to) : new Date()
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - 24 * 60 * 60 * 1000)
    return deps.measurements.findByDeviceInRange(id, from, to)
  })
}
