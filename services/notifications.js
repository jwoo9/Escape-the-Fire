/**
 * Notification Service
 * 
 * Handles push notifications for emergency alerts using expo-notifications.
 * Registers device for push tokens and provides local notification triggers.
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { ref, set } from 'firebase/database';
import { rtdb } from './firebase';

// Configure notification handling
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    priority: Notifications.AndroidNotificationPriority.MAX,
  }),
});

/**
 * Register for push notifications and store token in Firebase
 */
export async function registerForPushNotifications(userId) {
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('Push notification permission not granted');
      return null;
    }

    // Get the Expo push token
    const tokenData = await Notifications.getExpoPushTokenAsync();
    const token = tokenData.data;

    // Store in Firebase for server-side push
    if (userId && token) {
      const tokenRef = ref(rtdb, `pushTokens/${userId}`);
      await set(tokenRef, { token, platform: Platform.OS, updatedAt: Date.now() });
    }

    // Configure Android channel
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('emergency', {
        name: 'Emergency Alerts',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 500, 200, 500],
        lightColor: '#FF0000',
        sound: 'default',
      });
    }

    return token;
  } catch (error) {
    console.error('Error registering for push notifications:', error);
    return null;
  }
}

/**
 * Send a local emergency notification
 */
export async function sendLocalEmergencyNotification(title, body) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: title || '🚨 EMERGENCY ALERT',
      body: body || 'An emergency has been reported. Open the app for evacuation instructions.',
      sound: 'default',
      priority: Notifications.AndroidNotificationPriority.MAX,
      ...(Platform.OS === 'android' && { channelId: 'emergency' }),
    },
    trigger: null, // Immediate
  });
}

/**
 * Send a local announcement notification
 */
export async function sendLocalAnnouncementNotification(message, sender) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `📢 Announcement from ${sender || 'Admin'}`,
      body: message,
      sound: 'default',
    },
    trigger: null,
  });
}

/**
 * Add a listener for notification responses (when user taps a notification)
 */
export function addNotificationResponseListener(callback) {
  return Notifications.addNotificationResponseReceivedListener(callback);
}

/**
 * Add a listener for received notifications (foreground)
 */
export function addNotificationReceivedListener(callback) {
  return Notifications.addNotificationReceivedListener(callback);
}
