/**
 * Beacon Service — Blue Charm BC011 Pro iBeacon
 * 
 * Handles BLE beacon detection and indoor position estimation using
 * Blue Charm BC011 Pro beacons configured in iBeacon mode.
 * 
 * ─── BC011 Pro Default Specs ──────────────────────────────────────────────
 *   Beacon Type:        iBeacon
 *   UUID:               426C7565-4368-6172-6D42-6561636F6E73
 *   Default Major:      3838
 *   Default Minor:      4949
 *   Measured Power:      -59 dBm (calibrated RSSI at 1 meter)
 *   TX Power:           0 dBm
 *   Adv Interval:       1022.5 ms (~1 broadcast/sec)
 *   Config App:         KBeaconPro (iOS / Android)
 *   MAC prefix:         DD88
 * ──────────────────────────────────────────────────────────────────────────
 * 
 * Beacon identification strategy:
 *   - All beacons share the same UUID (default Blue Charm UUID)
 *   - Each beacon has a unique Minor ID (assigned during setup via KBeaconPro)
 *   - Major ID groups beacons by building (3838 = main, 3839 = squash)
 * 
 * Position estimation uses weighted centroid trilateration:
 *   1. Scan for iBeacons matching our UUID
 *   2. Convert each beacon's RSSI to estimated distance (log-distance path loss)
 *   3. Match Minor ID → known beacon position in building
 *   4. Weighted centroid of nearest beacons = estimated position
 * 
 * In production, scanning is done via react-native-ble-plx or expo-ble.
 * A simulation mode is provided for development/testing without hardware.
 */

// ── BC011 Pro iBeacon Constants ───────────────────────────────────────────

/** Shared UUID for all Escape the Fire beacons (Blue Charm default) */
export const BEACON_UUID = '426C7565-4368-6172-6D42-6561636F6E73';

/** Major ID per building */
export const MAJOR_IDS = {
  main: 3838,
  squash: 3839,
};

/**
 * Measured Power: calibrated RSSI (dBm) at exactly 1 meter.
 * This is the BC011 Pro factory default. If you recalibrate via KBeaconPro,
 * update this value to match. The beacon reports this in its advertisement
 * packet, so in production you can read it per-beacon. For simulation we
 * use the factory value.
 */
const MEASURED_POWER = -59;

/**
 * Path-loss exponent. Controls how fast signal decays with distance.
 *   2.0  = free space (outdoors, line of sight)
 *   2.5  = light indoor (open hallways, few walls)
 *   3.0  = typical indoor (offices, classrooms)
 *   3.5+ = heavy indoor (concrete walls, lots of obstacles)
 * 
 * For the Boys & Girls Club (mix of open rooms and hallways), 2.7 is a
 * good starting point. Fine-tune after on-site testing with Metin.
 */
const PATH_LOSS_EXPONENT = 2.7;

/**
 * Advertising interval in milliseconds. Used to set expected scan timing.
 * BC011 Pro default: 1022.5 ms. For faster position updates, you can lower
 * this to 500ms via KBeaconPro, but that halves battery life.
 */
export const ADV_INTERVAL_MS = 1022.5;

/**
 * Minimum RSSI threshold. Beacons weaker than this are too far to be useful.
 * At -90 dBm with our path-loss model, distance ≈ 15–20m.
 */
const MIN_RSSI_THRESHOLD = -88;

// ── Beacon Placement Map ──────────────────────────────────────────────────
// 
// Each beacon is identified by its Minor ID (configured via KBeaconPro app).
// Positions are in meters, matching the coordinate system in mainMapData.json
// (origin = bottom-left of blueprint, 1 pixel = 0.11 meters).
//
// ── Setup instructions for each beacon ────────────────────────────────────
//  1. Turn on beacon: hold button 5 sec until LED flashes once
//  2. Open KBeaconPro app → Scan → tap your beacon (MAC starts with DD88)
//  3. Tap SLOT0 iBeacon → change Minor ID to the value below
//  4. If setting up squash building beacons, also change Major ID to 3839
//  5. Tap SAVE → tap back arrow → tap UPLOAD
//  6. IMPORTANT: disconnect from beacon (tap back arrow to scan screen)
//  7. Mount beacon at the listed location
//
// To verify: open KBeaconPro → Scan → confirm correct Minor ID and UUID
// ──────────────────────────────────────────────────────────────────────────

const MAIN_BUILDING_BEACONS = [
  // West wing rooms
  { minor: 1001, x: 7.0,  y: 16.0, label: 'Room 4 – West Wing',   floor: 1 },
  { minor: 1002, x: 15.0, y: 16.0, label: 'Room 3',                floor: 1 },
  { minor: 1003, x: 24.0, y: 16.0, label: 'Room 2',                floor: 1 },
  { minor: 1004, x: 31.0, y: 16.0, label: 'Room 1',                floor: 1 },

  // Central corridors
  { minor: 1005, x: 14.0, y: 23.0, label: 'Corridor 2 – Central',  floor: 1 },
  { minor: 1006, x: 23.0, y: 27.0, label: 'Corridor 1',            floor: 1 },
  { minor: 1007, x: 29.0, y: 22.0, label: 'Corridor 3',            floor: 1 },
  { minor: 1008, x: 43.0, y: 19.0, label: 'Corridor 4',            floor: 1 },

  // North wing rooms
  { minor: 1009, x: 14.0, y: 30.0, label: 'Room 6',                floor: 1 },
  { minor: 1010, x: 4.0,  y: 27.0, label: 'Room 5',                floor: 1 },
  { minor: 1011, x: 28.0, y: 29.0, label: 'Room 7',                floor: 1 },
  { minor: 1012, x: 34.0, y: 29.0, label: 'Room 8',                floor: 1 },
  { minor: 1013, x: 43.0, y: 30.0, label: 'Room 9',                floor: 1 },

  // East corridors
  { minor: 1014, x: 52.0, y: 30.0, label: 'Corridor 5',            floor: 1 },
  { minor: 1015, x: 58.0, y: 39.0, label: 'Corridor 6',            floor: 1 },

  // East wing rooms
  { minor: 1016, x: 58.0, y: 28.0, label: 'Room 13',               floor: 1 },
  { minor: 1017, x: 57.0, y: 17.0, label: 'Room 15',               floor: 1 },
  { minor: 1018, x: 70.0, y: 24.0, label: 'Room 16',               floor: 1 },
  { minor: 1019, x: 75.0, y: 20.0, label: 'Room 17',               floor: 1 },
  { minor: 1020, x: 81.0, y: 15.0, label: 'Room 18',               floor: 1 },
  { minor: 1021, x: 87.0, y: 11.0, label: 'Room 19',               floor: 1 },

  // Gym and south rooms
  { minor: 1022, x: 63.0, y: 49.0, label: 'Room 20',               floor: 1 },
  { minor: 1023, x: 93.0, y: 33.0, label: 'Room 21 – Gym',         floor: 1 },
  { minor: 1024, x: 69.0, y: 38.0, label: 'Room 22',               floor: 1 },
];

const SQUASH_BUILDING_BEACONS = [
  // Squash building beacons use Major ID 3839
  // Minor IDs start at 2001 to avoid overlap with main building
  { minor: 2001, x: 8.0,  y: 10.0, label: 'Squash Room 1',  floor: 1 },
  { minor: 2002, x: 16.0, y: 10.0, label: 'Squash Room 2',  floor: 1 },
  { minor: 2003, x: 24.0, y: 10.0, label: 'Squash Room 3',  floor: 1 },
  { minor: 2004, x: 8.0,  y: 20.0, label: 'Squash Room 4',  floor: 1 },
  { minor: 2005, x: 16.0, y: 20.0, label: 'Squash Corridor', floor: 1 },
  { minor: 2006, x: 24.0, y: 20.0, label: 'Squash Room 5',  floor: 1 },
];

/** Get beacon config for a building */
export function getBeaconConfig(buildingId = 'main') {
  if (buildingId === 'squash') return [...SQUASH_BUILDING_BEACONS];
  return [...MAIN_BUILDING_BEACONS];
}

// ── RSSI ↔ Distance Conversion ───────────────────────────────────────────

/**
 * Convert RSSI (dBm) to estimated distance (meters).
 * Uses the log-distance path-loss model:
 *   distance = 10 ^ ((MeasuredPower - RSSI) / (10 * n))
 * where n = PATH_LOSS_EXPONENT
 * 
 * @param {number} rssi   – received signal strength in dBm (e.g. -67)
 * @param {number} mp     – measured power at 1m (default: BC011 Pro factory -59)
 * @returns {number} estimated distance in meters
 */
export function rssiToDistance(rssi, mp = MEASURED_POWER) {
  if (rssi >= 0) return 0;
  return Math.pow(10, (mp - rssi) / (10 * PATH_LOSS_EXPONENT));
}

/**
 * Simulate RSSI from a known distance (for testing without hardware).
 * Inverse of rssiToDistance with Gaussian noise to mimic real-world variance.
 */
function distanceToRssi(distance) {
  if (distance <= 0) return MEASURED_POWER;
  const rssi = MEASURED_POWER - 10 * PATH_LOSS_EXPONENT * Math.log10(distance);
  // Add ±3 dBm Gaussian noise (typical indoor BLE variance)
  const noise = (Math.random() - 0.5) * 6;
  return Math.round(rssi + noise);
}

// ── Position Estimation ───────────────────────────────────────────────────

/**
 * Estimate position using weighted centroid from iBeacon signals.
 * 
 * In production, `beaconReadings` comes from the BLE scanner matching
 * our UUID. Each reading's Minor ID is looked up in the beacon placement
 * map to get the (x, y) position.
 * 
 * @param {Array<{minor: number, rssi: number, x: number, y: number}>} beaconReadings
 * @returns {{ x: number, y: number, accuracy: number, nearestBeacon: string } | null}
 */
export function estimatePosition(beaconReadings) {
  if (!beaconReadings || beaconReadings.length === 0) return null;

  // Sort by signal strength (strongest / closest first), take top 5
  const sorted = [...beaconReadings]
    .filter((b) => b.rssi > MIN_RSSI_THRESHOLD)
    .sort((a, b) => b.rssi - a.rssi)
    .slice(0, 5);

  if (sorted.length === 0) return null;

  // Convert RSSI to distances
  const readings = sorted.map((b) => ({
    ...b,
    distance: rssiToDistance(b.rssi),
  }));

  // Weighted centroid: weight = 1 / distance²
  let totalWeight = 0;
  let wx = 0;
  let wy = 0;

  for (const r of readings) {
    const weight = 1 / (r.distance * r.distance + 0.1); // +0.1 avoids div-by-zero
    wx += r.x * weight;
    wy += r.y * weight;
    totalWeight += weight;
  }

  const estimatedX = wx / totalWeight;
  const estimatedY = wy / totalWeight;

  // Accuracy ≈ distance to the nearest beacon (best case)
  const accuracy = readings[0].distance;

  return {
    x: parseFloat(estimatedX.toFixed(2)),
    y: parseFloat(estimatedY.toFixed(2)),
    accuracy: parseFloat(accuracy.toFixed(1)),
    nearestBeacon: readings[0].label || `minor:${readings[0].minor}`,
  };
}

// ── Production BLE Scanning (interface) ───────────────────────────────────
//
// In production, replace the simulation calls below with real BLE scanning.
// Recommended library: react-native-ble-plx
//
//   import { BleManager } from 'react-native-ble-plx';
//   const manager = new BleManager();
//
//   function startScanning(buildingId, onPositionUpdate) {
//     const beacons = getBeaconConfig(buildingId);
//     const majorId = MAJOR_IDS[buildingId] || 3838;
//
//     manager.startDeviceScan(null, { allowDuplicates: true }, (error, device) => {
//       if (error) return;
//       // Parse iBeacon advertisement from device.manufacturerData
//       // Filter by UUID === BEACON_UUID && major === majorId
//       // Extract minor and rssi
//       // Look up minor in beacons array to get (x, y)
//       // Collect readings over ~2 seconds, then call estimatePosition()
//     });
//   }
//
// The KBeaconPro SDK also provides native iOS/Android libraries if you
// prefer their API over raw BLE scanning.
// ──────────────────────────────────────────────────────────────────────────

// ── Simulation Mode ───────────────────────────────────────────────────────

/**
 * Simulate iBeacon readings for a given true position (dev/testing only).
 * Generates fake RSSI values as if the phone were at (trueX, trueY) in the
 * building, based on Euclidean distance to each beacon.
 * 
 * @param {number} trueX - True X position in meters
 * @param {number} trueY - True Y position in meters
 * @param {string} buildingId - 'main' or 'squash'
 * @returns {Array<{minor, rssi, x, y, label, distance}>}
 */
export function simulateBeaconReadings(trueX, trueY, buildingId = 'main') {
  const beacons = getBeaconConfig(buildingId);

  const readings = beacons.map((beacon) => {
    const dist = Math.sqrt((trueX - beacon.x) ** 2 + (trueY - beacon.y) ** 2);
    const rssi = distanceToRssi(dist);
    return {
      minor: beacon.minor,
      rssi,
      x: beacon.x,
      y: beacon.y,
      label: beacon.label,
      distance: parseFloat(dist.toFixed(2)),
    };
  });

  // Only return beacons within detectable range
  return readings.filter((r) => r.rssi > MIN_RSSI_THRESHOLD);
}

// ── Perimeter Detection ───────────────────────────────────────────────────

// Building perimeter bounding box (approximate, in meters)
const BUILDING_PERIMETERS = {
  main: { minX: 0, maxX: 115, minY: 0, maxY: 58 },
  squash: { minX: 0, maxX: 35, minY: 0, maxY: 30 },
};

// Safe distance: 100 feet ≈ 30.48 meters from building
const SAFE_DISTANCE_METERS = 30.48;

/**
 * Check if a user has crossed the safe-zone perimeter (100ft from building).
 * Once past this threshold, the user can be marked as safely evacuated.
 * 
 * @param {number} x - User X position (meters)
 * @param {number} y - User Y position (meters)
 * @param {string} buildingId - 'main' or 'squash'
 * @returns {{ outside: boolean, pastSafeZone: boolean, distanceFromBuilding: number }}
 */
export function checkPerimeter(x, y, buildingId = 'main') {
  const bounds = BUILDING_PERIMETERS[buildingId] || BUILDING_PERIMETERS.main;

  let dx = 0;
  let dy = 0;
  if (x < bounds.minX) dx = bounds.minX - x;
  else if (x > bounds.maxX) dx = x - bounds.maxX;
  if (y < bounds.minY) dy = bounds.minY - y;
  else if (y > bounds.maxY) dy = y - bounds.maxY;

  const distanceFromBuilding = Math.sqrt(dx * dx + dy * dy);

  return {
    outside: distanceFromBuilding > 0,
    pastSafeZone: distanceFromBuilding >= SAFE_DISTANCE_METERS,
    distanceFromBuilding: parseFloat(distanceFromBuilding.toFixed(1)),
  };
}
