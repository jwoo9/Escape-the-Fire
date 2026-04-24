/**
 * app/(admin)/map.tsx
 * Admin map — dark theme, block/unblock zones, live staff tracking during emergency.
 */

import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import FloorMap from '../../components/FloorMap';
import { FLOORS, FloorId } from '../../constants/mapData';
import { useAuth } from '../../context/AuthContext';
import {
  blockZone,
  clearEmergency,
  subscribeBlockedZones,
  subscribeEmergency,
  subscribeLocations,
  triggerEmergency,
  unblockZone,
} from '../../services/emergency';
import { initLocation, setSimulatedFloor, startTracking, stopTracking } from '../../services/location';

// ─── Emergency Report Modal ───────────────────────────────────────────────────
type ModalStep = 'ask' | 'confirm' | 'triggering';

function EmergencyModal({
  visible, onClose, onTriggerNow, onGoToMap
}: {
  visible: boolean;
  onClose: () => void;
  onTriggerNow: () => Promise<void>;
  onGoToMap: () => void;
}) {
  const [step, setStep] = useState<ModalStep>('ask');
  useEffect(() => { if (visible) setStep('ask'); }, [visible]);

  const handleTrigger = async () => {
    setStep('triggering');
    await onTriggerNow();
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={ms.backdrop} onPress={step === 'ask' ? onClose : undefined}>
        <Pressable style={ms.sheet} onPress={() => {}}>
          <View style={ms.handle} />

          {step === 'ask' && (
            <>
              <View style={ms.iconWrap}>
                <Ionicons name="warning" size={28} color="#ef4444" />
              </View>
              <Text style={ms.title}>Trigger Emergency</Text>
              <Text style={ms.body}>Alert all staff and activate evacuation routing across the building.</Text>
              <Text style={ms.question}>Mark a hazardous zone first?</Text>

              <TouchableOpacity style={ms.optionBtn} onPress={onGoToMap}>
                <View style={ms.optionIcon}>
                  <Ionicons name="map-outline" size={18} color="#2563eb" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={ms.optionTitle}>Select Zone on Map</Text>
                  <Text style={ms.optionSub}>Routing will automatically avoid the marked zone</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#475569" />
              </TouchableOpacity>

              <TouchableOpacity style={ms.optionBtn} onPress={() => setStep('confirm')}>
                <View style={[ms.optionIcon, { backgroundColor: '#450a0a' }]}>
                  <Ionicons name="flash-outline" size={18} color="#ef4444" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={ms.optionTitle}>Trigger Immediately</Text>
                  <Text style={ms.optionSub}>Alert all staff now without a specific zone</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#475569" />
              </TouchableOpacity>

              <TouchableOpacity style={ms.cancelBtn2} onPress={onClose}>
                <Text style={ms.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </>
          )}

          {step === 'confirm' && (
            <>
              <View style={[ms.iconWrap, { backgroundColor: '#450a0a' }]}>
                <Ionicons name="flame" size={28} color="#ef4444" />
              </View>
              <Text style={ms.title}>Confirm Emergency</Text>
              <Text style={ms.body}>This will immediately alert every staff member and activate evacuation mode.</Text>
              <TouchableOpacity style={ms.triggerBtn} onPress={handleTrigger}>
                <Ionicons name="warning" size={16} color="#fff" />
                <Text style={ms.triggerText}>  TRIGGER EMERGENCY NOW</Text>
              </TouchableOpacity>
              <TouchableOpacity style={ms.cancelBtn2} onPress={() => setStep('ask')}>
                <Text style={ms.cancelText}>← Go back</Text>
              </TouchableOpacity>
            </>
          )}

          {step === 'triggering' && (
            <>
              <ActivityIndicator size="large" color="#ef4444" style={{ marginBottom: 16 }} />
              <Text style={ms.title}>Activating…</Text>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function AdminMapScreen() {
  const { user }  = useAuth();
  const insets    = useSafeAreaInsets();

  const [emergency,    setEmergency]    = useState<any>({ active: false });
  const [blockedZones, setBlockedZones] = useState<any[]>([]);
  const [allLocations, setAllLocations] = useState<Record<string, any>>({});
  const [userPos,      setUserPos]      = useState<{ svgX: number; svgY: number } | null>(null);
  const [currentFloor, setCurrentFloor] = useState<FloorId>('main');
  const [locating,     setLocating]     = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [isSelectingZone, setIsSelectingZone] = useState(false);

  const posRef = useRef<{ svgX: number; svgY: number } | null>(null);

  const blockedIds = blockedZones.map(z => z.zoneId);

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
    if (!isSelectingZone) return;

    const isBlocked = blockedIds.includes(zoneId);

    // Tap a currently blocked zone → offer to unblock
    if (isBlocked) {
      if (Platform.OS === 'web') {
        if (window.confirm(`"${zoneLabel}" is currently marked as hazardous. Unblock it?`)) {
          unblockZone(zoneId);
        }
        return;
      }
      Alert.alert(
        'Zone Blocked',
        `"${zoneLabel}" is currently marked as hazardous. Unblock it?`,
        [
          { text: 'Keep Blocked', style: 'cancel' },
          { text: 'Unblock', onPress: () => { unblockZone(zoneId); } },
        ]
      );
      return;
    }

    const confirmMsg = emergency.active
      ? `Mark "${zoneLabel}" as hazardous?\n\nStaff will be routed around this area.`
      : `Report fire in "${zoneLabel}" and trigger the building-wide alarm?`;

    if (Platform.OS === 'web') {
      if (window.confirm(confirmMsg)) {
        blockZone(zoneId, zoneLabel, user?.uid ?? 'admin');
        if (!emergency.active) triggerEmergency(user?.uid ?? 'admin', `Fire reported in ${zoneLabel}`);
      }
      return;
    }

    Alert.alert(
      emergency.active ? 'Block Zone' : 'Trigger Emergency?',
      confirmMsg,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: emergency.active ? 'Block Zone' : 'Confirm & Trigger',
          style: 'destructive',
          onPress: async () => {
            await blockZone(zoneId, zoneLabel, user?.uid ?? 'admin');
            if (!emergency.active) await triggerEmergency(user?.uid ?? 'admin', `Fire reported in ${zoneLabel}`);
          },
        },
      ]
    );
  }, [blockedIds, currentFloor, user, emergency.active, isSelectingZone]);

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
            {emergency.active ? 'Live Staff Map' : 'Floor Map'}
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

        {!emergency.active ? (
          <TouchableOpacity
            style={[s.actionBtn, s.actionBtnActive]}
            onPress={() => setModalVisible(true)}
          >
            <Ionicons name="warning" size={16} color="#ef4444" />
            <Text style={[s.actionBtnText, { color: '#ef4444' }]}>Trigger Alarm</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[s.actionBtn, s.actionBtnClear]}
            onPress={() => {
              if (Platform.OS === 'web') {
                if (window.confirm('Mark All Clear? This will end the emergency for all staff.')) {
                  clearEmergency();
                }
                return;
              }
              Alert.alert('Mark All Clear?', 'This will end the emergency for all staff.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'All Clear', onPress: () => clearEmergency() },
              ]);
            }}
          >
            <Ionicons name="checkmark-circle-outline" size={16} color="#22c55e" />
            <Text style={[s.actionBtnText, { color: '#22c55e' }]}>All Clear</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={s.hint}>
        {isSelectingZone ? (
          <>
            <Ionicons name="finger-print" size={14} color="#38bdf8" />
            <Text style={s.hintText}>Tap the hazardous room on the map.</Text>
            <TouchableOpacity onPress={() => setIsSelectingZone(false)}>
              <Text style={[s.hintText, { color: '#ef4444', flex: 0 }]}>Done</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Ionicons name="information-circle-outline" size={14} color="#38bdf8" />
            <Text style={s.hintText}>Click "Trigger Alarm" to block a zone.</Text>
          </>
        )}
      </View>

      {/* Map */}
      <View style={s.mapWrap}>
        <FloorMap
          floor={floor}
          userPosition={userPos}
          allStaff={floorStaff}
          blockedZoneIds={blockedIds}
          isEmergency={emergency.active}
          isAdmin={true}
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

        <EmergencyModal
          visible={modalVisible}
          onClose={() => setModalVisible(false)}
          onTriggerNow={async () => { await triggerEmergency(user?.uid ?? 'admin', 'Manual trigger from admin'); }}
          onGoToMap={() => {
            setModalVisible(false);
            setIsSelectingZone(true);
          }}
        />
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
  actionBtnClear:  { borderColor: '#14532d', backgroundColor: '#052e16' },
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

// ─── Modal styles ─────────────────────────────────────────────────────────────
const ms = StyleSheet.create({
  backdrop:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet:       { backgroundColor: '#1e293b', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 36, borderWidth: 1, borderColor: '#334155' },
  handle:      { width: 36, height: 4, borderRadius: 2, backgroundColor: '#334155', alignSelf: 'center', marginBottom: 20 },
  iconWrap:    { width: 56, height: 56, borderRadius: 16, backgroundColor: '#450a0a', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 14 },
  title:       { fontSize: 18, fontWeight: '700', color: '#f1f5f9', textAlign: 'center', marginBottom: 8 },
  body:        { fontSize: 13, color: '#64748b', textAlign: 'center', lineHeight: 19, marginBottom: 4 },
  question:    { fontSize: 13, fontWeight: '600', color: '#94a3b8', textAlign: 'center', marginTop: 14, marginBottom: 12 },
  optionBtn:   { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, borderRadius: 13, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f172a', marginBottom: 8 },
  optionIcon:  { width: 38, height: 38, borderRadius: 11, backgroundColor: '#1e3a5f', alignItems: 'center', justifyContent: 'center' },
  optionTitle: { fontSize: 14, fontWeight: '700', color: '#f1f5f9' },
  optionSub:   { fontSize: 12, color: '#475569', marginTop: 2, lineHeight: 16 },
  triggerBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#ef4444', paddingVertical: 15, borderRadius: 13, marginTop: 16 },
  triggerText: { color: '#fff', fontWeight: '700', fontSize: 14, letterSpacing: 0.5 },
  cancelBtn2:  { alignItems: 'center', paddingVertical: 14, marginTop: 6 },
  cancelText:  { color: '#64748b', fontWeight: '500', fontSize: 14 },
});