/**
 * Beacon Service — Blue Charm BC011 Pro iBeacon
 * 
 * Handles BLE beacon detection and indoor position estimation using
 * Blue Charm BC011 Pro beacons configured in iBeacon mode.
 * 
 * ─── Beacon ID Assignment ─────────────────────────────────────────────────
 *   Squash Building: Major = 1, Minors 1–5
 *   Main Building:   Major = 2, Minors 1–15
 *
 *   All beacons share the default Blue Charm UUID:
 *     426C7565-4368-6172-6D42-6561636F6E73
 * ──────────────────────────────────────────────────────────────────────────
 * 
 * Position estimation uses weighted centroid trilateration:
 *   1. Scan for iBeacons matching our UUID
 *   2. Convert each beacon's RSSI to estimated distance (log-distance path loss)
 *   3. Match Minor ID → known beacon position in building
 *   4. Weighted centroid of nearest beacons = estimated position
 */

// ── BC011 Pro iBeacon Constants ───────────────────────────────────────────

/** Shared UUID for all Escape the Fire beacons (Blue Charm default) */
export const BEACON_UUID = '426C7565-4368-6172-6D42-6561636F6E73';

/** Major ID per building */
export const MAJOR_IDS = {
  main: 2,
  squash: 1,
};

/**
 * Measured Power: calibrated RSSI (dBm) at exactly 1 meter.
 * BC011 Pro factory default.
 */
const MEASURED_POWER = -59;

/**
 * Path-loss exponent. Controls how fast signal decays with distance.
 *   2.0  = free space
 *   2.5  = light indoor
 *   2.7  = typical indoor (classrooms/hallways)
 *   3.0+ = heavy indoor (concrete walls)
 */
const PATH_LOSS_EXPONENT = 2.7;

/** Advertising interval (ms). BC011 Pro default: 1022.5 ms */
export const ADV_INTERVAL_MS = 1022.5;

/** Minimum RSSI to consider. Weaker signals are discarded. */
const MIN_RSSI_THRESHOLD = -88;

// ── Beacon Placement Map ──────────────────────────────────────────────────
//
// Each beacon's Minor ID is assigned via the KBeaconPro app.
// Positions are in meters, matching the coordinate system in the map JSON
// files (origin = bottom-left of blueprint, 1 pixel = 0.11 meters).
// ──────────────────────────────────────────────────────────────────────────

const MAIN_BUILDING_BEACONS = [
  { minor: 1,  x: 7.0,  y: 16.0, label: 'Room 4 – West Wing' },
  { minor: 2,  x: 15.0, y: 16.0, label: 'Room 3' },
  { minor: 3,  x: 24.0, y: 16.0, label: 'Room 2' },
  { minor: 4,  x: 31.0, y: 16.0, label: 'Room 1' },
  { minor: 5,  x: 14.0, y: 23.0, label: 'Corridor 2 – Central' },
  { minor: 6,  x: 23.0, y: 27.0, label: 'Corridor 1' },
  { minor: 7,  x: 14.0, y: 30.0, label: 'Room 6' },
  { minor: 8,  x: 28.0, y: 29.0, label: 'Room 7' },
  { minor: 9,  x: 43.0, y: 30.0, label: 'Room 9' },
  { minor: 10, x: 43.0, y: 19.0, label: 'Corridor 4' },
  { minor: 11, x: 58.0, y: 39.0, label: 'Corridor 6' },
  { minor: 12, x: 58.0, y: 28.0, label: 'Room 13' },
  { minor: 13, x: 70.0, y: 24.0, label: 'Room 16' },
  { minor: 14, x: 81.0, y: 15.0, label: 'Room 18' },
  { minor: 15, x: 93.0, y: 33.0, label: 'Room 21 – Gym' },
];

const SQUASH_BUILDING_BEACONS = [
  { minor: 1, x: 8.0,  y: 10.0, label: 'Squash Room 1' },
  { minor: 2, x: 16.0, y: 10.0, label: 'Squash Room 2' },
  { minor: 3, x: 24.0, y: 10.0, label: 'Squash Room 3' },
  { minor: 4, x: 16.0, y: 20.0, label: 'Squash Corridor' },
  { minor: 5, x: 24.0, y: 20.0, label: 'Squash Room 5' },
];

/** Get beacon config for a building */
export function getBeaconConfig(buildingId = 'main') {
  if (buildingId === 'squash') return [...SQUASH_BUILDING_BEACONS];
  return [...MAIN_BUILDING_BEACONS];
}

// ── RSSI ↔ Distance Conversion ───────────────────────────────────────────

export function rssiToDistance(rssi, mp = MEASURED_POWER) {
  if (rssi >= 0) return 0;
  return Math.pow(10, (mp - rssi) / (10 * PATH_LOSS_EXPONENT));
}

function distanceToRssi(distance) {
  if (distance <= 0) return MEASURED_POWER;
  const rssi = MEASURED_POWER - 10 * PATH_LOSS_EXPONENT * Math.log10(distance);
  const noise = (Math.random() - 0.5) * 6;
  return Math.round(rssi + noise);
}

// ── Position Estimation ───────────────────────────────────────────────────

/**
 * Estimate position using weighted centroid from iBeacon signals.
 */
export function estimatePosition(beaconReadings) {
  if (!beaconReadings || beaconReadings.length === 0) return null;

  const sorted = [...beaconReadings]
    .filter((b) => b.rssi > MIN_RSSI_THRESHOLD)
    .sort((a, b) => b.rssi - a.rssi)
    .slice(0, 5);

  if (sorted.length === 0) return null;

  const readings = sorted.map((b) => ({
    ...b,
    distance: rssiToDistance(b.rssi),
  }));

  let totalWeight = 0;
  let wx = 0;
  let wy = 0;

  for (const r of readings) {
    const weight = 1 / (r.distance * r.distance + 0.1);
    wx += r.x * weight;
    wy += r.y * weight;
    totalWeight += weight;
  }

  const estimatedX = wx / totalWeight;
  const estimatedY = wy / totalWeight;
  const accuracy = readings[0].distance;

  return {
    x: parseFloat(estimatedX.toFixed(2)),
    y: parseFloat(estimatedY.toFixed(2)),
    accuracy: parseFloat(accuracy.toFixed(1)),
    nearestBeacon: readings[0].label || `minor:${readings[0].minor}`,
  };
}

// ── Simulation Mode ───────────────────────────────────────────────────────

/**
 * Simulate iBeacon readings for a given true position (dev/testing only).
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

  return readings.filter((r) => r.rssi > MIN_RSSI_THRESHOLD);
}

// ── Perimeter Detection ───────────────────────────────────────────────────

const BUILDING_PERIMETERS = {
  main: { minX: 0, maxX: 115, minY: 0, maxY: 58 },
  squash: { minX: 0, maxX: 35, minY: 0, maxY: 30 },
};

const SAFE_DISTANCE_METERS = 30.48; // 100 feet

/**
 * Check if a user has crossed the safe-zone perimeter (100ft from building).
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
