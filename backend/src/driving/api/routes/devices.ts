import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { MeasurementRepository } from '../../../domain/ports/MeasurementRepository'
import { DeviceRepository } from '../../../domain/ports/DeviceRepository'
import { resolveHistoryRange } from '../../../domain/services/history'
import { isFresh } from '../../../domain/services/freshness'

const rangeQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional()
})

export interface DeviceRoutesDeps {
  devices: DeviceRepository
  measurements: MeasurementRepository
  staleThresholdMs: number
}

export default async function deviceRoutes(fastify: FastifyInstance, deps: DeviceRoutesDeps): Promise<void> {
  fastify.get('/devices/:id', { preHandler: fastify.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const device = await deps.devices.findById(id)
    if (device === null) return reply.code(404).send({ error: 'not found' })
    // Présence observée du device : dérivée de la dernière mesure reçue
    // (tous types confondus), pas d'un champ mutable dupliqué sur Device —
    // voir domain/services/freshness.ts.
    const lastReceivedAt = await deps.measurements.findLatestReceivedAt(id)
    return { ...device, present: isFresh(lastReceivedAt, new Date(), deps.staleThresholdMs) }
  })

  fastify.get('/devices/:id/measurements', { preHandler: fastify.authenticate }, async (request) => {
    const { id } = request.params as { id: string }
    const query = rangeQuerySchema.parse(request.query)
    const range = resolveHistoryRange(
      {
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined
      },
      new Date()
    )
    return deps.measurements.findByDeviceInRange(id, range.from, range.to, range.limit)
  })
}
