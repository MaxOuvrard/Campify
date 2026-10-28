export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' })
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

const METRIC_LABELS: Record<string, string> = {
  temperature: 'Température',
  co2: 'CO₂'
}

export function metricLabel(type: string): string {
  return METRIC_LABELS[type] ?? type
}

// Libellé accordé par métrique ("CO₂ trop élevé", "Température trop
// basse") : jamais le code brut `above_max`/`below_min` à l'écran.
const ALERT_LABELS: Record<string, Record<'above_max' | 'below_min', string>> = {
  temperature: { above_max: 'Température trop élevée', below_min: 'Température trop basse' },
  co2: { above_max: 'CO₂ trop élevé', below_min: 'CO₂ trop bas' }
}

export function alertLabel(type: string, reason: 'above_max' | 'below_min'): string {
  return ALERT_LABELS[type]?.[reason] ?? `${metricLabel(type)} ${reason === 'above_max' ? 'au-dessus' : 'en dessous'} du seuil`
}

export function openAlertCountLabel(count: number): string {
  return count === 1 ? '1 alerte en cours' : `${count} alertes en cours`
}
