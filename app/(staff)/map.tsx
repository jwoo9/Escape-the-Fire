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
  triggerEmergency,
} from '../../services/emergency';
import { initLocation, setSimulatedFloor, startTracking, stopTracking } from '../../services/location';

export default function StaffMapScreen() {
  const { user }   = useAuth();
  const insets     = useSafeAreaInsets();
  const { selectZoneMode } = useLocalSearchParams<{ selectZoneMode?: string }>();

  const [emergency,    setEmergency]    = useState<any>({ active: false });
  const [blockedZones, setBlockedZones] = useState<any[]>([]);
  const [userPos,      setUserPos]      = useState<{ svgX: number; svgY: number } | null>(null);
  const [currentFloor, setCurrentFloor] = useState<FloorId>('main');
  const [locating,     setLocating]     = useState(true);

  const posRef   = useRef<{ svgX: number; svgY: number } | null>(null);
  const blockedIds = blockedZones.filter(z => z.floor === currentFloor).map(z => z.zoneId);

  useEffect(() => {
    const unsubE = subscribeEmergency(setEmergency);
    const unsubZ = subscribeBlockedZones(setBlockedZones);
    return () => { unsubE(); unsubZ(); };
  }, []);

  const initials = (user?.displayName ?? user?.email ?? '?')
    .split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2);

  useEffect(() => {
    if (!user?.uid) return;
    initLocation(user.uid, initials, pos => {
      const prev = posRef.current;
      if (!prev || Math.abs(pos.svgX - prev.svgX) > 5 || Math.abs(pos.svgY - prev.svgY) > 5) {
        posRef.current = { svgX: pos.svgX, svgY: pos.svgY };
        setUserPos({ svgX: pos.svgX, svgY: pos.svgY });
        setCurrentFloor(pos.floor);
      }
      setLocating(false);
    });
    startTracking();
    const t = setTimeout(() => {
      if (!posRef.current) { posRef.current = { svgX: 209, svgY: 379 }; setUserPos({ svgX: 209, svgY: 379 }); }
      setLocating(false);
    }, 800);
    return () => { stopTracking(); clearTimeout(t); };
  }, [user?.uid]);

  const handleZoneTap = useCallback((zoneId: string, zoneLabel: string) => {
    if (blockedIds.includes(zoneId)) {
      Alert.alert('Already Reported', `"${zoneLabel}" is already marked as hazardous.`);
      return;
    }
    if (!emergency.active) {
      Alert.alert(
        'Trigger Emergency?',
        `Report fire in "${zoneLabel}" and trigger the building-wide alarm?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Confirm & Trigger', style: 'destructive',
            onPress: async () => {
              await blockZone(zoneId, zoneLabel, user?.uid ?? 'staff');
              await triggerEmergency(user?.uid ?? 'staff', `Fire reported in ${zoneLabel}`);
            },
          },
        ],
      );
    } else {
      Alert.alert(
        'Report Fire Zone',
        `Mark "${zoneLabel}" as on fire?\n\nEvacuation routes will avoid this area.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Report Fire Here', style: 'destructive',
            onPress: () => { blockZone(zoneId, zoneLabel, user?.uid ?? 'staff'); },
          },
        ],
      );
    }
  }, [blockedIds, user, emergency.active]);

  const toggleFloor = () => {
    const next: FloorId = currentFloor === 'main' ? 'squash' : 'main';
    setCurrentFloor(next);
    setSimulatedFloor(next);
    setUserPos(null);
    posRef.current = null;
  };

  const floor = FLOORS[currentFloor];

  return (
    <View style={[s.root, { paddingTop: emergency.active ? 0 : insets.top }]}>

      {/* Emergency banner */}
      {emergency.active && (
        <View style={[s.alertBanner, { paddingTop: insets.top + 4 }]}>
          <Ionicons name="warning" size={13} color="#fff" />
          <Text style={s.alertText}>FIRE ALERT · ACTIVE — EVACUATE NOW</Text>
          <Ionicons name="warning" size={13} color="#fff" />
        </View>
      )}

      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.headerTitle}>
            {emergency.active ? 'Evacuation Map' : 'Floor Map'}
          </Text>
          <Text style={s.headerSub}>{floor.label}</Text>
        </View>
        <View style={s.headerRight}>
          <TouchableOpacity style={s.pillBtn} onPress={toggleFloor}>
            <Ionicons name="layers-outline" size={14} color="#94a3b8" />
            <Text style={s.pillBtnText}>{currentFloor === 'main' ? 'Squash' : 'Main'}</Text>
          </TouchableOpacity>
          <View style={s.pillBtn}>
            {locating
              ? <ActivityIndicator size="small" color="#38bdf8" />
              : <View style={[s.locDot, { backgroundColor: emergency.active ? '#ef4444' : '#22c55e' }]} />}
            <Text style={s.pillBtnText}>{locating ? '…' : 'Live'}</Text>
          </View>
        </View>
      </View>

      {/* Map — takes all remaining space */}
      <View style={s.mapWrap}>
        <FloorMap
          floor={floor}
          userPosition={userPos}
          allStaff={[]}
          blockedZoneIds={blockedIds}
          isEmergency={emergency.active}
          isAdmin={false}
          onZoneTap={handleZoneTap}
        />
      </View>

      {/* Legend / action bar at bottom */}
      <View style={[s.bottomBar, { paddingBottom: insets.bottom + 8 }]}>
        <View style={s.legend}>
          <View style={s.legendItem}>
            <View style={[s.legendDot, { backgroundColor: '#2563eb' }]} />
            <Text style={s.legendText}>You</Text>
          </View>
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
          {emergency.active && (
            <View style={s.legendItem}>
              <View style={s.legendArrow} />
              <Text style={s.legendText}>Route</Text>
            </View>
          )}
        </View>

        {!emergency.active ? (
          <TouchableOpacity
            style={[s.reportBtn, s.reportBtnActive]}
            onPress={() => {
              Alert.alert('Trigger Emergency', 'Alert all staff immediately? (You can also tap a room on the map to trigger).', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Trigger Now', style: 'destructive', onPress: () => triggerEmergency(user?.uid ?? 'staff', 'Manual trigger') }
              ]);
            }}
          >
            <Ionicons name="warning" size={16} color="#ef4444" />
            <Text style={[s.reportBtnText, { color: '#ef4444' }]}>TRIGGER EMERGENCY</Text>
          </TouchableOpacity>
        ) : (
          <View style={s.hintContainer}>
            <Ionicons name="information-circle" size={15} color="#38bdf8" />
            <Text style={s.hintTextMap}>Tap any room on the map to report a fire zone</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root:           { flex: 1, backgroundColor: '#0f172a' },

  alertBanner:    { backgroundColor: '#7f1d1d', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#ef4444' },
  alertText:      { color: '#fca5a5', fontWeight: '700', fontSize: 11, letterSpacing: 1.3 },

  header:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  headerTitle:    { fontSize: 16, fontWeight: '700', color: '#f1f5f9' },
  headerSub:      { fontSize: 11, color: '#475569', marginTop: 2 },
  headerRight:    { flexDirection: 'row', gap: 8, alignItems: 'center' },

  pillBtn:        { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#1e293b', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#334155' },
  pillBtnText:    { color: '#94a3b8', fontSize: 11, fontWeight: '600' },
  locDot:         { width: 6, height: 6, borderRadius: 3 },

  hintContainer:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#0c1929', paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#1e3a5f' },
  hintTextMap:    { color: '#94a3b8', fontSize: 13, fontWeight: '600' },

  mapWrap:        { flex: 1, overflow: 'hidden' },

  bottomBar:      { backgroundColor: '#0f172a', borderTopWidth: 1, borderTopColor: '#1e293b', paddingHorizontal: 16, paddingTop: 10, gap: 8 },
  legend:         { flexDirection: 'row', gap: 14, alignItems: 'center', flexWrap: 'wrap' },
  legendItem:     { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot:      { width: 8, height: 8, borderRadius: 4 },
  legendArrow:    { width: 14, height: 3, backgroundColor: '#38bdf8', borderRadius: 1.5 },
  legendText:     { color: '#475569', fontSize: 12, fontWeight: '500' },

  reportBtn:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#1e293b', paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#334155' },
  reportBtnActive:{ backgroundColor: '#1a0505', borderColor: '#7f1d1d' },
  reportBtnText:  { color: '#94a3b8', fontSize: 13, fontWeight: '600' },
});