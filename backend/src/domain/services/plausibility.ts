export interface PlausibilityRange {
  type: string
  min: number
  max: number
}

/**
 * Une mesure physiquement impossible (capteur défaillant, payload corrompu,
 * bug d'un client) ne doit jamais remplacer silencieusement l'état courant.
 * Contrairement aux seuils d'alerte (`alerts.ts`, qui signalent une valeur
 * plausible mais préoccupante), une borne de plausibilité définit ce qui ne
 * peut tout simplement pas être une mesure réelle pour ce type de capteur.
 *
 * Sans borne connue pour un `type` donné, on ne rejette pas : seul un NaN/
 * Infinity (valeur non finie, impossible pour toute grandeur physique) est
 * rejeté par défaut.
 */
export function isPlausibleValue(type: string, value: number, ranges: PlausibilityRange[]): boolean {
  if (!Number.isFinite(value)) return false

  const range = ranges.find((r) => r.type === type)
  if (!range) return true

  return value >= range.min && value <= range.max
}
