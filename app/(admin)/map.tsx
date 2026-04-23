/**
 * app/(admin)/map.tsx
 * Admin map — dark theme, block/unblock zones, live staff tracking during emergency.
 */

import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import FloorMap from '../../components/FloorMap';
import { FLOORS, FloorId } from '../../constants/mapData';
import { useAuth } from '../../context/AuthContext';
import {
  blockZone,
  subscribeBlockedZones,
  subscribeEmergency,
  subscribeLocations,
  triggerEmergency,
  unblockZone,
} from '../../services/emergency';
import { initLocation, setSimulatedFloor, startTracking, stopTracking } from '../../services/location';

export default function AdminMapScreen() {
  const { user }  = useAuth();
  const insets    = useSafeAreaInsets();
  const { selectZoneMode } = useLocalSearchParams<{ selectZoneMode?: string }>();

  const [emergency,    setEmergency]    = useState<any>({ active: false });
  const [blockedZones, setBlockedZones] = useState<any[]>([]);
  const [allLocations, setAllLocations] = useState<Record<string, any>>({});
  const [userPos,      setUserPos]      = useState<{ svgX: number; svgY: number } | null>(null);
  const [currentFloor, setCurrentFloor] = useState<FloorId>('main');
  const [selectMode,   setSelectMode]   = useState(selectZoneMode === '1');
  const [locating,     setLocating]     = useState(true);

  const posRef = useRef<{ svgX: number; svgY: number } | null>(null);

  const blockedIds = blockedZones
    .filter(z => z.floor === currentFloor)
    .map(z => z.zoneId);

  const floorStaff = emergency.active
    ? Object.entries(allLocations)
        .filter(([uid, loc]) => uid !== user?.uid && loc.floor === currentFloor)
        .map(([uid, loc]) => ({ uid, svgX: loc.svgX, svgY: loc.svgY, initials: loc.initials ?? '?' }))
    : [];

  const staffTotal = Object.keys(allLocations).filter(uid => uid !== user?.uid).length;

  useEffect(() => {
    const unsubE = subscribeEmergency(setEmergency);
    const unsubZ = subscribeBlockedZones(setBlockedZones);
    const unsubL = subscribeLocations(setAllLocations);
    return () => { unsubE(); unsubZ(); unsubL(); };
  }, []);

  const initials = (user?.displayName ?? user?.email ?? 'AD')
    .split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2);

  useEffect(() => {
    if (!user?.uid) return;
    initLocation(user.uid, initials, pos => {
      const prev = posRef.current;
      const dx = prev ? Math.abs(pos.svgX - prev.svgX) : 999;
      const dy = prev ? Math.abs(pos.svgY - prev.svgY) : 999;
      if (dx > 5 || dy > 5 || !prev) {
        const next = { svgX: pos.svgX, svgY: pos.svgY };
        posRef.current = next;
        setUserPos(next);
        setCurrentFloor(pos.floor);
      }
      setLocating(false);
    });
    startTracking();
    const t = setTimeout(() => {
      if (!posRef.current) {
        const def = { svgX: 406, svgY: 362 };
        posRef.current = def;
        setUserPos(def);
      }
      setLocating(false);
    }, 800);
    return () => { stopTracking(); clearTimeout(t); };
  }, [user?.uid]);

  // ── Zone tap — admin can block AND unblock; also triggers emergency if selectZoneMode ──
  const handleZoneTap = useCallback((zoneId: string, zoneLabel: string) => {
    const isBlocked = blockedIds.includes(zoneId);

    // Tap a currently blocked zone → offer to unblock
    if (isBlocked) {
      Alert.alert(
        'Zone Blocked',
        `"${zoneLabel}" is currently marked as hazardous. Unblock it?`,
        [
          { text: 'Keep Blocked', style: 'cancel' },
          { text: 'Unblock', onPress: () => unblockZone(zoneId) },
        ],
      );
      return;
    }

    // Arrived from emergency modal — block zone AND trigger emergency together
    if (selectZoneMode === '1') {
      Alert.alert(
        'Confirm Hazardous Zone',
        `Mark "${zoneLabel}" as the fire zone and trigger the emergency alert?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Confirm & Trigger', style: 'destructive',
            onPress: async () => {
              await blockZone(zoneId, zoneLabel, user!.uid);
              await triggerEmergency(user!.uid, `Fire reported in ${zoneLabel}`);
              setSelectMode(false);
            },
          },
        ],
      );
      return;
    }

    // Normal block-zone mode
    Alert.alert(
      'Block Zone',
      `Mark "${zoneLabel}" as hazardous?\n\nStaff will be routed around this area.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block Zone', style: 'destructive',
          onPress: () => { blockZone(zoneId, zoneLabel, user!.uid); setSelectMode(false); },
        },
      ],
    );
  }, [blockedIds, currentFloor, user, selectZoneMode]);

  const toggleFloor = () => {
    const next: FloorId = currentFloor === 'main' ? 'squash' : 'main';
    setCurrentFloor(next);
    setSimulatedFloor(next);
    setUserPos(null);
    posRef.current = null;
  };

  const floor = FLOORS[currentFloor];

  return (
    <View style={[s.container, { paddingTop: emergency.active ? 0 : insets.top }]}>

      {/* Emergency banner */}
      {emergency.active && (
        <View style={[s.emergencyBanner, { paddingTop: insets.top + 6 }]}>
          <Ionicons name="warning" size={14} color="#fff" />
          <Text style={s.emergencyText}>
            EMERGENCY ACTIVE — {staffTotal} STAFF TRACKED
          </Text>
          <Ionicons name="warning" size={14} color="#fff" />
        </View>
      )}

      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.headerTitle}>
            {selectMode
              ? (selectZoneMode === '1' ? 'Select Fire Zone' : 'Block Zone')
              : emergency.active ? 'Live Staff Map' : 'Floor Map'}
          </Text>
          <Text style={s.headerSub}>{floor.label}</Text>
        </View>
        <View style={s.locPill}>
          {locating
            ? <ActivityIndicator size="small" color="#38bdf8" style={{ marginRight: 4 }} />
            : <View style={[s.locDot, { backgroundColor: emergency.active ? '#ef4444' : '#22c55e' }]} />}
          <Text style={s.locText}>{locating ? 'Locating…' : 'Located'}</Text>
        </View>
      </View>

      {/* Action bar */}
      <View style={s.actionBar}>
        <TouchableOpacity style={s.actionBtn} onPress={toggleFloor}>
          <Ionicons name="layers-outline" size={16} color="#94a3b8" />
          <Text style={s.actionBtnText}>
            {currentFloor === 'main' ? 'Squash Floor' : 'Main Floor'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.actionBtn, selectMode && s.actionBtnActive]}
          onPress={() => setSelectMode(v => !v)}
        >
          <Ionicons
            name={selectMode ? 'close-circle' : 'ban-outline'}
            size={16}
            color={selectMode ? '#ef4444' : '#94a3b8'}
          />
          <Text style={[s.actionBtnText, selectMode && { color: '#ef4444' }]}>
            {selectMode ? 'Cancel' : 'Block Zone'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Select mode hint */}
      {selectMode && (
        <View style={s.hint}>
          <Ionicons name="finger-print-outline" size={14} color="#38bdf8" />
          <Text style={s.hintText}>
            {selectZoneMode === '1'
              ? 'Tap the fire zone — this will trigger the emergency alert'
              : 'Tap a zone to block it. Tap a blocked zone to unblock.'}
          </Text>
        </View>
      )}

      {/* Map */}
      <View style={s.mapWrap}>
        <FloorMap
          floor={floor}
          userPosition={userPos}
          allStaff={floorStaff}
          blockedZoneIds={blockedIds}
          isEmergency={emergency.active}
          isAdmin={true}
          selectMode={selectMode}
          onZoneTap={handleZoneTap}
        />
      </View>

      {/* Legend */}
      <View style={[s.legend, { paddingBottom: insets.bottom + 8 }]}>
        <View style={s.legendItem}>
          <View style={[s.legendDot, { backgroundColor: '#2563eb' }]} />
          <Text style={s.legendText}>You</Text>
        </View>
        {emergency.active && (
          <View style={s.legendItem}>
            <View style={[s.legendDot, { backgroundColor: '#8b5cf6' }]} />
            <Text style={s.legendText}>Staff ({floorStaff.length})</Text>
          </View>
        )}
        <View style={s.legendItem}>
          <View style={[s.legendDot, { backgroundColor: '#22c55e' }]} />
          <Text style={s.legendText}>Exit</Text>
        </View>
        {blockedIds.length > 0 && (
          <View style={s.legendItem}>
            <Ionicons name="flame" size={12} color="#ef4444" />
            <Text style={s.legendText}>{blockedIds.length} blocked</Text>
          </View>
        )}
        {!emergency.active && (
          <Text style={s.legendHint}>Staff visible during emergency</Text>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#0f172a' },

  emergencyBanner: { backgroundColor: '#7f1d1d', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#ef4444' },
  emergencyText:   { color: '#fca5a5', fontWeight: '700', fontSize: 12, letterSpacing: 1 },

  header:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 12, backgroundColor: '#0f172a', borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  headerTitle:     { fontSize: 17, fontWeight: '700', color: '#f1f5f9' },
  headerSub:       { fontSize: 12, color: '#475569', marginTop: 2 },

  locPill:         { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#1e293b', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: '#334155' },
  locDot:          { width: 7, height: 7, borderRadius: 3.5 },
  locText:         { color: '#94a3b8', fontSize: 12, fontWeight: '600' },

  actionBar:       { flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#0f172a', borderBottomWidth: 1, borderBottomColor: '#1e293b', gap: 8 },
  actionBtn:       { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#1e293b', paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: '#334155' },
  actionBtnActive: { backgroundColor: '#1a0505', borderColor: '#7f1d1d' },
  actionBtnText:   { color: '#94a3b8', fontSize: 13, fontWeight: '600' },

  hint:            { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#0c1929', borderBottomWidth: 1, borderBottomColor: '#1e3a5f', paddingHorizontal: 16, paddingVertical: 9 },
  hintText:        { color: '#94a3b8', fontSize: 13, flex: 1, lineHeight: 18 },

  mapWrap:         { flex: 1, overflow: 'hidden' },

  legend:          { flexDirection: 'row', gap: 14, paddingHorizontal: 16, paddingTop: 10, backgroundColor: '#0f172a', borderTopWidth: 1, borderTopColor: '#1e293b', flexWrap: 'wrap', alignItems: 'center' },
  legendItem:      { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot:       { width: 8, height: 8, borderRadius: 4 },
  legendText:      { color: '#475569', fontSize: 12, fontWeight: '500' },
  legendHint:      { color: '#334155', fontSize: 11, fontStyle: 'italic', marginLeft: 'auto' },
});