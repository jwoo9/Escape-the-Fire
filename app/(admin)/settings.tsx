import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { collection, onSnapshot } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { Alert, Linking, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../context/AuthContext';
import { logout } from '../../services/auth';
import {
  clearEmergency,
  subscribeBlockedZones,
  subscribeEmergency,
  subscribeLocations,
  unblockZone,
} from '../../services/emergency';
import { db } from '../../services/firebase';

export default function AdminSettings() {
  const { user } = useAuth();
  const [emergency,    setEmergency]    = useState<any>({ active: false });
  const [blockedZones, setBlockedZones] = useState<any[]>([]);
  const [locations,    setLocations]    = useState<Record<string, any>>({});
  const [staffCount,   setStaffCount]   = useState(0);

  useEffect(() => {
    const unsubE = subscribeEmergency(setEmergency);
    const unsubZ = subscribeBlockedZones(setBlockedZones);
    const unsubL = subscribeLocations(setLocations);
    const unsubS = onSnapshot(collection(db, 'users'), snap =>
      setStaffCount(snap.docs.filter(d => d.data()?.role === 'staff' && d.data()?.active).length)
    );
    return () => { unsubE(); unsubZ(); unsubL(); unsubS(); };
  }, []);

  const trackedCount = Object.keys(locations).length;

  const handleLogout = () => {
    if (Platform.OS === 'web') {
      if (window.confirm('Sign Out? You will be signed out of the admin panel.')) {
        logout();
      }
      return;
    }
    Alert.alert('Sign Out', 'You will be signed out of the admin panel.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: logout },
    ]);
  };

  const handleClearEmergency = () => {
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
  };

  const handleUnblockAll = () =>
    Alert.alert('Unblock All Zones?', `Remove all ${blockedZones.length} blocked zone(s)?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Unblock All', style: 'destructive', onPress: () => blockedZones.forEach(z => unblockZone(z.zoneId)) },
    ]);

  const handleExportLog = async () => {
    const rows = [];
    rows.push(['Escape the Fire - Incident Log']);
    rows.push(['Generated At', new Date().toLocaleString()]);
    rows.push([]);
    rows.push(['--- SYSTEM STATUS ---']);
    rows.push(['Emergency Active', emergency.active ? 'YES' : 'NO']);
    if (emergency.active) {
      rows.push(['Triggered At', emergency.triggeredAt?.toDate ? emergency.triggeredAt.toDate().toLocaleString() : 'Unknown']);
    }
    rows.push([]);
    rows.push(['--- BLOCKED ZONES ---']);
    rows.push(['Zone ID', 'Zone Name', 'Blocked At']);
    blockedZones.forEach(z => {
      const time = z.blockedAt?.toDate ? z.blockedAt.toDate().toLocaleString() : 'Unknown';
      rows.push([z.zoneId, z.zoneLabel, time]);
    });
    rows.push([]);
    rows.push(['--- LIVE STAFF LOCATIONS ---']);
    rows.push(['UID', 'Floor', 'X (px)', 'Y (px)', 'Last Updated']);
    Object.entries(locations).forEach(([uid, loc]) => {
      const time = loc.updatedAt ? new Date(loc.updatedAt).toLocaleString() : 'Unknown';
      rows.push([uid, loc.floor, Math.round(loc.x_px || 0), Math.round(loc.y_px || 0), time]);
    });

    const csvContent = rows.map(e => e.join(',')).join('\n');
    const filename = `Incident_Log_${new Date().getTime()}.csv`;

    if (Platform.OS === 'web') {
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.click();
    } else {
      try {
        const fileUri = FileSystem.documentDirectory + filename;
        await FileSystem.writeAsStringAsync(fileUri, csvContent, { encoding: FileSystem.EncodingType.UTF8 });
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(fileUri);
        } else {
          Alert.alert('Export Failed', 'Sharing is not available on this device.');
        }
      } catch (error) {
        Alert.alert('Error', 'Failed to export log.');
      }
    }
  };

  const initials = (user?.displayName ?? user?.email ?? 'A')
    .split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2);

  const fmt = (ts: any) => {
    if (!ts) return '—';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

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
            <Text style={s.profileName}>{user?.displayName ?? 'Administrator'}</Text>
            <Text style={s.profileEmail} numberOfLines={1}>{user?.email}</Text>
          </View>
          <View style={[s.roleBadge, { backgroundColor: '#450a0a' }]}>
            <Text style={[s.roleText, { color: '#fca5a5' }]}>ADMIN</Text>
          </View>
        </View>

        {/* Live system status */}
        <Text style={s.sectionLabel}>LIVE SYSTEM STATUS</Text>
        <View style={s.card}>
          <View style={s.row}>
            <View style={s.rowLeft}>
              <View style={[s.dot, { backgroundColor: emergency.active ? '#ef4444' : '#22c55e' }]} />
              <Text style={s.rowLabel}>Emergency</Text>
            </View>
            <Text style={[s.rowValue, { color: emergency.active ? '#ef4444' : '#22c55e' }]}>
              {emergency.active ? `ACTIVE · ${fmt(emergency.triggeredAt)}` : 'All Clear'}
            </Text>
          </View>
          <View style={s.divider} />
          <View style={s.row}>
            <View style={s.rowLeft}>
              <View style={[s.dot, { backgroundColor: '#38bdf8' }]} />
              <Text style={s.rowLabel}>Staff Accounts</Text>
            </View>
            <Text style={s.rowValue}>{staffCount}</Text>
          </View>
          <View style={s.divider} />
          <View style={s.row}>
            <View style={s.rowLeft}>
              <View style={[s.dot, { backgroundColor: trackedCount > 0 ? '#22c55e' : '#334155' }]} />
              <Text style={s.rowLabel}>Currently Tracked</Text>
            </View>
            <Text style={s.rowValue}>{trackedCount}</Text>
          </View>
          <View style={s.divider} />
          <View style={s.row}>
            <View style={s.rowLeft}>
              <Ionicons name="flame-outline" size={13} color={blockedZones.length > 0 ? '#ef4444' : '#475569'} />
              <Text style={s.rowLabel}>Blocked Zones</Text>
            </View>
            <Text style={[s.rowValue, { color: blockedZones.length > 0 ? '#ef4444' : '#475569' }]}>
              {blockedZones.length > 0 ? blockedZones.length : 'None'}
            </Text>
          </View>
        </View>

        {/* Admin quick actions */}
        <Text style={s.sectionLabel}>QUICK ACTIONS</Text>
        <View style={s.card}>
          {emergency.active && (
            <>
              <TouchableOpacity style={s.actionRow} onPress={handleClearEmergency}>
                <View style={[s.actionIcon, { backgroundColor: '#052e16' }]}>
                  <Ionicons name="checkmark-circle-outline" size={18} color="#22c55e" />
                </View>
                <Text style={[s.actionLabel, { color: '#22c55e' }]}>Mark All Clear</Text>
                <Ionicons name="chevron-forward" size={16} color="#334155" />
              </TouchableOpacity>
              <View style={s.divider} />
            </>
          )}
          {blockedZones.length > 0 && (
            <>
              <TouchableOpacity style={s.actionRow} onPress={handleUnblockAll}>
                <View style={[s.actionIcon, { backgroundColor: '#1a0505' }]}>
                  <Ionicons name="ban-outline" size={18} color="#ef4444" />
                </View>
                <Text style={[s.actionLabel, { color: '#ef4444' }]}>Unblock All Zones</Text>
                <Ionicons name="chevron-forward" size={16} color="#334155" />
              </TouchableOpacity>
              <View style={s.divider} />
            </>
          )}
          <TouchableOpacity style={s.actionRow} onPress={handleExportLog}>
            <View style={[s.actionIcon, { backgroundColor: '#1e3a8a' }]}>
              <Ionicons name="download-outline" size={18} color="#60a5fa" />
            </View>
            <Text style={[s.actionLabel, { color: '#60a5fa' }]}>Export Incident Log</Text>
            <Ionicons name="chevron-forward" size={16} color="#334155" />
          </TouchableOpacity>
        </View>

        {/* Blocked zones */}
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
                    <TouchableOpacity onPress={() => unblockZone(z.zoneId)} style={s.unblockBtn}>
                      <Text style={s.unblockText}>Unblock</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Permissions */}
        <Text style={s.sectionLabel}>PERMISSIONS & PRIVACY</Text>
        <View style={s.card}>
          <View style={s.row}>
            <View style={s.rowLeft}>
              <Ionicons name="location-outline" size={14} color="#94a3b8" />
              <Text style={s.rowLabel}>Location Tracking</Text>
            </View>
            <Text style={s.rowValue}>Required for Map</Text>
          </View>
          <View style={s.divider} />
        <TouchableOpacity style={s.row} onPress={() => {
          if (Platform.OS === 'web') {
            window.alert('Please manage permissions directly in your browser settings.');
          } else {
            Linking.openSettings();
          }
        }}>
            <View style={s.rowLeft}>
              <Ionicons name="settings-outline" size={14} color="#94a3b8" />
              <Text style={s.rowLabel}>Manage OS Permissions</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#475569" />
          </TouchableOpacity>
        </View>

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
  avatar:       { width: 48, height: 48, borderRadius: 14, backgroundColor: '#7f1d1d', alignItems: 'center', justifyContent: 'center' },
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
  dot:          { width: 7, height: 7, borderRadius: 3.5 },
  divider:      { height: 1, backgroundColor: '#334155' },

  actionRow:    { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  actionIcon:   { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  actionLabel:  { flex: 1, color: '#94a3b8', fontSize: 14, fontWeight: '600' },
  comingSoon:   { color: '#334155', fontSize: 11, fontWeight: '600' },

  unblockBtn:   { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: '#0f172a', borderWidth: 1, borderColor: '#334155' },
  unblockText:  { color: '#94a3b8', fontSize: 12, fontWeight: '600' },

  logoutBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#1a0505', borderWidth: 1, borderColor: '#7f1d1d', borderRadius: 14, padding: 15, marginTop: 10 },
  logoutText:   { color: '#ef4444', fontWeight: '700', fontSize: 15 },
});