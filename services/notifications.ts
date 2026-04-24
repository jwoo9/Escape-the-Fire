import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// Configure how the app behaves when a notification arrives while the app is open
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export const requestNotificationPermissions = async () => {
  if (Platform.OS === 'web') return false;
  
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  return finalStatus === 'granted';
};

let lastTrigger = 0;

export const sendEmergencyNotification = async (title: string, body: string) => {
  if (Platform.OS === 'web') return;

  const now = Date.now();
  if (now - lastTrigger < 10000) return; // Prevent spamming multiple notifications within 10 seconds
  lastTrigger = now;

  await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: true, priority: Notifications.AndroidNotificationPriority.MAX },
    trigger: null, // trigger immediately
  });
};