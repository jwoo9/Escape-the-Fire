import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { logout } from '../../services/auth';

export default function StaffMap() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Evacuation Map</Text>
      <TouchableOpacity style={styles.button} onPress={logout}>
        <Text style={styles.buttonText}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff', marginBottom: 24 },
  button: { backgroundColor: '#e94560', padding: 16, borderRadius: 8, width: '100%', alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
});