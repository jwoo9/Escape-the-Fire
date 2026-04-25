/**
 * location.ts
 *
 * Indoor positioning via native CoreLocation iBeacon ranging (iOS)
 * with Kalman filter smoothing. Falls back to react-native-ble-plx on Android
 * and simulation mode in Expo Go / web.
 *
 * Writes { svgX, svgY, floor, updatedAt, initials } to Firebase RTDB
 * at locations/{uid}.
 *
 * Floor detection: major=1 → squash, major=2 → main
 * Position: Kalman-filtered RSSI → distance → weighted centroid of top beacons
 *
 * Coordinate output: SVG pixels (origin top-left), matching FloorMap viewBox.
 * Conversion: svgX = worldX_m / 0.11,  svgY = IMG_H - worldY_m / 0.11
 */

import { PermissionsAndroid, Platform } from 'react-native';
import { floorFromMajor, FloorId, FLOORS, MapBeacon } from '../constants/mapData';
import { writeLocation } from './emergency';

// Native iBeacon module (iOS only)
import {
  startRanging as iBeaconStartRanging,
  stopRanging as iBeaconStopRanging,
  onBeaconsRanged,
  requestPermission as iBeaconRequestPermission,
  isIBeaconRangingAvailable,
} from '../modules/ibeacon-ranging';

// ─── Constants ───────────────────────────────────────────────────────────────
const BEACON_UUID      = '426C7565-4368-6172-6D42-6561636F6E73';
const TX_POWER_DEFAULT = -52;       // calibrated dBm at 1m
const PATH_LOSS_N      = 2.0;       // calibrated path loss exponent
const POSITION_INTERVAL = 2000;     // ms between position updates
const READING_MAX_AGE   = 4000;     // ms before a reading is stale
const MIN_BEACONS       = 2;        // minimum beacons to attempt position
const IMG_H             = 524;      // annotator image height in px
const PX_TO_M           = 0.11;

// ─── Kalman Filter ──────────────────────────────────────────────────────────
class KalmanFilter {
  private Q: number;  // process noise
  private R: number;  // measurement noise
  private P: number;  // estimate error
  private X: number;  // current estimate

  constructor(Q = 1, R = 3, P = 5, X = -70) {
    this.Q = Q; this.R = R; this.P = P; this.X = X;
  }

  update(measurement: number): number {
    this.P = this.P + this.Q;
    const K = this.P / (this.P + this.R);
    this.X = this.X + K * (measurement - this.X);
    this.P = (1 - K) * this.P;
    return this.X;
  }

  reset(value: number) { this.X = value; this.P = 5; }
  get value() { return this.X; }
}

// ─── State ───────────────────────────────────────────────────────────────────
let _uid:          string | null = null;
let _initials:     string        = '?';
let _onPosition:   ((pos: { svgX: number; svgY: number; floor: FloorId }) => void) | null = null;
let _processTimer: ReturnType<typeof setInterval> | null = null;
let _iBeaconUnsub: (() => void) | null = null;
let _bleManager:   any = null;

// Flat beacon lookup: { 'major:minor' → MapBeacon }
let _beaconLookup: Record<string, MapBeacon> = {};

// Per-beacon Kalman filters: { 'major:minor' → KalmanFilter }
const _kalmanFilters: Record<string, KalmanFilter> = {};

// Reading buffer
interface Reading {
  beacon: MapBeacon;
  rssi: number;
  kalmanRssi: number;
  timestamp: number;
}
let _readingsBuffer: Reading[] = [];

// Outlier rejection
const OUTLIER_THRESHOLD = 12; // dBm
const _medianCache: Record<string, number> = {};

// ─── Init ─────────────────────────────────────────────────────────────────────
export const initLocation = (
  uid: string,
  initials: string,
  onPosition?: (pos: { svgX: number; svgY: number; floor: FloorId }) => void,
) => {
  _uid       = uid;
  _initials  = initials;
  _onPosition = onPosition ?? null;

  _beaconLookup = {};
  for (const floor of Object.values(FLOORS)) {
    for (const b of floor.beacons) {
      _beaconLookup[`${b.major}:${b.minor}`] = b;
    }
  }

  console.log('[location] Initialised — beacons loaded:', Object.keys(_beaconLookup).length);
};

// ─── Start / Stop ─────────────────────────────────────────────────────────────
export const startTracking = async () => {
  if (_processTimer) return;

  if (Platform.OS === 'ios' && isIBeaconRangingAvailable()) {
    await _startIOS();
  } else if (Platform.OS === 'android') {
    await _startAndroid();
  } else {
    console.warn('[location] BLE unavailable, using simulated position');
    _processTimer = setInterval(_simulatedCycle, 3000);
    _simulatedCycle();
    return;
  }

  // Start periodic position processing
  _processTimer = setInterval(_processReadings, POSITION_INTERVAL);
};

export const stopTracking = () => {
  if (_processTimer) { clearInterval(_processTimer); _processTimer = null; }

  if (_iBeaconUnsub) { _iBeaconUnsub(); _iBeaconUnsub = null; }
  iBeaconStopRanging().catch(() => {});

  if (_bleManager) {
    _bleManager.stopDeviceScan();
    _bleManager.destroy();
    _bleManager = null;
  }

  _readingsBuffer = [];
  Object.keys(_kalmanFilters).forEach(k => delete _kalmanFilters[k]);
  Object.keys(_medianCache).forEach(k => delete _medianCache[k]);

  console.log('[location] Stopped');
};

// ─── iOS: Native CoreLocation iBeacon Ranging ────────────────────────────────
const _startIOS = async () => {
  const permission = await iBeaconRequestPermission();
  console.log('[location] iOS location permission:', permission);
  if (permission === 'denied') {
    console.error('[location] Location permission denied');
    // Fall back to simulation
    _processTimer = setInterval(_simulatedCycle, 3000);
    _simulatedCycle();
    return;
  }

  _iBeaconUnsub = onBeaconsRanged((beacons: any[]) => {
    const now = Date.now();

    for (const b of beacons) {
      if (b.rssi === 0) continue;

      const key = `${b.major}:${b.minor}`;
      const beacon = _beaconLookup[key];
      if (!beacon) continue;

      // Initialize Kalman filter for new beacons
      if (!_kalmanFilters[key]) {
        _kalmanFilters[key] = new KalmanFilter(1, 3, 5, b.rssi);
      }

      // Outlier rejection
      if (_medianCache[key] !== undefined) {
        if (Math.abs(b.rssi - _medianCache[key]) > OUTLIER_THRESHOLD) continue;
      }

      // Kalman filter
      const kalmanRssi = _kalmanFilters[key].update(b.rssi);

      _readingsBuffer.push({
        beacon,
        rssi: b.rssi,
        kalmanRssi,
        timestamp: now,
      });
    }
  });

  await iBeaconStartRanging(BEACON_UUID);
  console.log('[location] iOS CoreLocation ranging started');
};

// ─── Android: react-native-ble-plx ──────────────────────────────────────────
const _startAndroid = async () => {
  try {
    await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ]);
  } catch (err) { console.warn('[location] Permission error:', err); }

  try {
    const { BleManager } = require('react-native-ble-plx');
    _bleManager = new BleManager();

    _bleManager.startDeviceScan(null, { allowDuplicates: true }, (err: any, device: any) => {
      if (err || !device || !device.manufacturerData) return;

      const ibeacon = _parseIBeacon(device.manufacturerData);
      if (!ibeacon) return;
      if (ibeacon.uuid.toUpperCase() !== BEACON_UUID.toUpperCase()) return;

      const key = `${ibeacon.major}:${ibeacon.minor}`;
      const beacon = _beaconLookup[key];
      if (!beacon) return;

      if (!_kalmanFilters[key]) {
        _kalmanFilters[key] = new KalmanFilter(1, 3, 5, device.rssi);
      }

      if (_medianCache[key] !== undefined) {
        if (Math.abs(device.rssi - _medianCache[key]) > OUTLIER_THRESHOLD) return;
      }

      const kalmanRssi = _kalmanFilters[key].update(device.rssi);

      _readingsBuffer.push({
        beacon,
        rssi: device.rssi,
        kalmanRssi,
        timestamp: Date.now(),
      });
    });

    console.log('[location] Android BLE started');
  } catch (err: any) {
    console.warn('[location] BLE unavailable:', err.message);
    _processTimer = setInterval(_simulatedCycle, 3000);
    _simulatedCycle();
  }
};

// ─── iBeacon parser (Android only) ──────────────────────────────────────────
const _parseIBeacon = (manufacturerData: string) => {
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
    const hex = Array.from(uuidBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    const uuid = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
    const major = (bytes[offset + 16] << 8) | bytes[offset + 17];
    const minor = (bytes[offset + 18] << 8) | bytes[offset + 19];
    return { uuid, major, minor };
  } catch { return null; }
};

// ─── RSSI → distance (calibrated) ──────────────────────────────────────────
const _rssiToDistance = (rssi: number): number => {
  if (rssi >= 0) return 999;
  return Math.pow(10, (TX_POWER_DEFAULT - rssi) / (10 * PATH_LOSS_N));
};

// ─── Median helper ──────────────────────────────────────────────────────────
const _median = (arr: number[]): number => {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

// ─── Process readings → position ────────────────────────────────────────────
const _processReadings = () => {
  const now = Date.now();

  // Remove stale readings
  _readingsBuffer = _readingsBuffer.filter(r => now - r.timestamp < READING_MAX_AGE);

  if (_readingsBuffer.length === 0) return;

  // Group by beacon key, take latest Kalman RSSI per beacon
  const byBeacon: Record<string, Reading[]> = {};
  for (const r of _readingsBuffer) {
    const key = `${r.beacon.major}:${r.beacon.minor}`;
    if (!byBeacon[key]) byBeacon[key] = [];
    byBeacon[key].push(r);
  }

  // Update median cache for outlier rejection
  for (const [key, readings] of Object.entries(byBeacon)) {
    const rssiValues = readings.map(r => r.rssi);
    _medianCache[key] = _median(rssiValues);
  }

  // Build position candidates: one entry per beacon with smoothed RSSI
  const candidates: { beacon: MapBeacon; kalmanRssi: number; distance: number }[] = [];
  for (const [key, readings] of Object.entries(byBeacon)) {
    const latest = readings[readings.length - 1];
    const distance = _rssiToDistance(latest.kalmanRssi);
    candidates.push({ beacon: latest.beacon, kalmanRssi: latest.kalmanRssi, distance });
  }

  if (candidates.length < MIN_BEACONS) {
    console.log(`[location] Only ${candidates.length} beacon(s) — skip`);
    return;
  }

  // Sort by signal strength (strongest first), take top 5
  const top = candidates.sort((a, b) => b.kalmanRssi - a.kalmanRssi).slice(0, 5);

  // Determine floor from strongest beacon
  const floorId = floorFromMajor(top[0].beacon.major);

  // Weighted centroid: weight = 1 / distance²
  let sumW = 0, sumX = 0, sumY = 0;
  for (const { beacon, distance } of top) {
    const weight = distance > 0 ? 1 / (distance * distance + 0.1) : 1;
    // Beacon positions are already in SVG pixels
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

  if (_uid) {
    writeLocation(_uid, svgX, svgY, floor);
  }

  _onPosition?.({ svgX, svgY, floor });
};

// ─── Simulator (Expo Go / web / no BLE) ─────────────────────────────────────
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

export const setSimulatedFloor = (floor: FloorId) => { _simFloor = floor; };

// ─── Bluetooth permissions (called externally by some screens) ───────────────
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