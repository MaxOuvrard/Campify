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
