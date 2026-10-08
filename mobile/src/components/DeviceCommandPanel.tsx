import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useDeviceCommand } from '../hooks/useDeviceCommand'
import { CommandTone, describeCommand } from '../utils/commandStatus'

interface DeviceCommandPanelProps {
  token: string
  deviceId: string
  /** Téléphone hors ligne : aucune demande ne peut partir. */
  offline: boolean
}

const TONE_COLORS: Record<CommandTone, { background: string; text: string }> = {
  pending: { background: '#e0e7ff', text: '#3730a3' },
  success: { background: '#dcfce7', text: '#166534' },
  error: { background: '#fee2e2', text: '#991b1b' },
  unknown: { background: '#fef3c7', text: '#92400e' }
}

/**
 * Pilotage de la ventilation d'un capteur (J4). Les boutons ne changent
 * jamais d'eux-mêmes un « état » affiché : seul ce que le backend renvoie
 * (et donc l'ACK de l'objet) est montré — voir utils/commandStatus.ts.
 */
export default function DeviceCommandPanel({ token, deviceId, offline }: DeviceCommandPanelProps) {
  const { phase, send, busy } = useDeviceCommand(token, deviceId)
  const disabled = busy || offline

  const description = phase.kind === 'tracking' || phase.kind === 'stale' ? describeCommand(phase.command) : null
  const colors = description ? TONE_COLORS[description.tone] : null

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Ventilation</Text>
      <View style={styles.buttons}>
        {[
          { on: true, text: 'Allumer' },
          { on: false, text: 'Éteindre' }
        ].map(({ on, text }) => (
          <TouchableOpacity
            key={text}
            accessibilityRole="button"
            accessibilityState={{ disabled }}
            disabled={disabled}
            style={[styles.button, disabled && styles.buttonDisabled]}
            onPress={() => void send({ type: 'set_ventilation', params: { on } })}
          >
            <Text style={styles.buttonText}>{text}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {offline && phase.kind === 'idle' && <Text style={styles.hint}>Téléphone hors ligne : commande impossible.</Text>}

      {phase.kind === 'sending' && (
        <View style={[styles.status, { backgroundColor: TONE_COLORS.pending.background }]}>
          <ActivityIndicator size="small" />
          <Text style={[styles.statusTitle, { color: TONE_COLORS.pending.text }]}>
            {phase.attempt === 1 ? 'Envoi de la demande…' : `Connexion perdue, nouvel essai (${phase.attempt - 1})…`}
          </Text>
        </View>
      )}

      {phase.kind === 'error' && (
        <View style={[styles.status, { backgroundColor: TONE_COLORS.error.background }]}>
          <Text style={[styles.statusTitle, { color: TONE_COLORS.error.text }]}>{phase.message}</Text>
        </View>
      )}

      {description && colors && (
        <View style={[styles.status, { backgroundColor: colors.background }]}>
          {description.tone === 'pending' && phase.kind === 'tracking' && <ActivityIndicator size="small" />}
          <View style={styles.statusTextBlock}>
            <Text style={[styles.statusTitle, { color: colors.text }]}>{description.title}</Text>
            {description.detail && <Text style={[styles.statusDetail, { color: colors.text }]}>{description.detail}</Text>}
            {phase.kind === 'stale' && (
              <Text style={[styles.statusDetail, { color: colors.text }]}>
                Le serveur n'a toujours pas statué : suivi interrompu, état inconnu.
              </Text>
            )}
          </View>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#e2e5e9'
  },
  label: {
    fontSize: 14,
    color: '#555',
    marginBottom: 8
  },
  buttons: {
    flexDirection: 'row',
    gap: 8
  },
  button: {
    flex: 1,
    backgroundColor: '#2563eb',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center'
  },
  buttonDisabled: {
    backgroundColor: '#9ca3af'
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600'
  },
  hint: {
    fontSize: 12,
    color: '#888',
    marginTop: 8
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 8,
    padding: 10,
    marginTop: 10
  },
  statusTextBlock: {
    flex: 1
  },
  statusTitle: {
    fontSize: 13,
    fontWeight: '600'
  },
  statusDetail: {
    fontSize: 12,
    marginTop: 2
  }
})
