/**
 * app/(admin)/home.tsx — Admin Dashboard (dark theme)
 */

import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { collection, onSnapshot } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert, Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../../context/AuthContext';
import { createStaffAccount, deactivateStaff, logout, reactivateStaff } from '../../services/auth';
import {
  clearEmergency,
  subscribeBlockedZones,
  subscribeEmergency,
  subscribeLocations,
  triggerEmergency,
  unblockZone
} from '../../services/emergency';
import { db } from '../../services/firebase';

const fmt = (ts: any) => {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

// ─── Add Staff Modal ──────────────────────────────────────────────────────────
function AddStaffModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [name,     setName]     = useState('');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  const reset = () => { setName(''); setEmail(''); setPassword(''); setError(''); };

  const handleCreate = async () => {
    if (!name || !email || !password) { setError('All fields are required.'); return; }
    setLoading(true);
    try {
      await createStaffAccount(email, password, name, 'staff');
      reset();
      onClose();
    } catch (e: any) {
      setError(e.message ?? 'Failed to create account.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={ms.backdrop} onPress={onClose}>
        <Pressable style={ms.sheet} onPress={() => {}}>
          <View style={ms.handle} />
          <Text style={ms.title}>Add Staff Account</Text>

          {!!error && (
            <View style={ms.errorBanner}>
              <Ionicons name="alert-circle-outline" size={14} color="#ef4444" />
              <Text style={ms.errorText}>{error}</Text>
            </View>
          )}

          <Text style={ms.label}>FULL NAME</Text>
          <View style={ms.inputWrap}>
            <Ionicons name="person-outline" size={15} color="#64748b" style={ms.inputIcon} />
            <TextInput style={ms.input} placeholder="Jane Smith" placeholderTextColor="#475569"
              value={name} onChangeText={v => { setName(v); setError(''); }} />
          </View>

          <Text style={ms.label}>EMAIL</Text>
          <View style={ms.inputWrap}>
            <Ionicons name="mail-outline" size={15} color="#64748b" style={ms.inputIcon} />
            <TextInput style={ms.input} placeholder="jane@org.com" placeholderTextColor="#475569"
              value={email} onChangeText={v => { setEmail(v); setError(''); }}
              autoCapitalize="none" keyboardType="email-address" />
          </View>

          <Text style={ms.label}>TEMPORARY PASSWORD</Text>
          <View style={ms.inputWrap}>
            <Ionicons name="lock-closed-outline" size={15} color="#64748b" style={ms.inputIcon} />
            <TextInput style={ms.input} placeholder="••••••••" placeholderTextColor="#475569"
              value={password} onChangeText={v => { setPassword(v); setError(''); }} secureTextEntry />
          </View>

          <View style={ms.btns}>
            <TouchableOpacity style={ms.cancelBtn} onPress={() => { reset(); onClose(); }}>
              <Text style={ms.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[ms.createBtn, loading && { opacity: 0.6 }]} onPress={handleCreate} disabled={loading}>
              {loading
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={ms.createText}>Create Account</Text>}
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Emergency Modal (same pattern as staff/home) ─────────────────────────────
type EStep = 'ask' | 'confirm' | 'triggering';

function EmergencyModal({
  visible, onClose, onTriggerNow, onGoToMap,
}: {
  visible: boolean;
  onClose: () => void;
  onTriggerNow: () => Promise<void>;
  onGoToMap: () => void;
}) {
  const [step, setStep] = useState<EStep>('ask');
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

// ─── Admin Dashboard ──────────────────────────────────────────────────────────
export default function AdminHome() {
  const { user } = useAuth();
  const insets   = useSafeAreaInsets();

  const [emergency,     setEmergency]     = useState<any>({ active: false });
  const [staff,         setStaff]         = useState<any[]>([]);
  const [blockedZones,  setBlockedZones]  = useState<any[]>([]);
  const [locations,     setLocations]     = useState<Record<string, any>>({});
  const [showAddStaff,  setShowAddStaff]  = useState(false);
  const [showEmergency, setShowEmergency] = useState(false);
  const [tab,           setTab]           = useState<'overview' | 'staff' | 'zones'>('overview');

  useEffect(() => {
    const unsubE = subscribeEmergency(setEmergency);
    const unsubZ = subscribeBlockedZones(setBlockedZones);
    const unsubL = subscribeLocations(setLocations);
    const unsubS = onSnapshot(collection(db, 'users'), snap =>
      setStaff(snap.docs.map(d => d.data()).filter((u: any) => u?.role === 'staff' && u?.uid))
    );
    return () => { unsubE(); unsubZ(); unsubL(); unsubS(); };
  }, []);

  const activeStaff  = staff.filter(s => s?.active);
  const trackedStaff = activeStaff.filter(s => locations[s.uid]);

  const handleClear = () =>
    Alert.alert('Mark All Clear?', 'This will end the emergency for all staff.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'All Clear', onPress: clearEmergency },
    ]);

  const handleDeactivate = (m: any) =>
    Alert.alert('Deactivate', `Remove ${m.name}'s access?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Deactivate', style: 'destructive', onPress: () => deactivateStaff(m.uid) },
    ]);

  const lastSeen = (uid: string) => {
    const loc = locations[uid];
    if (!loc) return 'no signal';
    const secs = Math.round((Date.now() - loc.updatedAt) / 1000);
    if (secs < 10)  return 'just now';
    if (secs < 60)  return `${secs}s ago`;
    return `${Math.round(secs / 60)}m ago`;
  };

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + 6 }]}>
        <View>
          <Text style={s.headerTitle}>Admin Dashboard</Text>
          <Text style={s.headerSub}>Evacuation Control</Text>
        </View>
        <TouchableOpacity style={s.signOutBtn} onPress={logout}>
          <Ionicons name="log-out-outline" size={18} color="#64748b" />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.scrollContent, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Emergency status card */}
        <View style={[s.statusCard, emergency.active ? s.cardActive : s.cardClear]}>
          <View style={[s.statusIconWrap, emergency.active ? s.iconWrapRed : s.iconWrapGreen]}>
            <Ionicons
              name={emergency.active ? 'flame' : 'checkmark-circle'}
              size={24}
              color={emergency.active ? '#ef4444' : '#22c55e'}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.statusTitle, emergency.active && { color: '#ef4444' }]}>
              {emergency.active ? 'EMERGENCY ACTIVE' : 'All Clear'}
            </Text>
            <Text style={s.statusSub}>
              {emergency.active
                ? `Active since ${fmt(emergency.triggeredAt)}`
                : 'No emergency in progress'}
            </Text>
          </View>
        </View>

        {/* Emergency action button */}
        <TouchableOpacity
          style={[s.emergencyBtn, emergency.active ? s.btnClear : s.btnTrigger]}
          onPress={emergency.active ? handleClear : () => setShowEmergency(true)}
        >
          <Ionicons
            name={emergency.active ? 'checkmark-circle-outline' : 'warning-outline'}
            size={18} color="#fff"
          />
          <Text style={s.emergencyBtnText}>
            {emergency.active ? 'MARK ALL CLEAR' : 'TRIGGER EMERGENCY'}
          </Text>
        </TouchableOpacity>

        {/* Stats row */}
        <View style={s.statsRow}>
          {[
            { num: activeStaff.length,  label: 'STAFF',    color: '#38bdf8' },
            { num: trackedStaff.length, label: 'TRACKED',  color: trackedStaff.length > 0 ? '#22c55e' : '#475569' },
            { num: blockedZones.length, label: 'HAZARDS',  color: blockedZones.length > 0 ? '#ef4444' : '#475569' },
          ].map((st, i) => (
            <View key={i} style={s.statCard}>
              <Text style={[s.statNum, { color: st.color }]}>{st.num}</Text>
              <Text style={s.statLabel}>{st.label}</Text>
            </View>
          ))}
        </View>

        {/* Tabs */}
        <View style={s.tabs}>
          {(['overview', 'staff', 'zones'] as const).map(k => (
            <TouchableOpacity
              key={k}
              style={[s.tabBtn, tab === k && s.tabBtnActive]}
              onPress={() => setTab(k)}
            >
              <Text style={[s.tabText, tab === k && s.tabTextActive]}>
                {k === 'overview' ? 'Overview' : k === 'staff' ? 'Staff' : 'Zones'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Overview tab ── */}
        {tab === 'overview' && (
          <>
            <Text style={s.sectionTitle}>Quick Actions</Text>
            <View style={s.actionGrid}>
              {[
                { icon: 'person-add-outline', label: 'Add Staff',     onPress: () => setShowAddStaff(true), color: '#38bdf8' },
                { icon: 'people-outline',     label: 'Staff List',    onPress: () => setTab('staff'),       color: '#818cf8' },
                { icon: 'ban-outline',        label: 'Blocked Zones', onPress: () => setTab('zones'),       color: '#ef4444' },
                { icon: 'map-outline',        label: 'View Map',      onPress: () => router.push('/(admin)/map'), color: '#22c55e' },
              ].map((a, i) => (
                <TouchableOpacity key={i} style={s.actionBtn} onPress={a.onPress}>
                  <View style={[s.actionIconBox, { backgroundColor: a.color + '20' }]}>
                    <Ionicons name={a.icon as any} size={20} color={a.color} />
                  </View>
                  <Text style={s.actionLabel}>{a.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {blockedZones.length > 0 && (
              <>
                <Text style={s.sectionTitle}>Hazardous Zones</Text>
                {blockedZones.map(z => (
                  <View key={z.zoneId} style={s.zoneRow}>
                    <Ionicons name="flame" size={18} color="#ef4444" />
                    <View style={{ flex: 1 }}>
                      <Text style={s.zoneName}>{z.zoneLabel}</Text>
                      <Text style={s.zoneMeta}>Blocked {fmt(z.blockedAt)}</Text>
                    </View>
                    <TouchableOpacity style={s.unblockBtn} onPress={() => unblockZone(z.zoneId)}>
                      <Text style={s.unblockText}>Unblock</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </>
            )}
          </>
        )}

        {/* ── Staff tab ── */}
        {tab === 'staff' && (
          <>
            <TouchableOpacity style={s.addBtn} onPress={() => setShowAddStaff(true)}>
              <Ionicons name="add-circle-outline" size={17} color="#38bdf8" />
              <Text style={s.addBtnText}>Add Staff Account</Text>
            </TouchableOpacity>

            <Text style={s.sectionTitle}>Active ({activeStaff.length})</Text>
            {activeStaff.length === 0
              ? <Text style={s.empty}>No active staff members</Text>
              : activeStaff.map(m => (
                <View key={m.uid} style={s.staffRow}>
                  <View style={[s.statusDot, { backgroundColor: locations[m.uid] ? '#22c55e' : '#334155' }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.staffName}>{m.name}</Text>
                    <Text style={s.staffMeta}>{m.email} · {lastSeen(m.uid)}</Text>
                  </View>
                  <TouchableOpacity style={s.deactivateBtn} onPress={() => handleDeactivate(m)}>
                    <Text style={s.deactivateText}>Remove</Text>
                  </TouchableOpacity>
                </View>
              ))}

            <Text style={s.sectionTitle}>Inactive ({staff.filter(m => !m?.active).length})</Text>
            {staff.filter(m => !m?.active).length === 0
              ? <Text style={s.empty}>None</Text>
              : staff.filter(m => !m?.active).map(m => (
                <View key={m.uid} style={s.staffRow}>
                  <View style={[s.statusDot, { backgroundColor: '#1e293b' }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.staffName, { color: '#475569' }]}>{m.name}</Text>
                    <Text style={s.staffMeta}>{m.email}</Text>
                  </View>
                  <TouchableOpacity style={s.reactivateBtn} onPress={() => reactivateStaff(m.uid)}>
                    <Text style={s.reactivateText}>Restore</Text>
                  </TouchableOpacity>
                </View>
              ))}
          </>
        )}

        {/* ── Zones tab ── */}
        {tab === 'zones' && (
          <>
            <View style={s.hintCard}>
              <Ionicons name="information-circle-outline" size={16} color="#38bdf8" />
              <Text style={s.hintText}>
                To block a zone, go to the Map tab, tap "Report Zone", then tap the area on the map.
              </Text>
            </View>
            {blockedZones.length === 0
              ? <Text style={s.empty}>No zones currently blocked</Text>
              : blockedZones.map(z => (
                <View key={z.zoneId} style={s.zoneRow}>
                  <Ionicons name="flame" size={18} color="#ef4444" />
                  <View style={{ flex: 1 }}>
                    <Text style={s.zoneName}>{z.zoneLabel}</Text>
                    <Text style={s.zoneMeta}>Blocked {fmt(z.blockedAt)}</Text>
                  </View>
                  <TouchableOpacity style={s.unblockBtn} onPress={() => unblockZone(z.zoneId)}>
                    <Text style={s.unblockText}>Unblock</Text>
                  </TouchableOpacity>
                </View>
              ))}
          </>
        )}
      </ScrollView>

      <AddStaffModal visible={showAddStaff} onClose={() => setShowAddStaff(false)} />
      <EmergencyModal
        visible={showEmergency}
        onClose={() => setShowEmergency(false)}
        onTriggerNow={async () => { await triggerEmergency(user!.uid, 'Manual trigger from admin'); }}
        onGoToMap={() => { setShowEmergency(false); router.push({ pathname: '/(admin)/map', params: { selectZoneMode: '1' } }); }}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:           { flex: 1, backgroundColor: '#0f172a' },
  header:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: 20, paddingBottom: 14, backgroundColor: '#0f172a', borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  headerTitle:    { fontSize: 20, fontWeight: '800', color: '#f1f5f9', letterSpacing: 0.3 },
  headerSub:      { fontSize: 12, color: '#475569', marginTop: 2, letterSpacing: 0.5 },
  signOutBtn:     { width: 36, height: 36, borderRadius: 10, backgroundColor: '#1e293b', alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  scroll:         { flex: 1 },
  scrollContent:  { padding: 16, gap: 12 },

  statusCard:     { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 16, borderWidth: 1, gap: 12 },
  cardActive:     { backgroundColor: '#1a0505', borderColor: '#7f1d1d' },
  cardClear:      { backgroundColor: '#052e16', borderColor: '#14532d' },
  statusIconWrap: { width: 46, height: 46, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  iconWrapRed:    { backgroundColor: '#450a0a' },
  iconWrapGreen:  { backgroundColor: '#052e16' },
  statusTitle:    { fontSize: 14, fontWeight: '700', color: '#f1f5f9' },
  statusSub:      { fontSize: 12, color: '#64748b', marginTop: 2 },

  emergencyBtn:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15, borderRadius: 14 },
  btnTrigger:     { backgroundColor: '#ef4444' },
  btnClear:       { backgroundColor: '#16a34a' },
  emergencyBtnText: { color: '#fff', fontWeight: '700', fontSize: 14, letterSpacing: 0.8 },

  statsRow:       { flexDirection: 'row', gap: 10 },
  statCard:       { flex: 1, backgroundColor: '#1e293b', borderRadius: 14, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: '#334155' },
  statNum:        { fontSize: 26, fontWeight: '800' },
  statLabel:      { fontSize: 10, color: '#475569', marginTop: 4, fontWeight: '700', letterSpacing: 1 },

  tabs:           { flexDirection: 'row', backgroundColor: '#1e293b', borderRadius: 12, padding: 4, gap: 4, borderWidth: 1, borderColor: '#334155' },
  tabBtn:         { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 9 },
  tabBtnActive:   { backgroundColor: '#0f172a' },
  tabText:        { color: '#475569', fontSize: 13, fontWeight: '600' },
  tabTextActive:  { color: '#f1f5f9', fontWeight: '700' },

  sectionTitle:   { fontSize: 10, fontWeight: '700', color: '#475569', textTransform: 'uppercase', letterSpacing: 1.5, marginTop: 4 },
  empty:          { color: '#334155', fontSize: 14, textAlign: 'center', marginTop: 8, paddingVertical: 16 },

  actionGrid:     { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  actionBtn:      { width: '47%', backgroundColor: '#1e293b', borderRadius: 14, padding: 14, gap: 10, borderWidth: 1, borderColor: '#334155' },
  actionIconBox:  { width: 40, height: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  actionLabel:    { color: '#cbd5e1', fontSize: 13, fontWeight: '600' },

  staffRow:       { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1e293b', borderRadius: 12, padding: 13, gap: 10, borderWidth: 1, borderColor: '#334155' },
  statusDot:      { width: 8, height: 8, borderRadius: 4 },
  staffName:      { color: '#f1f5f9', fontWeight: '600', fontSize: 14 },
  staffMeta:      { color: '#475569', fontSize: 12, marginTop: 2 },
  deactivateBtn:  { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: '#1a0505', borderWidth: 1, borderColor: '#7f1d1d' },
  deactivateText: { color: '#ef4444', fontSize: 12, fontWeight: '600' },
  reactivateBtn:  { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: '#052e16', borderWidth: 1, borderColor: '#14532d' },
  reactivateText: { color: '#22c55e', fontSize: 12, fontWeight: '600' },

  zoneRow:        { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a0505', borderRadius: 12, padding: 13, gap: 10, borderWidth: 1, borderColor: '#7f1d1d' },
  zoneName:       { color: '#fca5a5', fontWeight: '600', fontSize: 14 },
  zoneMeta:       { color: '#64748b', fontSize: 12, marginTop: 2 },
  unblockBtn:     { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155' },
  unblockText:    { color: '#94a3b8', fontSize: 12, fontWeight: '600' },

  addBtn:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderWidth: 1, borderColor: '#38bdf830', borderRadius: 12, padding: 14, backgroundColor: '#0c1929' },
  addBtnText:     { color: '#38bdf8', fontWeight: '700', fontSize: 14 },

  hintCard:       { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: '#0c1929', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#1e3a5f' },
  hintText:       { color: '#94a3b8', fontSize: 13, flex: 1, lineHeight: 18 },
});

const ms = StyleSheet.create({
  backdrop:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet:       { backgroundColor: '#1e293b', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 36, borderWidth: 1, borderColor: '#334155' },
  handle:      { width: 36, height: 4, borderRadius: 2, backgroundColor: '#334155', alignSelf: 'center', marginBottom: 20 },
  iconWrap:    { width: 56, height: 56, borderRadius: 16, backgroundColor: '#450a0a', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 14 },
  title:       { fontSize: 18, fontWeight: '700', color: '#f1f5f9', textAlign: 'center', marginBottom: 8 },
  body:        { fontSize: 13, color: '#64748b', textAlign: 'center', lineHeight: 19, marginBottom: 4 },
  question:    { fontSize: 13, fontWeight: '600', color: '#94a3b8', textAlign: 'center', marginTop: 14, marginBottom: 12 },
  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#450a0a', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#7f1d1d', marginBottom: 6 },
  errorText:   { color: '#fca5a5', fontSize: 13, flex: 1 },
  label:       { fontSize: 10, fontWeight: '700', color: '#475569', letterSpacing: 1.5, marginBottom: 6, marginTop: 10 },
  inputWrap:   { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0f172a', borderRadius: 11, borderWidth: 1, borderColor: '#334155', paddingHorizontal: 12 },
  inputIcon:   { marginRight: 8 },
  input:       { color: '#f1f5f9', fontSize: 14, paddingVertical: 13, flex: 1 },
  btns:        { flexDirection: 'row', gap: 10, marginTop: 16 },
  cancelBtn:   { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: '#0f172a', borderWidth: 1, borderColor: '#334155' },
  cancelBtn2:  { alignItems: 'center', paddingVertical: 14, marginTop: 6 },
  cancelText:  { color: '#64748b', fontWeight: '500', fontSize: 14 },
  createBtn:   { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: '#2563eb' },
  createText:  { color: '#fff', fontWeight: '700', fontSize: 14 },
  optionBtn:   { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, borderRadius: 13, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f172a', marginBottom: 8 },
  optionIcon:  { width: 38, height: 38, borderRadius: 11, backgroundColor: '#1e3a5f', alignItems: 'center', justifyContent: 'center' },
  optionTitle: { fontSize: 14, fontWeight: '700', color: '#f1f5f9' },
  optionSub:   { fontSize: 12, color: '#475569', marginTop: 2, lineHeight: 16 },
  triggerBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#ef4444', paddingVertical: 15, borderRadius: 13, marginTop: 16 },
  triggerText: { color: '#fff', fontWeight: '700', fontSize: 14, letterSpacing: 0.5 },
});