import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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

export default function StaffMapScreen() {
  const { user }   = useAuth();
  const insets     = useSafeAreaInsets();

  const [emergency,    setEmergency]    = useState<any>({ active: false });
  const [blockedZones, setBlockedZones] = useState<any[]>([]);
  const [userPos,      setUserPos]      = useState<{ svgX: number; svgY: number } | null>(null);
  const [currentFloor, setCurrentFloor] = useState<FloorId>('main');
  const [locating,     setLocating]     = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [isSelectingZone, setIsSelectingZone] = useState(false);

  const posRef   = useRef<{ svgX: number; svgY: number } | null>(null);
  const blockedIds = blockedZones.map(z => z.zoneId);

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

  const floor = FLOORS[currentFloor];

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
  }, [blockedIds, user, emergency.active, isSelectingZone]);

  const toggleFloor = () => {
    const next: FloorId = currentFloor === 'main' ? 'squash' : 'main';
    setCurrentFloor(next);
    setSimulatedFloor(next);
    setUserPos(null);
    posRef.current = null;
  };

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

        {!isSelectingZone ? (
          <TouchableOpacity style={[s.reportBtn, s.reportBtnActive]} onPress={() => setModalVisible(true)}>
            <Ionicons name="warning" size={16} color="#ef4444" />
            <Text style={[s.reportBtnText, { color: '#ef4444' }]}>{emergency.active ? 'REPORT HAZARD' : 'TRIGGER EMERGENCY'}</Text>
          </TouchableOpacity>
        ) : (
          <View style={s.hintContainer}>
            <Ionicons name="finger-print" size={15} color="#38bdf8" />
            <Text style={s.hintTextMap}>Tap the hazardous room on the map.</Text>
            <TouchableOpacity onPress={() => setIsSelectingZone(false)}>
              <Text style={[s.hintTextMap, { color: '#ef4444', marginLeft: 10 }]}>Done</Text>
            </TouchableOpacity>
          </View>
        )}
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
        onSelectZone={() => {
          setModalVisible(false);
          setIsSelectingZone(true);
        }}
      />
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