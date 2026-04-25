/**
 * iBeacon Ranging — JavaScript wrapper for native iOS module
 *
 * Provides a clean API around the native Swift IBeaconRanging module
 * that uses iOS CoreLocation to range iBeacons.
 *
 * This is iOS-only. On Android, use react-native-ble-plx directly
 * (Android doesn't hide iBeacon data from generic BLE scanners).
 */

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';

const { IBeaconRanging } = NativeModules;

// Guard: the native module only exists on iOS
const isAvailable = Platform.OS === 'ios' && IBeaconRanging != null;

const emitter = isAvailable ? new NativeEventEmitter(IBeaconRanging) : null;

/**
 * Request location permission (required for iBeacon ranging on iOS).
 * Returns 'granted', 'denied', 'requested', or 'unavailable'.
 */
export async function requestPermission() {
  if (!isAvailable) return 'unavailable';
  try {
    return await IBeaconRanging.requestPermission();
  } catch (e) {
    console.warn('[iBeacon] requestPermission failed:', e);
    return 'denied';
  }
}

/**
 * Start ranging iBeacons matching the given UUID.
 * The JS side will receive continuous beacon updates via onBeaconsRanged.
 *
 * @param {string} uuid - iBeacon UUID in standard 8-4-4-4-12 hex format
 */
export async function startRanging(uuid) {
  if (!isAvailable) {
    console.warn('[iBeacon] Native module not available on this platform');
    return false;
  }
  try {
    await IBeaconRanging.startRanging(uuid);
    return true;
  } catch (e) {
    console.warn('[iBeacon] startRanging failed:', e);
    return false;
  }
}

/**
 * Stop ranging iBeacons.
 */
export async function stopRanging() {
  if (!isAvailable) return;
  try {
    await IBeaconRanging.stopRanging();
  } catch (e) {
    console.warn('[iBeacon] stopRanging failed:', e);
  }
}

/**
 * Subscribe to beacon updates. Called every ~1 second with all beacons in range.
 *
 * @param {Function} callback - receives an array of beacon objects:
 *   { uuid, major, minor, rssi, accuracy, proximity, timestamp }
 * @returns {Function} unsubscribe function
 */
export function onBeaconsRanged(callback) {
  if (!isAvailable || !emitter) return () => {};
  const sub = emitter.addListener('onBeaconsRanged', (event) => {
    callback(event.beacons || []);
  });
  return () => sub.remove();
}

/**
 * Subscribe to authorization changes.
 */
export function onAuthorizationChanged(callback) {
  if (!isAvailable || !emitter) return () => {};
  const sub = emitter.addListener('onAuthorizationChanged', callback);
  return () => sub.remove();
}

/**
 * Subscribe to errors from the native side.
 */
export function onError(callback) {
  if (!isAvailable || !emitter) return () => {};
  const sub = emitter.addListener('onError', callback);
  return () => sub.remove();
}

export function isIBeaconRangingAvailable() {
  return isAvailable;
}
