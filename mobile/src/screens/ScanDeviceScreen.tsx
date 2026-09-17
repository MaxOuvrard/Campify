import { useRef, useState } from 'react'
import { ActivityIndicator, Linking, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { ApiError, associateDevice, AssociatedDevice, Room } from '../api/client'

interface ScanDeviceScreenProps {
  token: string
  room: Room
  onAssociated: (device: AssociatedDevice) => void
  onCancel: () => void
}

type Outcome = { kind: 'success'; device: AssociatedDevice } | { kind: 'error'; message: string }

export default function ScanDeviceScreen({ token, room, onAssociated, onCancel }: ScanDeviceScreenProps) {
  const [permission, requestPermission] = useCameraPermissions()
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [manualCode, setManualCode] = useState('')
  // Un scan déclenche `onBarcodeScanned` en continu tant que le QR reste dans
  // le champ : on verrouille dès la première lecture pour ne pas envoyer la
  // même association en boucle.
  const locked = useRef(false)

  const submit = async (identifier: string) => {
    if (locked.current) return
    locked.current = true
    setSubmitting(true)
    try {
      const device = await associateDevice(token, room.id, identifier)
      setOutcome({ kind: 'success', device })
    } catch (err) {
      setOutcome({ kind: 'error', message: err instanceof ApiError ? err.message : 'Erreur inattendue' })
    } finally {
      setSubmitting(false)
    }
  }

  const retry = () => {
    locked.current = false
    setOutcome(null)
    setManualCode('')
  }

  if (outcome) {
    return (
      <View style={styles.container}>
        {outcome.kind === 'success' ? (
          <>
            <Text style={styles.resultTitle}>Équipement associé</Text>
            <Text style={styles.resultBody}>
              « {outcome.device.name} » est maintenant associé à la salle « {room.name} ».
            </Text>
            <TouchableOpacity style={styles.primaryButton} onPress={() => onAssociated(outcome.device)}>
              <Text style={styles.primaryButtonText}>OK</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.resultTitle}>Association impossible</Text>
            <Text style={[styles.resultBody, styles.error]}>{outcome.message}</Text>
            <TouchableOpacity style={styles.primaryButton} onPress={retry}>
              <Text style={styles.primaryButtonText}>Réessayer</Text>
            </TouchableOpacity>
          </>
        )}
        <TouchableOpacity onPress={onCancel}>
          <Text style={styles.cancel}>Annuler</Text>
        </TouchableOpacity>
      </View>
    )
  }

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    )
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.resultTitle}>Accès à la caméra requis</Text>
        <Text style={styles.resultBody}>Campify a besoin de la caméra pour scanner le QR code d'un équipement.</Text>
        {permission.canAskAgain ? (
          <TouchableOpacity style={styles.primaryButton} onPress={() => void requestPermission()}>
            <Text style={styles.primaryButtonText}>Autoriser la caméra</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.primaryButton} onPress={() => void Linking.openSettings()}>
            <Text style={styles.primaryButtonText}>Ouvrir les réglages</Text>
          </TouchableOpacity>
        )}
        <ManualEntry
          value={manualCode}
          onChangeText={setManualCode}
          onSubmit={() => void submit(manualCode)}
          disabled={submitting}
        />
        <TouchableOpacity onPress={onCancel}>
          <Text style={styles.cancel}>Annuler</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Scanner un équipement — {room.name}</Text>
      <View style={styles.cameraFrame}>
        <CameraView
          style={StyleSheet.absoluteFill}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={(result) => void submit(result.data)}
        />
        {submitting && (
          <View style={styles.cameraOverlay}>
            <ActivityIndicator size="large" color="#fff" />
          </View>
        )}
      </View>
      <ManualEntry value={manualCode} onChangeText={setManualCode} onSubmit={() => void submit(manualCode)} disabled={submitting} />
      <TouchableOpacity onPress={onCancel}>
        <Text style={styles.cancel}>Annuler</Text>
      </TouchableOpacity>
    </View>
  )
}

function ManualEntry({
  value,
  onChangeText,
  onSubmit,
  disabled
}: {
  value: string
  onChangeText: (text: string) => void
  onSubmit: () => void
  disabled: boolean
}) {
  return (
    <View style={styles.manualEntry}>
      <Text style={styles.manualLabel}>Ou saisir le code manuellement</Text>
      <View style={styles.manualRow}>
        <TextInput
          style={styles.manualInput}
          placeholder="campus-device:v1:..."
          autoCapitalize="none"
          autoCorrect={false}
          value={value}
          onChangeText={onChangeText}
        />
        <TouchableOpacity
          style={[styles.manualButton, (disabled || value.trim().length === 0) && styles.manualButtonDisabled]}
          onPress={onSubmit}
          disabled={disabled || value.trim().length === 0}
        >
          <Text style={styles.manualButtonText}>Valider</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    padding: 24,
    alignItems: 'center',
    marginTop: 36
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
    textAlign: 'center'
  },
  cameraFrame: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#000'
  },
  cameraOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  resultTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center'
  },
  resultBody: {
    fontSize: 15,
    color: '#444',
    textAlign: 'center',
    marginBottom: 24
  },
  error: {
    color: '#c0392b'
  },
  primaryButton: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
    marginBottom: 16
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '600'
  },
  cancel: {
    color: '#888',
    marginTop: 16
  },
  manualEntry: {
    width: '100%',
    marginTop: 20
  },
  manualLabel: {
    fontSize: 13,
    color: '#666',
    marginBottom: 8,
    textAlign: 'center'
  },
  manualRow: {
    flexDirection: 'row',
    gap: 8
  },
  manualInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10
  },
  manualButton: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    paddingHorizontal: 16,
    justifyContent: 'center'
  },
  manualButtonDisabled: {
    backgroundColor: '#a5b4d8'
  },
  manualButtonText: {
    color: '#fff',
    fontWeight: '600'
  }
})
