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
