import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import LoginScreen from './src/screens/LoginScreen';

export default function App() {
  const [token, setToken] = useState<string | null>(null);

  return (
    <View style={styles.container}>
      {token === null ? (
        <LoginScreen onLoggedIn={setToken} />
      ) : (
        // Prochaine étape : écran salle (température/CO2), voir feature 5.
        <Text>Connecté ✅</Text>
      )}
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
});
