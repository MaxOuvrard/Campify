import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import LoginScreen from './src/screens/LoginScreen';
import RoomListScreen from './src/screens/RoomListScreen';
import RoomDetailScreen from './src/screens/RoomDetailScreen';
import { Room } from './src/api/client';

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);

  return (
    <View style={styles.container}>
      {token === null ? (
        <LoginScreen onLoggedIn={setToken} />
      ) : selectedRoom === null ? (
        <RoomListScreen token={token} onSelectRoom={setSelectedRoom} />
      ) : (
        <RoomDetailScreen token={token} room={selectedRoom} onBack={() => setSelectedRoom(null)} />
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
