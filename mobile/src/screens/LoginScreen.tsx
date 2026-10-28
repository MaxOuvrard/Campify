import { useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { ApiError, login } from '../api/client'
import { colors } from '../theme/colors'

interface LoginScreenProps {
  onLoggedIn: (token: string) => void
}

export default function LoginScreen({ onLoggedIn }: LoginScreenProps) {
  const [email, setEmail] = useState('demo@campify.local')
  const [password, setPassword] = useState('campify-demo')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    setLoading(true)
    setError(null)
    try {
      const token = await login(email, password)
      onLoggedIn(token)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur inattendue')
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title} accessibilityRole="header">
        Campify
      </Text>

      {/* Libellé visible au-dessus du champ (un placeholder disparaît dès la saisie) et annoncé par le lecteur d'écran. */}
      <Text style={styles.label}>Email</Text>
      <TextInput
        style={styles.input}
        accessibilityLabel="Email"
        placeholder="nom@exemple.fr"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <Text style={styles.label}>Mot de passe</Text>
      <TextInput
        style={styles.input}
        accessibilityLabel="Mot de passe"
        placeholderTextColor={colors.textMuted}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      {error && (
        <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
          {error}
        </Text>
      )}

      <TouchableOpacity
        style={styles.button}
        onPress={handleSubmit}
        disabled={loading}
        accessibilityRole="button"
        accessibilityLabel="Se connecter"
        accessibilityState={{ busy: loading, disabled: loading }}
      >
        {loading ? <ActivityIndicator color={colors.onFilled} /> : <Text style={styles.buttonText}>Se connecter</Text>}
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 32
  },
  label: {
    alignSelf: 'flex-start',
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4
  },
  input: {
    width: '100%',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12
  },
  error: {
    color: colors.danger,
    marginBottom: 12,
    textAlign: 'center'
  },
  button: {
    width: '100%',
    backgroundColor: colors.filledPrimary,
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginTop: 8
  },
  buttonText: {
    color: colors.onFilled,
    fontWeight: '600'
  }
})
