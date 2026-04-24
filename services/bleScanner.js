/**
 * BLE Scanner Service — Real BC011 Pro iBeacon Detection
 * 
 * Uses platform-specific scanning:
 *   - iOS: native Swift module (modules/ibeacon-ranging) using CoreLocation
 *     CLLocationManager.startRangingBeacons (required because Apple hides
 *     iBeacon advertisements from generic BLE scanners on iOS).
 *   - Android: react-native-ble-plx (works fine for iBeacons).
 */

import { Platform, PermissionsAndroid } from 'react-native';
import {
  startRanging as iBeaconStartRanging,
  stopRanging as iBeaconStopRanging,
  onBeaconsRanged,
  requestPermission as iBeaconRequestPermission,
  isIBeaconRangingAvailable,
} from '../modules/ibeacon-ranging';
import { getBeaconConfig, BEACON_UUID, MAJOR_IDS, estimatePosition } from './beacon';

// ── State ─────────────────────────────────────────────────────────────────

let scanning = false;
let currentBuildingId = 'main';
let beaconConfig = [];
let beaconLookup = {};
let readingsBuffer = [];
let positionListeners = [];
let scanInterval = null;
let iBeaconUnsubscribe = null;
let androidBleManager = null;

const POSITION_UPDATE_INTERVAL = 2000;
const READING_MAX_AGE = 6000;

// ── Public API ────────────────────────────────────────────────────────────

export async function startScanning(buildingId = 'main') {
  if (scanning) {
    console.log('[BLE] Already scanning, stopping first...');
    await stopScanning();
  }

  currentBuildingId = buildingId;
  beaconConfig = getBeaconConfig(buildingId);
  beaconLookup = {};
  for (const b of beaconConfig) {
    beaconLookup[b.minor] = b;
  }

  const expectedMajor = MAJOR_IDS[buildingId] || 2;
  console.log(`[BLE] Starting scan for building: ${buildingId}, expecting major: ${expectedMajor}`);

  if (Platform.OS === 'ios') {
    await _startIOS(expectedMajor);
  } else if (Platform.OS === 'android') {
    await _startAndroid(expectedMajor);
  } else {
    console.warn('[BLE] Unsupported platform:', Platform.OS);
    return;
  }

  scanning = true;
  scanInterval = setInterval(() => _processReadings(), POSITION_UPDATE_INTERVAL);
}

export async function stopScanning() {
  if (!scanning) return;

  if (Platform.OS === 'ios') {
    if (iBeaconUnsubscribe) {
      iBeaconUnsubscribe();
      iBeaconUnsubscribe = null;
    }
    await iBeaconStopRanging();
  } else if (Platform.OS === 'android' && androidBleManager) {
    androidBleManager.stopDeviceScan();
  }

  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
  }

  scanning = false;
  readingsBuffer = [];
  console.log('[BLE] Scan stopped');
}

export function onPositionUpdate(callback) {
  positionListeners.push(callback);
  return () => {
    positionListeners = positionListeners.filter((cb) => cb !== callback);
  };
}

export function isScanning() {
  return scanning;
}

// ── iOS Implementation (native CoreLocation) ──────────────────────────────

async function _startIOS(expectedMajor) {
  if (!isIBeaconRangingAvailable()) {
    console.error('[BLE] iBeacon native module is not available. Did you rebuild after adding the plugin?');
    return;
  }

  const permission = await iBeaconRequestPermission();
  console.log('[BLE] iOS location permission status:', permission);
  if (permission === 'denied') {
    console.error('[BLE] Location permission denied, cannot scan');
    return;
  }

  iBeaconUnsubscribe = onBeaconsRanged((beacons) => {
    for (const beacon of beacons) {
      console.log(
        `[BLE] Ranged: major=${beacon.major} minor=${beacon.minor} rssi=${beacon.rssi} accuracy=${beacon.accuracy?.toFixed(2)}m`
      );

      if (beacon.major !== expectedMajor) continue;

      const beaconInfo = beaconLookup[beacon.minor];
      if (!beaconInfo) {
        console.log(`[BLE]   -> Minor ${beacon.minor} not in config`);
        continue;
      }

      if (beacon.rssi === 0) continue;

      readingsBuffer.push({
        minor: beacon.minor,
        rssi: beacon.rssi,
        x: beaconInfo.x,
        y: beaconInfo.y,
        label: beaconInfo.label,
        timestamp: Date.now(),
      });
    }
  });

  await iBeaconStartRanging(BEACON_UUID);
  console.log('[BLE] iOS CoreLocation ranging started');
}

// ── Android Implementation (react-native-ble-plx) ─────────────────────────

async function _startAndroid(expectedMajor) {
  const { BleManager } = require('react-native-ble-plx');

  const apiLevel = Platform.Version;
  if (apiLevel >= 31) {
    const results = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    ]);
    const allGranted = Object.values(results).every(
      (r) => r === PermissionsAndroid.RESULTS.GRANTED
    );
    if (!allGranted) {
      console.warn('[BLE] Android permissions not granted');
      return;
    }
  } else {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
    );
    if (result !== PermissionsAndroid.RESULTS.GRANTED) return;
  }

  if (!androidBleManager) androidBleManager = new BleManager();

  androidBleManager.startDeviceScan(null, { allowDuplicates: true }, (error, device) => {
    if (error || !device) return;
    const ibeacon = _parseIBeacon(device.manufacturerData);
    if (!ibeacon) return;
    if (ibeacon.uuid.toUpperCase() !== BEACON_UUID.toUpperCase()) return;
    if (ibeacon.major !== expectedMajor) return;

    const beaconInfo = beaconLookup[ibeacon.minor];
    if (!beaconInfo) return;

    readingsBuffer.push({
      minor: ibeacon.minor,
      rssi: device.rssi,
      x: beaconInfo.x,
      y: beaconInfo.y,
      label: beaconInfo.label,
      timestamp: Date.now(),
    });
  });
}

function _parseIBeacon(manufacturerData) {
  if (!manufacturerData) return null;
  try {
    const raw = atob(manufacturerData);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    if (bytes.length < 25) return null;

    let offset = -1;
    for (let i = 0; i < bytes.length - 22; i++) {
      if (bytes[i] === 0x02 && bytes[i + 1] === 0x15) { offset = i + 2; break; }
    }
    if (offset < 0) return null;

    const uuidBytes = bytes.slice(offset, offset + 16);
    const hex = Array.from(uuidBytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    const uuid = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
    const major = (bytes[offset + 16] << 8) | bytes[offset + 17];
    const minor = (bytes[offset + 18] << 8) | bytes[offset + 19];
    return { uuid, major, minor };
  } catch {
    return null;
  }
}

// ── Position Estimation ───────────────────────────────────────────────────

function _processReadings() {
  const now = Date.now();
  readingsBuffer = readingsBuffer.filter((r) => now - r.timestamp < READING_MAX_AGE);
  if (readingsBuffer.length === 0) return;

  const byMinor = {};
  for (const r of readingsBuffer) {
    if (!byMinor[r.minor]) byMinor[r.minor] = [];
    byMinor[r.minor].push(r);
  }

  const smoothedReadings = Object.entries(byMinor).map(([minor, readings]) => {
    const recent = readings.sort((a, b) => b.timestamp - a.timestamp).slice(0, 5);
    const avgRssi = recent.reduce((sum, r) => sum + r.rssi, 0) / recent.length;
    return {
      minor: parseInt(minor),
      rssi: Math.round(avgRssi),
      x: recent[0].x,
      y: recent[0].y,
      label: recent[0].label,
    };
  });

  const position = estimatePosition(smoothedReadings);
  if (position) {
    console.log(`[BLE] Position: (${position.x}, ${position.y}) near ${position.nearestBeacon}`);
    for (const cb of positionListeners) {
      try { cb(position); } catch (e) { console.warn('[BLE] Listener error:', e); }
    }
  }
}
