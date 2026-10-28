export type AlertReason = 'above_max' | 'below_min'

/**
 * Incident de seuil sur un couple (device, type de mesure), avec un cycle de
 * vie : ouvert par la première mesure hors seuil, résolu par la première
 * mesure revenue dans la zone normale (hystérésis comprise) — voir
 * domain/services/alerts.ts et ADR 0014. Les mesures intermédiaires ne
 * créent jamais de nouvelle alerte : elles mettent seulement à jour
 * `lastValue`/`lastSeenAt`.
 */
export interface Alert {
  id: string
  deviceId: string
  measurementType: string
  reason: AlertReason
  /** Seuil franchi (max pour `above_max`, min pour `below_min`). */
  threshold: number
  triggerValue: number
  /** Timestamp de la mesure qui a ouvert l'alerte (horloge du device). */
  openedAt: Date
  /** `eventId` de la mesure d'ouverture, pour la retrouver dans les logs. */
  openedEventId: string | null
  lastValue: number
  lastSeenAt: Date
  resolvedAt: Date | null
  resolvedValue: number | null
  resolvedEventId: string | null
}

export interface NewAlert {
  deviceId: string
  measurementType: string
  reason: AlertReason
  threshold: number
  triggerValue: number
  openedAt: Date
  openedEventId: string | null
}

export interface AlertUpdate {
  value: number
  at: Date
  eventId: string | null
}
