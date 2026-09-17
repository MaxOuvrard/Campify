import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import LoginScreen from './src/screens/LoginScreen';
import RoomListScreen from './src/screens/RoomListScreen';
import RoomDetailScreen from './src/screens/RoomDetailScreen';
import ScanDeviceScreen from './src/screens/ScanDeviceScreen';
import { useAppStore } from './src/store/appStore';

export default function App() {
  const token = useAppStore((state) => state.token);
  const selectedRoom = useAppStore((state) => state.selectedRoom);
  const isScanning = useAppStore((state) => state.isScanning);
  const login = useAppStore((state) => state.login);
  const selectRoom = useAppStore((state) => state.selectRoom);
  const backToRoomList = useAppStore((state) => state.backToRoomList);
  const startScan = useAppStore((state) => state.startScan);
  const stopScan = useAppStore((state) => state.stopScan);

  return (
    <View style={styles.container}>
      {token === null ? (
        <LoginScreen onLoggedIn={login} />
      ) : selectedRoom === null ? (
        <RoomListScreen token={token} onSelectRoom={selectRoom} />
      ) : isScanning ? (
        <ScanDeviceScreen token={token} room={selectedRoom} onAssociated={stopScan} onCancel={stopScan} />
      ) : (
        <RoomDetailScreen token={token} room={selectedRoom} onBack={backToRoomList} onScanDevice={startScan} />
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
