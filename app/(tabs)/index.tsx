import { StyleSheet, View, Button, Alert } from 'react-native';
import FloorMap from '@/components/FloorMap';
import { MAIN_FLOOR } from '@/constants/mapData';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { HelloWave } from '@/components/hello-wave';
import ParallaxScrollView from '@/components/parallax-scroll-view';
import { triggerEmergency, clearEmergency, subscribeEmergency } from '../../services/emergency';
import { useAuth } from '../../context/AuthContext';
import { useEffect, useState } from 'react';

export default function HomeScreen() {
  const { user } = useAuth();
  const [emergency, setEmergency] = useState<any>({ active: false });

  useEffect(() => {
    const unsub = subscribeEmergency(setEmergency);
    return unsub;
  }, []);

  const handleTriggerEmergency = () => {
    Alert.alert(
      'Trigger Emergency',
      'Do you want to select hazardous zones?',
      [
        { text: 'No, trigger normally', onPress: () => triggerEmergency(user?.uid || 'unknown', 'Triggered from dashboard') },
        { text: 'Yes, select zones', onPress: () => {
          // For now, just trigger and note to select zones later
          triggerEmergency(user?.uid || 'unknown', 'Triggered with zone selection');
          Alert.alert('Emergency Triggered', 'Please go to the map to select hazardous zones.');
        }},
      ]
    );
  };

  const handleAllClear = () => {
    clearEmergency();
  };

  // Mock data for the map. This can be replaced with live data later.
  const userPosition = { svgX: 500, svgY: 236 }; // Example position in SVG coordinates (center of the map)
  const allStaff = [
    { uid: '1', initials: 'AS', svgX: 250, svgY: 100 },
    { uid: '2', initials: 'JD', svgX: 400, svgY: 200 },
  ];
  const blockedZoneIds = ['room_7'];
  const isEmergency = emergency.active;
  const isAdmin = false;

  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#f1f5f9', dark: '#1D3D47' }}
      headerImage={(
        <FloorMap
          floor={MAIN_FLOOR}
          userPosition={userPosition}
          allStaff={allStaff}
          blockedZoneIds={blockedZoneIds}
          isEmergency={isEmergency}
          isAdmin={isAdmin}
        />
      )}
    >
      <ThemedView style={styles.titleContainer}>
        <ThemedText type="title">Dashboard</ThemedText>
        <HelloWave />
      </ThemedView>
      <ThemedView style={styles.stepContainer}>
        <ThemedText type="subtitle">Emergency Controls</ThemedText>
        <ThemedText>Buttons and information can go here.</ThemedText>
        {emergency.active && (
          <ThemedText style={{ color: 'red', fontWeight: 'bold' }}>EMERGENCY ACTIVE - Evacuation in progress</ThemedText>
        )}
      </ThemedView>
      <View style={styles.buttonContainer}>
        <Button title="Trigger Alarm" onPress={handleTriggerEmergency} />
        <Button title="All Clear" onPress={handleAllClear} />
      </View>
    </ParallaxScrollView>
  );
}

const styles = StyleSheet.create({
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepContainer: {
    gap: 8,
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
});
