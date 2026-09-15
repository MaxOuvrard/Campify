import { z } from 'zod'

const metricSchema = z.object({
  value: z.number(),
  unit: z.string().min(1)
})

/**
 * Contrat de télémétrie réel du kit (observé sur le broker de démonstration
 * `campus/v1/devices/{deviceId}/telemetry`) : un message porte plusieurs
 * métriques nommées (ex. `temperature`, `co2`), chacune avec sa valeur et
 * son unité. `device_id`/`room_id` sont redondants avec le topic ; le
 * device est déjà résolu depuis le topic par l'adapter, donc seuls
 * `observed_at` et les métriques sont exploités. Voir
 * docs/decisions/0004-contrat-mqtt-placeholder.md.
 */
export const incomingTelemetrySchema = z
  .object({
    schema_version: z.number(),
    message_id: z.string().min(1),
    device_id: z.string().min(1),
    room_id: z.string().min(1),
    observed_at: z.string().datetime()
  })
  .catchall(metricSchema)

export type IncomingTelemetryPayload = z.infer<typeof incomingTelemetrySchema>

const knownEnvelopeKeys = new Set(['schema_version', 'message_id', 'device_id', 'room_id', 'observed_at'])

export function extractMetrics(payload: IncomingTelemetryPayload): Array<{ type: string; value: number; unit: string }> {
  return Object.entries(payload)
    .filter((entry): entry is [string, z.infer<typeof metricSchema>] => !knownEnvelopeKeys.has(entry[0]))
    .map(([type, metric]) => ({ type, value: metric.value, unit: metric.unit }))
}

export const incomingCommandAckSchema = z.object({
  commandId: z.string().min(1),
  acknowledgedAt: z.string().datetime().optional()
})

export type IncomingCommandAckPayload = z.infer<typeof incomingCommandAckSchema>
