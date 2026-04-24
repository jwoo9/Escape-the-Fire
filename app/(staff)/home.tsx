/**
 * app/(staff)/home.tsx
 *
 * Primary staff screen — map-first layout:
 *  - Fire alert banner when emergency is active
 *  - Route card: direction + ETA to nearest exit
 *  - Full interactive FloorMap
 *  - Stat pills: Nearby / Safe / Hazards
 *  - "I'M SAFE — CHECK IN" button (writes to Firebase)
 *  - "REPORT HAZARD" button opens zone-select mode directly on this map
 *  - Emergency modal with zone-select-on-map or trigger-now flow
 */

import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import FloorMap from '../../components/FloorMap';
import { FLOORS, FloorId } from '../../constants/mapData';
import { useAuth } from '../../context/AuthContext';
import {
  blockZone, checkInSafe,
  subscribeBlockedZones,
  subscribeEmergency,
  subscribeLocations,
  subscribeSafeCheckIns,
  triggerEmergency,
} from '../../services/emergency';
import { initLocation, setSimulatedFloor, startTracking, stopTracking } from '../../services/location';
import { requestNotificationPermissions, sendEmergencyNotification } from '../../services/notifications';

// ─── Emergency Report Modal ───────────────────────────────────────────────────
type ModalStep = 'ask' | 'confirm' | 'triggering';

function EmergencyModal({
  visible, onClose, onTriggerNow, onTriggerWithZone, onSelectZone, userZone
}: {
  visible: boolean;
  onClose: () => void;
  onTriggerNow: () => Promise<void>;
  onTriggerWithZone: (zoneId: string, zoneLabel: string) => Promise<void>;
  onSelectZone: () => void;
  userZone?: { id: string; label: string } | null;
}) {
  const [step, setStep] = useState<ModalStep>('ask');
  const [selectedZ, setSelectedZ] = useState<{id: string, label: string}|null>(null);

  useEffect(() => { if (visible) { setStep('ask'); setSelectedZ(null); } }, [visible]);

  const handleTrigger = async () => {
    setStep('triggering');
    if (selectedZ) await onTriggerWithZone(selectedZ.id, selectedZ.label);
    else await onTriggerNow();
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={m.backdrop} onPress={step === 'ask' ? onClose : undefined}>
        <Pressable style={m.sheet} onPress={() => {}}>
          <View style={m.handle} />

          {step === 'ask' && (
            <>
              <View style={m.iconWrap}>
                <Ionicons name="warning" size={28} color="#ef4444" />
              </View>
              <Text style={m.title}>Report Emergency</Text>
              <Text style={m.body}>This will alert all staff and activate evacuation routing immediately.</Text>
              <Text style={m.question}>Mark a hazardous zone on the map first?</Text>

              {userZone && (
                <TouchableOpacity style={m.optionBtn} onPress={() => { setSelectedZ(userZone); setStep('confirm'); }}>
                  <View style={[m.optionIcon, { backgroundColor: '#450a0a' }]}>
                    <Ionicons name="location-outline" size={18} color="#ef4444" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={m.optionTitle}>Fire is in {userZone.label}</Text>
                    <Text style={m.optionSub}>Block this room and trigger alarm</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="#475569" />
                </TouchableOpacity>
              )}

              <TouchableOpacity style={m.optionBtn} onPress={onSelectZone}>
                <View style={m.optionIcon}>
                  <Ionicons name="map-outline" size={18} color="#38bdf8" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={m.optionTitle}>Select Zone on Map</Text>
                  <Text style={m.optionSub}>Tap a room to mark it — routing avoids that area</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#475569" />
              </TouchableOpacity>

              <TouchableOpacity style={m.optionBtn} onPress={() => setStep('confirm')}>
                <View style={[m.optionIcon, { backgroundColor: '#450a0a' }]}>
                  <Ionicons name="flash-outline" size={18} color="#ef4444" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={m.optionTitle}>Trigger Immediately</Text>
                  <Text style={m.optionSub}>Alert all staff now without specifying a zone</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#475569" />
              </TouchableOpacity>

              <TouchableOpacity style={m.cancelBtn} onPress={onClose}>
                <Text style={m.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </>
          )}

          {step === 'confirm' && (
            <>
              <View style={[m.iconWrap, { backgroundColor: '#450a0a' }]}>
                <Ionicons name="flame" size={28} color="#ef4444" />
              </View>
              <Text style={m.title}>Confirm Emergency</Text>
              <Text style={m.body}>
                {selectedZ
                  ? `This will block ${selectedZ.label}, alert all staff, and activate evacuation mode.`
                  : 'This will immediately alert every staff member and activate evacuation mode.'}
              </Text>
              <TouchableOpacity style={m.triggerBtn} onPress={handleTrigger}>
                <Ionicons name="warning" size={16} color="#fff" />
                <Text style={m.triggerText}>  TRIGGER EMERGENCY NOW</Text>
              </TouchableOpacity>
              <TouchableOpacity style={m.cancelBtn} onPress={() => setStep('ask')}>
                <Text style={m.cancelText}>← Go back</Text>
              </TouchableOpacity>
            </>
          )}

          {step === 'triggering' && (
            <>
              <ActivityIndicator size="large" color="#ef4444" style={{ marginBottom: 16 }} />
              <Text style={m.title}>Activating…</Text>
              <Text style={m.body}>Alerting all staff now.</Text>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── StaffHome ────────────────────────────────────────────────────────────────
export default function StaffHome() {
  const { user }  = useAuth();
  const insets    = useSafeAreaInsets();

  const [emergency,    setEmergency]    = useState<any>({ active: false });
  const [blockedZones, setBlockedZones] = useState<any[]>([]);
  const [safeCheckIns, setSafeCheckIns] = useState<any[]>([]);
  const [allLocations, setAllLocations] = useState<Record<string, any>>({});
  const [userPos,      setUserPos]      = useState<{ svgX: number; svgY: number } | null>(null);
  const [currentFloor, setCurrentFloor] = useState<FloorId>('main');
  const [locating,     setLocating]     = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [isSelectingZone, setIsSelectingZone] = useState(false);
  const [checkedIn,    setCheckedIn]    = useState(false);
  const [checkingIn,   setCheckingIn]   = useState(false);

  const posRef = useRef<{ svgX: number; svgY: number } | null>(null);
  const blockedIds = blockedZones.map(z => z.zoneId);

  useEffect(() => {
    requestNotificationPermissions();
    
    let wasActive = false;
    const unsubE = subscribeEmergency((data) => {
      if (data.active && !wasActive) {
        sendEmergencyNotification('🔥 FIRE ALERT', 'Emergency active! Evacuate immediately.');
        activateKeepAwakeAsync();
      } else if (!data.active && wasActive) {
        deactivateKeepAwake();
      }
      wasActive = data.active;
      setEmergency(data);
    });
    const unsubZ = subscribeBlockedZones(setBlockedZones);
    const unsubS = subscribeSafeCheckIns(setSafeCheckIns);
    const unsubL = subscribeLocations(setAllLocations);
    return () => { unsubE(); unsubZ(); unsubS(); unsubL(); };
  }, []);

  // Reset check-in when emergency clears
  useEffect(() => {
    if (!emergency.active) setCheckedIn(false);
  }, [emergency.active]);

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
      if (!posRef.current) {
        posRef.current = { svgX: 209, svgY: 379 };
        setUserPos({ svgX: 209, svgY: 379 });
      }
      setLocating(false);
    }, 800);
    return () => { stopTracking(); clearTimeout(t); };
  }, [user?.uid]);

  // Stat counts
  const nearbyCount = Object.values(allLocations).filter(
    l => l.floor === currentFloor && l.uid !== user?.uid
  ).length;
  const safeCount   = safeCheckIns.length;
  const totalStaff  = Object.keys(allLocations).length;
  const hazardCount = blockedIds.length;

  const floor = FLOORS[currentFloor];

  // Auto-detect which room the user is currently standing in
  const userZone = userPos ? (() => {
    for (const shape of floor.shapes) {
      let inside = false;
      for (let i = 0, j = shape.points.length - 1; i < shape.points.length; j = i++) {
        const xi = shape.points[i].x, yi = shape.points[i].y, xj = shape.points[j].x, yj = shape.points[j].y;
        if ((yi > userPos.svgY) !== (yj > userPos.svgY) && userPos.svgX < ((xj - xi) * (userPos.svgY - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside && shape.type === 'room') return { id: shape.id, label: shape.label };
    }
    return null;
  })() : null;

  // Safe check-in
  const handleCheckIn = async () => {
    if (checkedIn || checkingIn) return;
    setCheckingIn(true);
    try {
      await checkInSafe(user?.uid ?? 'unknown', user?.displayName ?? user?.email ?? 'Staff');
      setCheckedIn(true);
    } catch (e) {
      Alert.alert('Error', 'Could not check in. Please try again.');
    } finally {
      setCheckingIn(false);
    }
  };

  const handleZoneTap = useCallback((zoneId: string, zoneLabel: string) => {
    if (!isSelectingZone) return;

    if (blockedIds.includes(zoneId)) {
      if (Platform.OS === 'web') {
        window.alert(`"${zoneLabel}" is already marked as hazardous.`);
        return;
      }
      Alert.alert('Already Reported', `"${zoneLabel}" is already marked as hazardous.`);
      return;
    }

    const confirmMsg = emergency.active
      ? `Mark "${zoneLabel}" as on fire?\n\nEvacuation routes will avoid this area.`
      : `Report fire in "${zoneLabel}" and trigger the building-wide alarm?`;

    if (Platform.OS === 'web') {
      if (window.confirm(confirmMsg)) {
        blockZone(zoneId, zoneLabel, user?.uid ?? 'staff');
        if (!emergency.active) triggerEmergency(user?.uid ?? 'staff', `Fire reported in ${zoneLabel}`);
      }
      return;
    }

    Alert.alert(
      emergency.active ? 'Report Fire Zone' : 'Trigger Emergency?',
      confirmMsg,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: emergency.active ? 'Report Fire Here' : 'Confirm & Trigger',
          style: 'destructive',
          onPress: async () => {
            await blockZone(zoneId, zoneLabel, user?.uid ?? 'staff');
            if (!emergency.active) await triggerEmergency(user?.uid ?? 'staff', `Fire reported in ${zoneLabel}`);
          },
        },
      ]
    );
  }, [blockedIds, user, emergency.active]);

  const handleSelectZone = () => {
    setModalVisible(false);
    setIsSelectingZone(true);
  };

  const toggleFloor = () => {
    const next: FloorId = currentFloor === 'main' ? 'squash' : 'main';
    setCurrentFloor(next);
    setSimulatedFloor(next);
    setUserPos(null);
    posRef.current = null;
  };

  const handleCall911 = () => {
    if (Platform.OS === 'web') {
      if (window.confirm('Dial 911? This will attempt to open your phone or calling app.')) {
        Linking.openURL('tel:911');
      }
      return;
    }
    Alert.alert('Dial 911', 'Are you sure you want to call emergency services?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Call 911', style: 'destructive', onPress: () => Linking.openURL('tel:911') },
    ]);
  };

  return (
    <View style={s.root}>

      {/* ── Fire alert banner ── */}
      {emergency.active && (
        <View style={[s.alertBanner, { paddingTop: insets.top + 4 }]}>
          <Ionicons name="warning" size={14} color="#fff" />
          <Text style={s.alertText}>FIRE ALERT · ACTIVE — EVACUATE NOW</Text>
          <Ionicons name="warning" size={14} color="#fff" />
        </View>
      )}

      {/* ── Header ── */}
      <SafeAreaView edges={emergency.active ? [] : ['top']} style={s.headerWrap}>
        <View style={s.header}>
          <View>
            <Text style={s.headerTitle}>
            {emergency.active ? 'Evacuation Map' : 'Floor Map'}
            </Text>
            <Text style={s.headerSub}>{floor.label}</Text>
          </View>
          <View style={s.headerRight}>
            {/* Floor toggle */}
            <TouchableOpacity style={s.floorBtn} onPress={toggleFloor}>
              <Ionicons name="layers-outline" size={16} color="#94a3b8" />
              <Text style={s.floorBtnText}>
                {currentFloor === 'main' ? 'Squash' : 'Main'}
              </Text>
            </TouchableOpacity>
            {/* Location pill */}
            <View style={s.locPill}>
              {locating
                ? <ActivityIndicator size="small" color="#38bdf8" />
                : <View style={[s.locDot, { backgroundColor: emergency.active ? '#ef4444' : '#22c55e' }]} />}
              <Text style={s.locText}>{locating ? '…' : 'Live'}</Text>
            </View>
          </View>
        </View>
      </SafeAreaView>

      {isSelectingZone && (
        <View style={s.hint}>
          <Ionicons name="finger-print-outline" size={14} color="#38bdf8" />
          <Text style={s.hintText}>
            Tap the hazardous room on the map.
          </Text>
          <TouchableOpacity onPress={() => setIsSelectingZone(false)}>
            <Text style={s.hintCancel}>Done</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Map ── */}
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

      {/* ── Stat pills ── */}
      <View style={s.statsRow}>
        <View style={s.statPill}>
          <Text style={s.statNum}>{nearbyCount}</Text>
          <Text style={s.statLabel}>NEARBY</Text>
          <Text style={s.statSub}>staff</Text>
        </View>
        <View style={[s.statPill, s.statPillGreen]}>
          <Text style={[s.statNum, { color: '#22c55e' }]}>{safeCount}</Text>
          <Text style={s.statLabel}>SAFE</Text>
          <Text style={s.statSub}>/ {totalStaff}</Text>
        </View>
        <View style={[s.statPill, hazardCount > 0 && s.statPillRed]}>
          <Text style={[s.statNum, { color: hazardCount > 0 ? '#ef4444' : '#475569' }]}>{hazardCount}</Text>
          <Text style={s.statLabel}>HAZARDS</Text>
          <Text style={s.statSub}>zone{hazardCount !== 1 ? 's' : ''}</Text>
        </View>
      </View>

      {/* ── Bottom actions ── */}
      <View style={[s.bottomBar, { paddingBottom: insets.bottom + 10 }]}>
        {/* I'M SAFE check-in */}
        <TouchableOpacity
          style={[s.safeBtn, checkedIn && s.safeBtnDone, checkingIn && { opacity: 0.6 }]}
          onPress={handleCheckIn}
          disabled={checkedIn || checkingIn}
        >
          {checkingIn
            ? <ActivityIndicator color="#fff" size="small" />
            : <Ionicons name={checkedIn ? 'checkmark-circle' : 'location'} size={18} color="#fff" />}
          <Text style={s.safeBtnText}>
            {checkedIn ? 'CHECKED IN — SAFE' : "I'M SAFE · CHECK IN"}
          </Text>
        </TouchableOpacity>

        {/* Bottom row: Report Hazard + Call Warden */}
        <View style={s.bottomRow}>
          <TouchableOpacity style={s.secondaryBtn} onPress={() => setModalVisible(true)}>
            <Ionicons
              name="warning-outline"
              size={16}
              color="#94a3b8"
            />
            <Text style={s.secondaryBtnText}>
              Report Hazard
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.secondaryBtn} onPress={handleCall911}>
            <Ionicons name="call" size={16} color="#ef4444" />
            <Text style={[s.secondaryBtnText, { color: '#ef4444' }]}>Call 911</Text>
          </TouchableOpacity>
        </View>
      </View>

      <EmergencyModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        userZone={userZone}
        onTriggerWithZone={async (zid, zlabel) => {
          await blockZone(zid, zlabel, user?.uid ?? 'staff');
          await triggerEmergency(user?.uid ?? 'staff', `Fire reported in ${zlabel}`);
        }}
        onTriggerNow={async () => {
          await triggerEmergency(user?.uid ?? 'staff', 'Manual trigger from staff — no zone specified');
        }}
        onSelectZone={handleSelectZone}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:            { flex: 1, backgroundColor: '#0f172a' },

  alertBanner:     { backgroundColor: '#7f1d1d', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#ef4444' },
  alertText:       { color: '#fca5a5', fontWeight: '700', fontSize: 11, letterSpacing: 1.5 },

  headerWrap:      { backgroundColor: '#0f172a' },
  header:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  headerTitle:     { fontSize: 16, fontWeight: '700', color: '#f1f5f9' },
  headerSub:       { fontSize: 11, color: '#475569', marginTop: 1 },
  headerRight:     { flexDirection: 'row', alignItems: 'center', gap: 8 },

  floorBtn:        { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#1e293b', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#334155' },
  floorBtnText:    { color: '#94a3b8', fontSize: 12, fontWeight: '600' },

  locPill:         { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#1e293b', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#334155' },
  locDot:          { width: 6, height: 6, borderRadius: 3 },
  locText:         { color: '#94a3b8', fontSize: 12, fontWeight: '600' },

  hint:            { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#0c1929', paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1e3a5f' },
  hintText:        { color: '#94a3b8', fontSize: 12, flex: 1 },
  hintCancel:      { color: '#ef4444', fontSize: 12, fontWeight: '700' },

  mapWrap:         { flex: 1, overflow: 'hidden' },

  statsRow:        { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10, gap: 10, backgroundColor: '#0f172a', borderTopWidth: 1, borderTopColor: '#1e293b' },
  statPill:        { flex: 1, backgroundColor: '#1e293b', borderRadius: 12, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: '#334155' },
  statPillGreen:   { borderColor: '#14532d' },
  statPillRed:     { borderColor: '#7f1d1d', backgroundColor: '#1a0505' },
  statNum:         { fontSize: 22, fontWeight: '800', color: '#f1f5f9' },
  statLabel:       { fontSize: 9, fontWeight: '700', color: '#475569', letterSpacing: 1.2, marginTop: 1 },
  statSub:         { fontSize: 10, color: '#334155', marginTop: 1 },

  bottomBar:       { backgroundColor: '#0f172a', paddingHorizontal: 16, paddingTop: 10, gap: 8, borderTopWidth: 1, borderTopColor: '#1e293b' },

  safeBtn:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#16a34a', paddingVertical: 16, borderRadius: 14 },
  safeBtnDone:     { backgroundColor: '#14532d' },
  safeBtnText:     { color: '#fff', fontWeight: '700', fontSize: 15, letterSpacing: 0.5 },

  bottomRow:       { flexDirection: 'row', gap: 8 },
  secondaryBtn:    { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#1e293b', paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: '#334155' },
  secondaryBtnText:{ color: '#94a3b8', fontSize: 13, fontWeight: '600' },
});

// ─── Modal styles ─────────────────────────────────────────────────────────────
const m = StyleSheet.create({
  backdrop:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet:        { backgroundColor: '#1e293b', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 36, borderWidth: 1, borderColor: '#334155' },
  handle:       { width: 36, height: 4, borderRadius: 2, backgroundColor: '#334155', alignSelf: 'center', marginBottom: 20 },
  iconWrap:     { width: 56, height: 56, borderRadius: 16, backgroundColor: '#450a0a', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 14 },
  title:        { fontSize: 18, fontWeight: '700', color: '#f1f5f9', textAlign: 'center', marginBottom: 8 },
  body:         { fontSize: 13, color: '#64748b', textAlign: 'center', lineHeight: 19 },
  question:     { fontSize: 13, fontWeight: '600', color: '#94a3b8', textAlign: 'center', marginTop: 14, marginBottom: 12 },
  optionBtn:    { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, borderRadius: 13, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f172a', marginBottom: 8 },
  optionIcon:   { width: 38, height: 38, borderRadius: 11, backgroundColor: '#1e3a5f', alignItems: 'center', justifyContent: 'center' },
  optionTitle:  { fontSize: 14, fontWeight: '700', color: '#f1f5f9' },
  optionSub:    { fontSize: 12, color: '#475569', marginTop: 2, lineHeight: 16 },
  triggerBtn:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#ef4444', paddingVertical: 15, borderRadius: 13, marginTop: 16 },
  triggerText:  { color: '#fff', fontWeight: '700', fontSize: 14, letterSpacing: 0.5 },
  cancelBtn:    { alignItems: 'center', paddingVertical: 14, marginTop: 4 },
  cancelText:   { color: '#64748b', fontWeight: '500', fontSize: 14 },
});