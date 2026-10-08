import { Command } from '../api/client'

/**
 * Texte affiché pour une commande : il dit exactement ce que le système
 * sait, ni plus ni moins (J4, ADR 0014). Règles :
 * - rien n'est présenté comme réussi avant l'ACK de l'objet (ACKNOWLEDGED) ;
 * - SENT = « transmise », jamais « reçue » ni « appliquée » ;
 * - TIMEOUT n'est PAS un échec : l'objet a pu exécuter, on ne sait pas.
 */
export type CommandTone = 'pending' | 'success' | 'error' | 'unknown'

export interface CommandDescription {
  tone: CommandTone
  title: string
  detail?: string
}

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function actionLabel(command: Command): string {
  if (command.type === 'set_ventilation') return command.params.on === true ? 'Allumer la ventilation' : 'Éteindre la ventilation'
  if (command.type === 'set_target_temperature') return `Consigne à ${String(command.params.value)} °C`
  return command.type
}

function confirmedLabel(command: Command): string {
  const state = command.reportedState
  if (command.type === 'set_ventilation' && state && typeof state.ventilation === 'string') {
    return state.ventilation === 'on' ? 'Ventilation allumée' : 'Ventilation éteinte'
  }
  if (command.type === 'set_target_temperature' && state && typeof state.target_temperature === 'number') {
    return `Consigne réglée à ${state.target_temperature} °C`
  }
  return 'Commande exécutée'
}

function failureLabel(reason: string | null): string {
  if (reason === 'broker_unavailable') return "Serveur de messagerie injoignable : rien n'a été envoyé à l'objet."
  if (reason === 'expired_on_device') return "Reçue trop tard par l'objet : elle n'a pas été exécutée."
  if (reason?.startsWith('rejected_by_device')) return "L'objet a refusé la commande."
  return "La commande n'a pas été exécutée."
}

export function describeCommand(command: Command): CommandDescription {
  const action = actionLabel(command)
  switch (command.status) {
    case 'PENDING':
      return { tone: 'pending', title: 'Demande enregistrée…', detail: `${action} — transmission à l'objet en cours` }
    case 'SENT':
      return {
        tone: 'pending',
        title: "En attente de confirmation de l'objet…",
        detail: `${action} — transmise, réponse attendue avant ${time(command.expiresAt)}`
      }
    case 'ACKNOWLEDGED':
      return {
        tone: 'success',
        title: `✓ ${confirmedLabel(command)}`,
        detail: `Confirmé par l'objet à ${time(command.ackedAt ?? command.createdAt)}`
      }
    case 'FAILED':
      return { tone: 'error', title: `✗ ${action} : échec`, detail: failureLabel(command.failureReason) }
    case 'TIMEOUT': {
      const late = command.lateAck
      const lateDetail =
        late === null
          ? "L'état réel est inconnu : l'objet a peut-être exécuté la commande sans que sa réponse nous parvienne."
          : // late.at = heure déclarée par l'objet (acked_at), pas l'heure de
            // réception de sa réponse, qui est arrivée APRÈS le délai.
            late.status === 'executed'
            ? `L'objet a finalement répondu après le délai : commande exécutée à ${time(late.at)}.`
            : "L'objet a finalement répondu après le délai : commande non exécutée."
      return { tone: 'unknown', title: '⚠ Pas de confirmation de l\'objet', detail: `${action} — ${lateDetail}` }
    }
  }
}

export function isOpen(command: Command): boolean {
  return command.status === 'PENDING' || command.status === 'SENT'
}
