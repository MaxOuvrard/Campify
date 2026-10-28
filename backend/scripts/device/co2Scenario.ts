/**
 * Profils de CO2 déterministes pour la démonstration J5 des alertes
 * (ADR 0015) : contrairement à la marche aléatoire du simulateur, qui finit
 * par faire passer toutes les salles au-dessus du seuil, ils permettent de
 * rejouer à l'identique « une salle en alerte, les autres normales ».
 *
 * Définis en temps écoulé (et non en nombre de messages) : le pic dure
 * toujours ~2 min, que le device publie toutes les 2 s ou toutes les 50 ms
 * (test sous flux plus important).
 */
export type Co2Profile = 'calm' | 'spike'

const SECOND = 1000

/**
 * Phases du pic, choisies autour des seuils de composition.ts (ouverture
 * > 1000 ppm, retour à la normale ≤ 900 ppm) :
 *
 * - 0–20 s : 600 ppm (normal) ;
 * - 20–50 s : montée linéaire jusqu'à 1200 ppm → l'alerte s'ouvre vers 1000 ;
 * - 50–90 s : plateau à 1200 ppm → mesures hors seuil, aucune nouvelle alerte ;
 * - 90–120 s : descente jusqu'à 800 ppm → entre 1000 et 900, toujours en
 *   alerte (hystérésis), retour à la normale sous 900 ;
 * - au-delà : 800 ppm (normal).
 */
export const SPIKE_PHASES_MS = { rampUp: 20 * SECOND, plateau: 50 * SECOND, rampDown: 90 * SECOND, end: 120 * SECOND }

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * Math.min(Math.max(t, 0), 1)
}

/**
 * Valeur de CO2 du profil à `elapsedMs` du démarrage. `jitter` ∈ [-1, 1]
 * ajoute ±20 ppm de bruit (réalisme), sans jamais faire franchir un seuil à
 * une phase qui ne le franchit pas : `calm` reste entre 580 et 620 ppm.
 */
export function co2At(profile: Co2Profile, elapsedMs: number, jitter = 0): number {
  const noise = 20 * Math.min(Math.max(jitter, -1), 1)
  if (profile === 'calm') return 600 + noise

  const { rampUp, plateau, rampDown, end } = SPIKE_PHASES_MS
  let base: number
  if (elapsedMs < rampUp) base = 600
  else if (elapsedMs < plateau) base = lerp(600, 1200, (elapsedMs - rampUp) / (plateau - rampUp))
  else if (elapsedMs < rampDown) base = 1200
  else if (elapsedMs < end) base = lerp(1200, 800, (elapsedMs - rampDown) / (end - rampDown))
  else base = 800
  return base + noise
}
