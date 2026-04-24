/**
 * Beacon Distance Tester v4
 * 
 * Added:
 *   - Stabilization timer: measures time from first reading to stable distance
 *   - "Stable" = Kalman distance hasn't changed more than threshold for X seconds
 *   - Reset button to restart the timer for a new test
 *   - Records best stabilized distance and time to reach it
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform, Modal,
} from 'react-native';
import {
  startRanging,
  stopRanging,
  onBeaconsRanged,
  requestPermission,
  isIBeaconRangingAvailable,
} from './modules/ibeacon-ranging';

const BEACON_UUID = '426C7565-4368-6172-6D42-6561636F6E73';

// ── Kalman Filter ─────────────────────────────────────────────────────────

class KalmanFilter {
  constructor(Q = 1, R = 3, P = 5, X = -70) {
    this.Q = Q;
    this.R = R;
    this.P = P;
    this.X = X;
    this.K = 0;
  }
  update(measurement) {
    this.P = this.P + this.Q;
    this.K = this.P / (this.P + this.R);
    this.X = this.X + this.K * (measurement - this.X);
    this.P = (1 - this.K) * this.P;
    return this.X;
  }
  reset(value) { this.X = value; this.P = 5; }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function median(arr) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function standardDeviation(arr) {
  if (arr.length < 2) return 0;
  const avg = arr.reduce((s, v) => s + v, 0) / arr.length;
  return Math.sqrt(arr.reduce((s, v) => s + (v - avg) ** 2, 0) / (arr.length - 1));
}

// ── Component ─────────────────────────────────────────────────────────────

export default function BeaconDistanceTester() {
  const [measuredPower, setMeasuredPower] = useState(-52);
  const [pathLossExp, setPathLossExp] = useState(2.0);
  const [mpInput, setMpInput] = useState('-52');
  const [pleInput, setPleInput] = useState('2.0');
  const [processNoise, setProcessNoise] = useState(1);
  const [measureNoise, setMeasureNoise] = useState(3);
  const [pnInput, setPnInput] = useState('1');
  const [mnInput, setMnInput] = useState('3');
  const [outlierThreshold] = useState(12);
  const [windowSize] = useState(15);

  // Stabilization settings
  const [stabilityThreshold, setStabilityThreshold] = useState(0.3); // meters
  const [stabilityDuration, setStabilityDuration] = useState(3); // seconds
  const [stInput, setStInput] = useState('0.3');
  const [sdInput, setSdInput] = useState('3');

  const [beacons, setBeacons] = useState({});
  const [scanning, setScanning] = useState(false);
  const [logLines, setLogLines] = useState([]);
  const [showHardwareGuide, setShowHardwareGuide] = useState(false);

  const readingsRef = useRef({});
  const kalmanFiltersRef = useRef({});
  const medianCacheRef = useRef({});
  const stabilizationRef = useRef({});
  const scanStartTimeRef = useRef(null);

  const rssiToDistance = (rssi, mp = measuredPower, n = pathLossExp) => {
    if (rssi >= 0) return -1;
    return Math.pow(10, (mp - rssi) / (10 * n));
  };

  const resetStabilization = () => {
    stabilizationRef.current = {};
    scanStartTimeRef.current = Date.now();
    // Reset all Kalman filters
    for (const key in kalmanFiltersRef.current) {
      const readings = readingsRef.current[key];
      if (readings && readings.length > 0) {
        kalmanFiltersRef.current[key].reset(readings[readings.length - 1].rssi);
      }
    }
    readingsRef.current = {};
    medianCacheRef.current = {};
    setBeacons({});
    addLog('⏱ Stabilization timer reset — move to your test position now');
  };

  const handleStart = async () => {
    if (Platform.OS !== 'ios' || !isIBeaconRangingAvailable()) {
      addLog('ERROR: Native iBeacon module not available');
      return;
    }

    const perm = await requestPermission();
    addLog(`Permission: ${perm}`);
    if (perm === 'denied') return;

    scanStartTimeRef.current = Date.now();
    stabilizationRef.current = {};

    const unsub = onBeaconsRanged((rangedBeacons) => {
      const now = Date.now();

      for (const b of rangedBeacons) {
        if (b.rssi === 0) continue;
        const key = `${b.major}-${b.minor}`;

        if (!readingsRef.current[key]) {
          readingsRef.current[key] = [];
          medianCacheRef.current[key] = null;
          kalmanFiltersRef.current[key] = new KalmanFilter(processNoise, measureNoise, 5, b.rssi);
          stabilizationRef.current[key] = {
            firstReadingTime: now,
            stableStartTime: null,
            stabilizedTime: null,
            stabilizedDistance: null,
            isStable: false,
            distanceHistory: [],
          };
        }

        const readings = readingsRef.current[key];
        const currentMedian = medianCacheRef.current[key];

        if (currentMedian !== null && readings.length >= 5) {
          if (Math.abs(b.rssi - currentMedian) > outlierThreshold) continue;
        }

        const kalmanRssi = kalmanFiltersRef.current[key].update(b.rssi);

        readings.push({ rssi: b.rssi, kalmanRssi, iosAccuracy: b.accuracy, timestamp: now });
        readingsRef.current[key] = readings.filter((r) => now - r.timestamp < 30000).slice(-(windowSize * 2));

        const recentRssi = readingsRef.current[key].slice(-windowSize).map((r) => r.rssi);
        medianCacheRef.current[key] = median(recentRssi);

        // ── Stabilization tracking ──
        const stab = stabilizationRef.current[key];
        if (stab && !stab.isStable) {
          const currentDist = rssiToDistance(kalmanRssi);
          if (currentDist > 0) {
            stab.distanceHistory.push({ distance: currentDist, time: now });
            // Keep last 5 seconds of history
            stab.distanceHistory = stab.distanceHistory.filter((d) => now - d.time < 10000);

            // Check if distance has been within threshold for stabilityDuration seconds
            const recentDistances = stab.distanceHistory.filter(
              (d) => now - d.time < stabilityDuration * 1000
            );

            if (recentDistances.length >= 3) {
              const distances = recentDistances.map((d) => d.distance);
              const minD = Math.min(...distances);
              const maxD = Math.max(...distances);
              const range = maxD - minD;

              if (range <= stabilityThreshold) {
                if (!stab.stableStartTime) {
                  stab.stableStartTime = recentDistances[0].time;
                }
                const stableDuration = (now - stab.stableStartTime) / 1000;
                if (stableDuration >= stabilityDuration) {
                  stab.isStable = true;
                  stab.stabilizedTime = (now - stab.firstReadingTime) / 1000;
                  stab.stabilizedDistance = median(distances);
                  addLog(`✅ Beacon ${key} stabilized at ${stab.stabilizedDistance.toFixed(2)}m in ${stab.stabilizedTime.toFixed(1)}s`);
                }
              } else {
                stab.stableStartTime = null;
              }
            }
          }
        }
      }

      // Build display
      const updated = {};
      for (const [key, readings] of Object.entries(readingsRef.current)) {
        if (readings.length === 0) continue;
        const recent = readings.slice(-windowSize);
        const rssiValues = recent.map((r) => r.rssi);
        const kalmanValues = recent.map((r) => r.kalmanRssi);

        const latestRssi = rssiValues[rssiValues.length - 1];
        const latestKalman = kalmanValues[kalmanValues.length - 1];
        const avgRssi = Math.round(rssiValues.reduce((s, v) => s + v, 0) / rssiValues.length);
        const medRssi = Math.round(median(rssiValues));
        const kalmanRssi = parseFloat(latestKalman.toFixed(1));
        const stdDev = standardDeviation(rssiValues);
        const kalmanStdDev = standardDeviation(kalmanValues);
        const stability = stdDev < 3 ? 'stable' : stdDev < 6 ? 'moderate' : 'unstable';

        const stab = stabilizationRef.current[key] || {};
        const elapsed = stab.firstReadingTime ? (Date.now() - stab.firstReadingTime) / 1000 : 0;

        updated[key] = {
          key,
          major: parseInt(key.split('-')[0]),
          minor: parseInt(key.split('-')[1]),
          latestRssi,
          avgRssi,
          medianRssi: medRssi,
          kalmanRssi,
          minRssi: Math.min(...rssiValues),
          maxRssi: Math.max(...rssiValues),
          spread: Math.max(...rssiValues) - Math.min(...rssiValues),
          stdDev: stdDev.toFixed(1),
          kalmanStdDev: kalmanStdDev.toFixed(1),
          stability,
          samples: recent.length,
          totalSamples: readings.length,
          iosAccuracy: recent[recent.length - 1].iosAccuracy,
          // Stabilization data
          isStable: stab.isStable || false,
          stabilizedTime: stab.stabilizedTime || null,
          stabilizedDistance: stab.stabilizedDistance || null,
          elapsed: elapsed.toFixed(1),
          currentDistance: rssiToDistance(kalmanRssi),
        };
      }
      setBeacons({ ...updated });
    });

    await startRanging(BEACON_UUID);
    setScanning(true);
    addLog('⏱ Scanning started — stabilization timer running');
    handleStart._unsub = unsub;
  };

  const handleStop = async () => {
    if (handleStart._unsub) { handleStart._unsub(); handleStart._unsub = null; }
    await stopRanging();
    setScanning(false);
    readingsRef.current = {};
    medianCacheRef.current = {};
    kalmanFiltersRef.current = {};
    stabilizationRef.current = {};
    setBeacons({});
    addLog('Stopped');
  };

  const applySettings = () => {
    const mp = parseFloat(mpInput);
    const ple = parseFloat(pleInput);
    const pn = parseFloat(pnInput);
    const mn = parseFloat(mnInput);
    const st = parseFloat(stInput);
    const sd = parseFloat(sdInput);
    if (!isNaN(mp)) setMeasuredPower(mp);
    if (!isNaN(ple)) setPathLossExp(ple);
    if (!isNaN(pn)) setProcessNoise(pn);
    if (!isNaN(mn)) setMeasureNoise(mn);
    if (!isNaN(st)) setStabilityThreshold(st);
    if (!isNaN(sd)) setStabilityDuration(sd);

    for (const key in kalmanFiltersRef.current) {
      const lastRssi = kalmanFiltersRef.current[key].X;
      kalmanFiltersRef.current[key] = new KalmanFilter(
        !isNaN(pn) ? pn : processNoise, !isNaN(mn) ? mn : measureNoise, 5, lastRssi
      );
    }
    addLog(`Settings: MP=${mp} PLE=${ple} Q=${pn} R=${mn} StabThresh=${st}m StabDur=${sd}s`);
  };

  const addLog = (msg) => {
    const time = new Date().toLocaleTimeString();
    setLogLines((prev) => [`[${time}] ${msg}`, ...prev].slice(0, 50));
  };

  useEffect(() => {
    return () => { if (handleStart._unsub) handleStart._unsub(); stopRanging(); };
  }, []);

  const beaconList = Object.values(beacons).sort((a, b) => b.kalmanRssi - a.kalmanRssi);

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>Beacon Tester v4</Text>
        <Text style={styles.subtitle}>Kalman + stabilization timer</Text>

        {/* Controls */}
        <View style={styles.controls}>
          <TouchableOpacity
            style={[styles.btn, scanning ? styles.btnStop : styles.btnStart]}
            onPress={scanning ? handleStop : handleStart}>
            <Text style={styles.btnText}>{scanning ? '⏹ Stop' : '▶ Start'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, { backgroundColor: '#9a6700' }]}
            onPress={resetStabilization}>
            <Text style={styles.btnText}>⏱ Reset Timer</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btnSmall, { backgroundColor: '#1f3a5f' }]}
            onPress={() => setShowHardwareGuide(true)}>
            <Text style={styles.btnText}>⚙</Text>
          </TouchableOpacity>
        </View>

        {/* Calibration */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Calibration</Text>
          <View style={styles.calRow}>
            <View style={styles.calField}>
              <Text style={styles.calLabel}>Measured Power</Text>
              <TextInput style={styles.calInput} value={mpInput} onChangeText={setMpInput}
                keyboardType="numeric" placeholderTextColor="#666" />
            </View>
            <View style={styles.calField}>
              <Text style={styles.calLabel}>Path Loss Exp</Text>
              <TextInput style={styles.calInput} value={pleInput} onChangeText={setPleInput}
                keyboardType="numeric" placeholderTextColor="#666" />
            </View>
          </View>
          <View style={[styles.calRow, { marginTop: 8 }]}>
            <View style={styles.calField}>
              <Text style={styles.calLabel}>Kalman Q</Text>
              <TextInput style={styles.calInput} value={pnInput} onChangeText={setPnInput}
                keyboardType="numeric" placeholderTextColor="#666" />
            </View>
            <View style={styles.calField}>
              <Text style={styles.calLabel}>Kalman R</Text>
              <TextInput style={styles.calInput} value={mnInput} onChangeText={setMnInput}
                keyboardType="numeric" placeholderTextColor="#666" />
            </View>
          </View>
          <View style={[styles.calRow, { marginTop: 8 }]}>
            <View style={styles.calField}>
              <Text style={styles.calLabel}>Stable Threshold (m)</Text>
              <TextInput style={styles.calInput} value={stInput} onChangeText={setStInput}
                keyboardType="numeric" placeholderTextColor="#666" />
            </View>
            <View style={styles.calField}>
              <Text style={styles.calLabel}>Stable Duration (s)</Text>
              <TextInput style={styles.calInput} value={sdInput} onChangeText={setSdInput}
                keyboardType="numeric" placeholderTextColor="#666" />
            </View>
          </View>
          <TouchableOpacity style={styles.btnApply} onPress={applySettings}>
            <Text style={styles.btnText}>Apply</Text>
          </TouchableOpacity>
          <Text style={styles.calHint}>
            Stable = distance stays within ±{stabilityThreshold}m for {stabilityDuration}s
          </Text>
        </View>

        {/* Reference */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Distance Reference</Text>
          <View style={styles.refRow}>
            {[-55, -58, -62, -66, -70, -74, -78].map((rssi) => {
              const dist = rssiToDistance(rssi);
              return (
                <View key={rssi} style={styles.refItem}>
                  <Text style={styles.refRssi}>{rssi}</Text>
                  <Text style={styles.refDist}>{dist > 0 ? dist.toFixed(1) : '—'}</Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* Beacon List */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Beacons ({beaconList.length})</Text>

          {beaconList.length === 0 && (
            <Text style={styles.emptyText}>
              {scanning ? 'Scanning...' : 'Tap Start'}
            </Text>
          )}

          {beaconList.map((b) => {
            const rawDist = rssiToDistance(b.latestRssi);
            const medDist = rssiToDistance(b.medianRssi);
            const kalDist = rssiToDistance(b.kalmanRssi);
            const stabilityColor =
              b.stability === 'stable' ? '#27ae60' :
              b.stability === 'moderate' ? '#f39c12' : '#e74c3c';

            return (
              <View key={b.key} style={[styles.beaconCard,
                b.isStable && { borderColor: '#238636', borderWidth: 2 }]}>

                {/* Header */}
                <View style={styles.beaconHeader}>
                  <Text style={styles.beaconName}>Maj {b.major} / Min {b.minor}</Text>
                  <View style={styles.stabilityBadge}>
                    <View style={[styles.stabilityDot, { backgroundColor: stabilityColor }]} />
                    <Text style={[styles.stabilityText, { color: stabilityColor }]}>
                      {b.stability} (σ {b.stdDev})
                    </Text>
                  </View>
                </View>

                {/* Stabilization Timer */}
                <View style={[styles.timerBox, b.isStable ? styles.timerStable : styles.timerRunning]}>
                  <View style={styles.timerRow}>
                    <Text style={styles.timerLabel}>
                      {b.isStable ? '✅ STABILIZED' : '⏱ Stabilizing...'}
                    </Text>
                    <Text style={styles.timerElapsed}>
                      {b.isStable
                        ? `${b.stabilizedTime.toFixed(1)}s`
                        : `${b.elapsed}s elapsed`}
                    </Text>
                  </View>
                  {b.isStable ? (
                    <View style={styles.timerResult}>
                      <Text style={styles.timerDistance}>
                        {b.stabilizedDistance.toFixed(2)} m
                      </Text>
                      <Text style={styles.timerSubtext}>
                        Settled in {b.stabilizedTime.toFixed(1)} seconds
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.timerResult}>
                      <Text style={[styles.timerDistance, { color: '#f39c12' }]}>
                        {b.currentDistance > 0 ? b.currentDistance.toFixed(2) + ' m' : '—'}
                      </Text>
                      <Text style={styles.timerSubtext}>
                        Waiting for ±{stabilityThreshold}m for {stabilityDuration}s...
                      </Text>
                    </View>
                  )}
                </View>

                {/* Distance comparison */}
                <View style={styles.distCompare}>
                  <View style={styles.distCol}>
                    <Text style={styles.distLabel}>Raw</Text>
                    <Text style={styles.distRssi}>{b.latestRssi}</Text>
                    <Text style={styles.distValueSmall}>
                      {rawDist > 0 ? rawDist.toFixed(2) + 'm' : '—'}
                    </Text>
                  </View>
                  <View style={styles.distCol}>
                    <Text style={styles.distLabel}>Median</Text>
                    <Text style={styles.distRssi}>{b.medianRssi}</Text>
                    <Text style={styles.distValueSmall}>
                      {medDist > 0 ? medDist.toFixed(2) + 'm' : '—'}
                    </Text>
                  </View>
                  <View style={[styles.distCol, styles.distColHighlight]}>
                    <Text style={[styles.distLabel, { color: '#2ecc71' }]}>Kalman</Text>
                    <Text style={[styles.distRssi, { color: '#2ecc71' }]}>{b.kalmanRssi}</Text>
                    <Text style={styles.distValueBig}>
                      {kalDist > 0 ? kalDist.toFixed(2) + 'm' : '—'}
                    </Text>
                  </View>
                  <View style={styles.distCol}>
                    <Text style={styles.distLabel}>iOS</Text>
                    <Text style={styles.distRssi}>—</Text>
                    <Text style={styles.distValueSmall}>
                      {b.iosAccuracy > 0 ? b.iosAccuracy.toFixed(2) + 'm' : '—'}
                    </Text>
                  </View>
                </View>

                {/* Stats */}
                <View style={styles.beaconStats}>
                  <View style={styles.statCol}>
                    <Text style={styles.statLabel}>Min</Text>
                    <Text style={styles.statValue}>{b.minRssi}</Text>
                  </View>
                  <View style={styles.statCol}>
                    <Text style={styles.statLabel}>Max</Text>
                    <Text style={styles.statValue}>{b.maxRssi}</Text>
                  </View>
                  <View style={styles.statCol}>
                    <Text style={styles.statLabel}>Spread</Text>
                    <Text style={styles.statValue}>±{b.spread}</Text>
                  </View>
                  <View style={styles.statCol}>
                    <Text style={styles.statLabel}>Kalman σ</Text>
                    <Text style={styles.statValue}>{b.kalmanStdDev}</Text>
                  </View>
                  <View style={styles.statCol}>
                    <Text style={styles.statLabel}>N</Text>
                    <Text style={styles.statValue}>{b.samples}</Text>
                  </View>
                </View>

                {/* Signal bar */}
                <View style={styles.signalBarBg}>
                  <View style={[styles.signalBarFill, {
                    width: `${Math.max(0, Math.min(100, ((b.kalmanRssi + 100) / 50) * 100))}%`,
                    backgroundColor: b.kalmanRssi > -65 ? '#27ae60' : b.kalmanRssi > -80 ? '#f39c12' : '#e74c3c',
                  }]} />
                </View>
              </View>
            );
          })}
        </View>

        {/* Log */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Log</Text>
          {logLines.map((line, i) => (
            <Text key={i} style={styles.logLine}>{line}</Text>
          ))}
        </View>
      </ScrollView>

      {/* Hardware Guide Modal */}
      <Modal visible={showHardwareGuide} animationType="slide" transparent
        onRequestClose={() => setShowHardwareGuide(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>⚙ Hardware Tuning</Text>
            <ScrollView style={styles.modalScroll}>
              <Text style={styles.guideSection}>Lower Advertising Interval</Text>
              <Text style={styles.guideText}>
                KBeaconPro → connect → SLOT0 → Adv Interval → change to 100-300{'\n'}
                Lower = more readings/sec = faster stabilization{'\n'}
                100ms ≈ 10/sec | 300ms ≈ 3/sec | 1022ms ≈ 1/sec
              </Text>
              <Text style={styles.guideSection}>Increase TX Power</Text>
              <Text style={styles.guideText}>
                KBeaconPro → connect → SLOT0 → Tx Power → change to +4{'\n'}
                Recalibrate Measured Power after changing!{'\n'}
                Stand 1m → note Kalman RSSI → that's your new MP
              </Text>
              <Text style={styles.guideSection}>Stabilization Timer Guide</Text>
              <Text style={styles.guideText}>
                The timer measures how long until distance readings settle.{'\n\n'}
                Threshold: how close readings must stay (default ±0.3m){'\n'}
                Duration: how long they must stay close (default 3s){'\n\n'}
                Lower threshold = stricter (takes longer to stabilize){'\n'}
                Higher threshold = looser (stabilizes faster){'\n\n'}
                Workflow:{'\n'}
                1. Stand at known distance from beacon{'\n'}
                2. Tap "Reset Timer"{'\n'}
                3. Wait until green "STABILIZED" appears{'\n'}
                4. Record the stabilized distance and time{'\n'}
                5. Move to next distance, tap "Reset Timer" again
              </Text>
            </ScrollView>
            <TouchableOpacity style={styles.modalClose}
              onPress={() => setShowHardwareGuide(false)}>
              <Text style={styles.btnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d1117' },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingTop: 54, paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: 'bold', color: '#f0f6fc', marginBottom: 4 },
  subtitle: { fontSize: 12, color: '#8b949e', marginBottom: 16 },

  controls: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  btnSmall: { width: 44, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  btnStart: { backgroundColor: '#238636' },
  btnStop: { backgroundColor: '#da3633' },
  btnText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  btnApply: { backgroundColor: '#1f6feb', paddingVertical: 10, borderRadius: 6, alignItems: 'center', marginTop: 10 },

  card: {
    backgroundColor: '#161b22', borderRadius: 10, padding: 14,
    borderWidth: 1, borderColor: '#21262d', marginBottom: 12,
  },
  cardTitle: { color: '#f0f6fc', fontSize: 14, fontWeight: 'bold', marginBottom: 10 },

  calRow: { flexDirection: 'row', gap: 8 },
  calField: { flex: 1 },
  calLabel: { color: '#8b949e', fontSize: 9, marginBottom: 4, textTransform: 'uppercase' },
  calInput: {
    backgroundColor: '#0d1117', color: '#f0f6fc', padding: 8, borderRadius: 6,
    fontSize: 15, fontWeight: 'bold', borderWidth: 1, borderColor: '#30363d', textAlign: 'center',
  },
  calHint: { color: '#8b949e', fontSize: 10, marginTop: 6 },

  refRow: { flexDirection: 'row', justifyContent: 'space-between' },
  refItem: { alignItems: 'center' },
  refRssi: { color: '#8b949e', fontSize: 9 },
  refDist: { color: '#58a6ff', fontSize: 11, fontWeight: 'bold' },

  emptyText: { color: '#8b949e', fontSize: 13, textAlign: 'center', paddingVertical: 20 },

  beaconCard: {
    backgroundColor: '#0d1117', borderRadius: 8, padding: 10,
    marginBottom: 8, borderWidth: 1, borderColor: '#21262d',
  },
  beaconHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6,
  },
  beaconName: { color: '#f0f6fc', fontSize: 13, fontWeight: 'bold' },
  stabilityBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stabilityDot: { width: 7, height: 7, borderRadius: 4 },
  stabilityText: { fontSize: 10, fontWeight: '600' },

  // Timer styles
  timerBox: {
    borderRadius: 8, padding: 10, marginBottom: 8,
  },
  timerRunning: { backgroundColor: '#1a2a1a', borderWidth: 1, borderColor: '#9a6700' },
  timerStable: { backgroundColor: '#0d2818', borderWidth: 2, borderColor: '#238636' },
  timerRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4,
  },
  timerLabel: { color: '#f0f6fc', fontSize: 13, fontWeight: 'bold' },
  timerElapsed: { color: '#8b949e', fontSize: 12, fontFamily: 'monospace' },
  timerResult: { alignItems: 'center', marginTop: 4 },
  timerDistance: { color: '#2ecc71', fontSize: 28, fontWeight: 'bold' },
  timerSubtext: { color: '#8b949e', fontSize: 11, marginTop: 2 },

  distCompare: {
    flexDirection: 'row', backgroundColor: '#111820', borderRadius: 6,
    padding: 6, marginBottom: 6,
  },
  distCol: { flex: 1, alignItems: 'center', paddingVertical: 4 },
  distColHighlight: {
    backgroundColor: '#0d2818', borderRadius: 4,
    borderWidth: 1, borderColor: '#1a4a2e',
  },
  distLabel: { color: '#8b949e', fontSize: 8, textTransform: 'uppercase', marginBottom: 2 },
  distRssi: { color: '#c9d1d9', fontSize: 11, fontWeight: '600' },
  distValueSmall: { color: '#8b949e', fontSize: 12, fontWeight: 'bold', marginTop: 2 },
  distValueBig: { color: '#2ecc71', fontSize: 16, fontWeight: 'bold', marginTop: 2 },

  beaconStats: { flexDirection: 'row', marginBottom: 4 },
  statCol: { flex: 1, alignItems: 'center' },
  statLabel: { color: '#8b949e', fontSize: 8, textTransform: 'uppercase', marginBottom: 1 },
  statValue: { color: '#c9d1d9', fontSize: 11, fontWeight: '600' },

  signalBarBg: {
    height: 3, backgroundColor: '#21262d', borderRadius: 2, marginTop: 4, overflow: 'hidden',
  },
  signalBarFill: { height: '100%', borderRadius: 2 },

  logLine: { color: '#8b949e', fontSize: 10, fontFamily: 'monospace', marginBottom: 2 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: '#161b22', borderTopLeftRadius: 16, borderTopRightRadius: 16,
    padding: 20, maxHeight: '80%',
  },
  modalTitle: { color: '#f0f6fc', fontSize: 18, fontWeight: 'bold', marginBottom: 12 },
  modalScroll: { maxHeight: '80%' },
  modalClose: {
    marginTop: 12, paddingVertical: 10, backgroundColor: '#21262d',
    borderRadius: 8, alignItems: 'center',
  },
  guideSection: { color: '#58a6ff', fontSize: 15, fontWeight: 'bold', marginTop: 16, marginBottom: 6 },
  guideText: { color: '#c9d1d9', fontSize: 13, lineHeight: 20 },
});