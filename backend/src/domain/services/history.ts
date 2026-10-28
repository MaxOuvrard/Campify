export const DEFAULT_HISTORY_SPAN_MS = 24 * 60 * 60 * 1000
export const MAX_HISTORY_SPAN_MS = 7 * 24 * 60 * 60 * 1000
export const MAX_HISTORY_POINTS = 500

export interface HistoryRangeInput {
  from?: Date
  to?: Date
}

export interface HistoryRange {
  from: Date
  to: Date
  limit: number
}

/**
 * Résout la plage effective d'un historique de mesures : fenêtre par défaut
 * (24h) quand rien n'est demandé, plage clampée à MAX_HISTORY_SPAN_MS et
 * nombre de points plafonné à MAX_HISTORY_POINTS, pour qu'un client ne
 * puisse jamais déclencher une requête de stockage illimitée.
 */
export function resolveHistoryRange(input: HistoryRangeInput, now: Date): HistoryRange {
  const to = input.to ?? now
  const requestedFrom = input.from ?? new Date(to.getTime() - DEFAULT_HISTORY_SPAN_MS)
  const minAllowedFrom = new Date(to.getTime() - MAX_HISTORY_SPAN_MS)
  const from = requestedFrom < minAllowedFrom ? minAllowedFrom : requestedFrom

  return { from, to, limit: MAX_HISTORY_POINTS }
}

/**
 * Historique agrégé : au plus MAX_HISTORY_BUCKETS intervalles sur toute la
 * plage, quelle que soit la cadence d'émission. Sans ça, prendre les
 * MAX_HISTORY_POINTS dernières mesures brutes d'une fenêtre de 24h ne
 * couvre que quelques minutes au rythme du kit (une mesure toutes les 2s,
 * 2 métriques) — et d'autant moins que le flux augmente. Chaque intervalle
 * garde min/max en plus de la moyenne : un pic bref reste visible.
 */
export const MAX_HISTORY_BUCKETS = 500

// Tailles « rondes » pour que les graduations restent lisibles ; chacune
// divise exactement une journée, donc les intervalles tombent toujours au
// même endroit d'un jour à l'autre.
const BUCKET_SIZES_MS = [1, 5, 10, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200].map((s) => s * 1000)

/**
 * Plus petite taille ronde telle que la plage tienne en MAX_HISTORY_BUCKETS
 * intervalles, en comptant les deux intervalles partiels possibles aux
 * extrémités.
 */
export function resolveBucketMs(range: { from: Date; to: Date }): number {
  const spanMs = Math.max(range.to.getTime() - range.from.getTime(), 0)
  const minBucketMs = spanMs / (MAX_HISTORY_BUCKETS - 1)
  return BUCKET_SIZES_MS.find((size) => size >= minBucketMs) ?? BUCKET_SIZES_MS[BUCKET_SIZES_MS.length - 1]
}
