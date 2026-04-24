/**
 * location.ts
 *
 * Indoor positioning via Bluetooth beacon RSSI trilateration.
 * Writes { svgX, svgY, floor, updatedAt, initials } to Firebase RTDB
 * at locations/{uid}.
 *
 * Floor detection: major=1 → squash, major=2 → main
 * Position: weighted centroid of top-3 beacons by RSSI
 *
 * Coordinate output: SVG pixels (origin top-left), matching FloorMap viewBox.
 * Conversion: svgX = worldX_m / 0.11,  svgY = IMG_H - worldY_m / 0.11
 */

import { PermissionsAndroid, Platform } from 'react-native';
import { floorFromMajor, FloorId, FLOORS, MapBeacon } from '../constants/mapData';
import { writeLocation } from './emergency';

// ─── Constants ───────────────────────────────────────────────────────────────
const TX_POWER_DEFAULT = -52;      // dBm at 1m — calibrate per beacon
const PATH_LOSS_N      = 2.5;      // indoor environment factor
const SCAN_WINDOW_MS   = 1500;     // how long to collect readings per cycle
const SCAN_INTERVAL_MS = 3000;     // how often to scan
const MIN_BEACONS      = 2;        // minimum beacons to trilaterate
const IMG_H            = 524;      // annotator image height in px
const PX_TO_M          = 0.11;

// ─── State ───────────────────────────────────────────────────────────────────
let _uid:          string | null = null;
let _initials:     string        = '?';
let _onPosition:   ((pos: { svgX: number; svgY: number; floor: FloorId }) => void) | null = null;
let _scanTimer:    ReturnType<typeof setInterval> | null = null;
let _bleManager:   any = null;

// Flat beacon lookup: { 'major:minor' → MapBeacon }
let _beaconLookup: Record<string, MapBeacon> = {};

// ─── Init ─────────────────────────────────────────────────────────────────────
/**
 * Call before startTracking().
 * @param uid        Firebase auth UID
 * @param initials   User initials shown on admin map dot
 * @param onPosition Callback for UI updates (optional)
 */
export const initLocation = (
  uid: string,
  initials: string,
  onPosition?: (pos: { svgX: number; svgY: number; floor: FloorId }) => void,
) => {
  _uid       = uid;
  _initials  = initials;
  _onPosition = onPosition ?? null;

  // Build flat lookup from both floors' beacon lists
  _beaconLookup = {};
  for (const floor of Object.values(FLOORS)) {
    for (const b of floor.beacons) {
      _beaconLookup[`${b.major}:${b.minor}`] = b;
    }
  }

  console.log('[location] Initialised — beacons loaded:', Object.keys(_beaconLookup).length);
};

// ─── Start / Stop ─────────────────────────────────────────────────────────────
export const requestBluetoothPermissions = async () => {
  if (Platform.OS === 'android') {
    try {
      await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ]);
    } catch (err) { console.warn('Failed to request Android permissions:', err); }
  }
};

export const startTracking = async () => {
  if (_scanTimer) return;
  await requestBluetoothPermissions();

  try {
    // @ts-ignore - react-native-ble-plx may not be installed
    const { BleManager } = await import('react-native-ble-plx');
    _bleManager = new BleManager();
    console.log('[location] BLE started');
    _scanTimer = setInterval(_scanCycle, SCAN_INTERVAL_MS);
    _scanCycle();
  } catch (err: any) {
    console.warn('[location] BLE unavailable, using simulated position:', err.message);
    _scanTimer = setInterval(_simulatedCycle, SCAN_INTERVAL_MS);
    _simulatedCycle();
  }
};

export const stopTracking = () => {
  if (_scanTimer) { clearInterval(_scanTimer); _scanTimer = null; }
  _bleManager?.stopDeviceScan();
  _bleManager?.destroy();
  _bleManager = null;
  console.log('[location] Stopped');
};

// ─── BLE scan cycle ───────────────────────────────────────────────────────────
const _scanCycle = () => {
  if (!_bleManager) return;

  const readings: { beacon: MapBeacon; rssi: number }[] = [];

  _bleManager.startDeviceScan(null, { allowDuplicates: false }, (err: any, device: any) => {
    if (err || !device) return;

    // Match by manufacturerData major/minor (iBeacon format)
    // Alternatively match by device.name if beacons broadcast e.g. "beacon_1"
    const major = device.manufacturerData
      ? _parseMajor(device.manufacturerData)
      : null;
    const minor = device.manufacturerData
      ? _parseMinor(device.manufacturerData)
      : null;

    if (major !== null && minor !== null) {
      const key    = `${major}:${minor}`;
      const beacon = _beaconLookup[key];
      if (beacon && device.rssi) readings.push({ beacon, rssi: device.rssi });
    }
  });

  setTimeout(() => {
    _bleManager.stopDeviceScan();
    if (readings.length < MIN_BEACONS) {
      console.log(`[location] Only ${readings.length} beacon(s) — skip`);
      return;
    }
    _resolve(readings);
  }, SCAN_WINDOW_MS);
};

// ─── iBeacon manufacturer data parsing ───────────────────────────────────────
// iBeacon major/minor are at bytes 20–21 (major) and 22–23 (minor) of the
// 25-byte payload. Base64-decode manufacturer data then extract.
const _parseMajor = (b64: string): number | null => {
  try {
    const buf = Buffer.from(b64, 'base64');
    if (buf.length < 23) return null;
    return (buf[20] << 8) | buf[21];
  } catch { return null; }
};

const _parseMinor = (b64: string): number | null => {
  try {
    const buf = Buffer.from(b64, 'base64');
    if (buf.length < 25) return null;
    return (buf[22] << 8) | buf[23];
  } catch { return null; }
};

// ─── RSSI → distance ──────────────────────────────────────────────────────────
const _rssiToMetres = (rssi: number, txPower: number): number => {
  if (rssi === 0) return 999;
  const ratio = rssi / txPower;
  if (ratio < 1.0) return Math.pow(ratio, 10);
  return 0.89976 * Math.pow(ratio, 7.7095) + 0.111;
};

// ─── Weighted centroid trilateration ─────────────────────────────────────────
const _resolve = (readings: { beacon: MapBeacon; rssi: number }[]) => {
  // Sort by RSSI, take top 3
  const top = [...readings].sort((a, b) => b.rssi - a.rssi).slice(0, 3);

  // Determine floor from the beacon with strongest signal
  const floorId = floorFromMajor(top[0].beacon.major);
  const floor   = FLOORS[floorId];

  let sumW = 0, sumX = 0, sumY = 0;

  for (const { beacon, rssi } of top) {
    const txPower = TX_POWER_DEFAULT; // future: beacon.txPower ?? TX_POWER_DEFAULT
    const dist    = _rssiToMetres(rssi, txPower);
    const weight  = dist > 0 ? 1 / (dist * dist) : 1;
    // Beacon positions are already in SVG pixels (from mapData.ts)
    sumW += weight;
    sumX += beacon.x * weight;
    sumY += beacon.y * weight;
  }

  if (sumW === 0) return;

  const svgX = sumX / sumW;
  const svgY = sumY / sumW;

  _emit(svgX, svgY, floorId);
};

// ─── Emit position ────────────────────────────────────────────────────────────
const _emit = (svgX: number, svgY: number, floor: FloorId) => {
  console.log(`[location] ${floor} → svgX=${Math.round(svgX)} svgY=${Math.round(svgY)}`);

  // Write to Firebase RTDB — standardized svgX/svgY
  if (_uid) {
    writeLocation(_uid, svgX, svgY, floor);
  }

  // Notify UI
  _onPosition?.({ svgX, svgY, floor });
};

// ─── Simulator (Expo Go / no BLE) ────────────────────────────────────────────
const SIM_PATHS: Record<FloorId, { svgX: number; svgY: number }[]> = {
  main: [
    { svgX: 200, svgY: 280 },
    { svgX: 320, svgY: 200 },
    { svgX: 460, svgY: 180 },
  ],
  squash: [
    { svgX: 197, svgY: 210 },
    { svgX: 314, svgY: 177 },
    { svgX: 430, svgY: 177 },
  ],
};

let _simStep  = 0;
let _simFloor: FloorId = 'main';

const _simulatedCycle = () => {
  const positions = SIM_PATHS[_simFloor];
  const pos       = positions[_simStep % positions.length];
  _simStep++;
  _emit(pos.svgX, pos.svgY, _simFloor);
};

/** Dev helper — switch simulated floor */
export const setSimulatedFloor = (floor: FloorId) => { _simFloor = floor; };