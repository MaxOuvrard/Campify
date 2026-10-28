import { Alert, AlertReason } from '../entities/Alert'

/**
 * Seuil d'alerte d'un type de mesure. `hysteresis` est la marge à
 * repasser pour revenir à la normale : une alerte `above_max` ne se
 * résout qu'à `value <= max - hysteresis`, une `below_min` qu'à
 * `value >= min + hysteresis`. Sans elle, une valeur qui oscille autour du
 * seuil ouvrirait et fermerait une alerte à chaque mesure. Un seul seuil
 * par type (le premier trouvé s'applique).
 */
export interface AlertThreshold {
  type: string
  min?: number
  max?: number
  hysteresis: number
}

export type AlertStatus = 'open' | 'resolved'

export function alertStatus(alert: Alert): AlertStatus {
  return alert.resolvedAt === null ? 'open' : 'resolved'
}

export type AlertTransition =
  | { kind: 'none' }
  | { kind: 'open'; reason: AlertReason; threshold: number }
  | { kind: 'ongoing' }
  | { kind: 'resolve'; reopen?: { reason: AlertReason; threshold: number } }

function breachOf(value: number, threshold: AlertThreshold): { reason: AlertReason; threshold: number } | null {
  if (threshold.max !== undefined && value > threshold.max) return { reason: 'above_max', threshold: threshold.max }
  if (threshold.min !== undefined && value < threshold.min) return { reason: 'below_min', threshold: threshold.min }
  return null
}

function hasRecovered(value: number, open: Alert, threshold: AlertThreshold): boolean {
  return open.reason === 'above_max'
    ? value <= open.threshold - threshold.hysteresis
    : value >= open.threshold + threshold.hysteresis
}

/**
 * Décide ce qu'une mesure acceptée change à l'alerte de son couple
 * (device, type) — voir ADR 0015. Fonction pure : l'état courant (`open`)
 * est fourni par l'appelant, la décision ne dépend que de lui et de la
 * valeur.
 *
 * - pas d'alerte ouverte, valeur hors seuil → `open` ;
 * - alerte ouverte, valeur toujours hors seuil ou dans la marge
 *   d'hystérésis → `ongoing` (jamais de seconde alerte) ;
 * - alerte ouverte, valeur revenue sous la marge → `resolve` ; si elle a
 *   franchi le seuil opposé d'un coup, `reopen` porte la nouvelle alerte.
 */
export function decideAlertTransition(open: Alert | null, value: number, threshold: AlertThreshold): AlertTransition {
  const breach = breachOf(value, threshold)

  if (open === null) {
    return breach ? { kind: 'open', ...breach } : { kind: 'none' }
  }

  if (breach && breach.reason !== open.reason) return { kind: 'resolve', reopen: breach }
  if (!breach && hasRecovered(value, open, threshold)) return { kind: 'resolve' }
  return { kind: 'ongoing' }
}
