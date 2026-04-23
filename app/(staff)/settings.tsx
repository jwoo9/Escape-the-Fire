import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../context/AuthContext';
import { logout } from '../../services/auth';
import { subscribeBlockedZones, subscribeEmergency } from '../../services/emergency';

export default function StaffSettings() {
  const { user } = useAuth();
  const [emergency,    setEmergency]    = useState<any>({ active: false });
  const [blockedZones, setBlockedZones] = useState<any[]>([]);

  useEffect(() => {
    const unsubE = subscribeEmergency(setEmergency);
    const unsubZ = subscribeBlockedZones(setBlockedZones);
    return () => { unsubE(); unsubZ(); };
  }, []);

  const handleLogout = () =>
    Alert.alert('Sign Out', 'You will be signed out of the evacuation system.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: logout },
    ]);

  const initials = (user?.displayName ?? user?.email ?? '?')
    .split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2);

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Settings</Text>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

        {/* Profile card */}
        <View style={s.profileCard}>
          <View style={s.avatar}>
            <Text style={s.avatarText}>{initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.profileName}>{user?.displayName ?? 'Staff Member'}</Text>
            <Text style={s.profileEmail} numberOfLines={1}>{user?.email}</Text>
          </View>
          <View style={s.roleBadge}>
            <Text style={s.roleText}>STAFF</Text>
          </View>
        </View>

        {/* System status */}
        <Text style={s.sectionLabel}>SYSTEM STATUS</Text>
        <View style={s.card}>
          <View style={s.row}>
            <View style={s.rowLeft}>
              <View style={[s.statusDot, { backgroundColor: emergency.active ? '#ef4444' : '#22c55e' }]} />
              <Text style={s.rowLabel}>Emergency</Text>
            </View>
            <Text style={[s.rowValue, { color: emergency.active ? '#ef4444' : '#22c55e' }]}>
              {emergency.active ? 'ACTIVE' : 'All Clear'}
            </Text>
          </View>
          <View style={s.divider} />
          <View style={s.row}>
            <View style={s.rowLeft}>
              <View style={[s.statusDot, { backgroundColor: '#22c55e' }]} />
              <Text style={s.rowLabel}>Location Tracking</Text>
            </View>
            <Text style={[s.rowValue, { color: '#22c55e' }]}>Active</Text>
          </View>
          <View style={s.divider} />
          <View style={s.row}>
            <View style={s.rowLeft}>
              <Ionicons name="flame-outline" size={14} color={blockedZones.length > 0 ? '#ef4444' : '#475569'} />
              <Text style={s.rowLabel}>Hazardous Zones</Text>
            </View>
            <Text style={[s.rowValue, { color: blockedZones.length > 0 ? '#ef4444' : '#475569' }]}>
              {blockedZones.length > 0 ? `${blockedZones.length} blocked` : 'None'}
            </Text>
          </View>
        </View>

        {/* Blocked zones list */}
        {blockedZones.length > 0 && (
          <>
            <Text style={s.sectionLabel}>HAZARDOUS ZONES</Text>
            <View style={s.card}>
              {blockedZones.map((z, i) => (
                <View key={z.zoneId}>
                  {i > 0 && <View style={s.divider} />}
                  <View style={s.row}>
                    <Ionicons name="flame" size={14} color="#ef4444" />
                    <Text style={[s.rowLabel, { flex: 1, marginLeft: 8 }]}>{z.zoneLabel}</Text>
                    <Text style={s.rowValue}>{z.floor ?? '—'}</Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}

        {/* App info */}
        <Text style={s.sectionLabel}>APP INFO</Text>
        <View style={s.card}>
          <View style={s.row}>
            <Text style={s.rowLabel}>Version</Text>
            <Text style={s.rowValue}>1.0.0</Text>
          </View>
          <View style={s.divider} />
          <View style={s.row}>
            <Text style={s.rowLabel}>Build</Text>
            <Text style={s.rowValue}>Escape the Fire</Text>
          </View>
        </View>

        {/* Sign out */}
        <TouchableOpacity style={s.logoutBtn} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={18} color="#ef4444" />
          <Text style={s.logoutText}>Sign Out</Text>
        </TouchableOpacity>

        <View style={{ height: 16 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: '#0f172a' },
  header:       { paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  headerTitle:  { fontSize: 20, fontWeight: '700', color: '#f1f5f9' },
  scroll:       { flex: 1 },
  content:      { padding: 16, gap: 6 },

  profileCard:  { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#1e293b', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#334155', marginBottom: 10 },
  avatar:       { width: 48, height: 48, borderRadius: 14, backgroundColor: '#2563eb', alignItems: 'center', justifyContent: 'center' },
  avatarText:   { color: '#fff', fontWeight: '800', fontSize: 16 },
  profileName:  { color: '#f1f5f9', fontWeight: '700', fontSize: 15 },
  profileEmail: { color: '#475569', fontSize: 12, marginTop: 2 },
  roleBadge:    { backgroundColor: '#1e3a5f', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  roleText:     { color: '#38bdf8', fontSize: 11, fontWeight: '700', letterSpacing: 1 },

  sectionLabel: { fontSize: 10, fontWeight: '700', color: '#475569', textTransform: 'uppercase', letterSpacing: 1.5, marginTop: 10, marginBottom: 6, marginLeft: 4 },
  card:         { backgroundColor: '#1e293b', borderRadius: 14, paddingHorizontal: 16, borderWidth: 1, borderColor: '#334155' },
  row:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 13 },
  rowLeft:      { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowLabel:     { color: '#94a3b8', fontSize: 14 },
  rowValue:     { color: '#f1f5f9', fontSize: 14, fontWeight: '600' },
  statusDot:    { width: 7, height: 7, borderRadius: 3.5 },
  divider:      { height: 1, backgroundColor: '#334155' },

  logoutBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#1a0505', borderWidth: 1, borderColor: '#7f1d1d', borderRadius: 14, padding: 15, marginTop: 10 },
  logoutText:   { color: '#ef4444', fontWeight: '700', fontSize: 15 },
});