import { z } from 'zod'

/**
 * PLACEHOLDER en attendant le contrat exact du kit IoT — voir
 * docs/decisions/0004-contrat-mqtt-placeholder.md. À remplacer par le
 * schéma réel (types de mesures, unités, bornes) une fois connu.
 */
export const incomingMeasurementSchema = z.object({
  type: z.string().min(1),
  value: z.number(),
  unit: z.string().optional(),
  timestamp: z.string().datetime()
})

export type IncomingMeasurementPayload = z.infer<typeof incomingMeasurementSchema>

export const incomingCommandAckSchema = z.object({
  commandId: z.string().min(1),
  acknowledgedAt: z.string().datetime().optional()
})

export type IncomingCommandAckPayload = z.infer<typeof incomingCommandAckSchema>
