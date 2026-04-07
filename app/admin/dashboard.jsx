/**
 * Admin Dashboard
 * 
 * Admin-only interface providing:
 *   - Emergency activation/deactivation
 *   - View all staff locations on map
 *   - Send announcements to all users
 *   - Manage staff accounts (create, deactivate, reactivate)
 *   - Call emergency services (911 link)
 *   - View reported hazards
 *   - Clear emergency state
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  TextInput,
  Modal,
  Linking,
} from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { logout, createStaffAccount, deactivateStaff, reactivateStaff } from '../../services/auth';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../services/firebase';
import BuildingMap from '../../components/BuildingMap';
import {
  activateEmergency,
  deactivateEmergency,
  onEmergencyStateChange,
  onHazardsChange,
  removeHazard,
  onUserLocationsChange,
  sendAnnouncement,
  onAnnouncementsChange,
  clearAnnouncements,
} from '../../services/emergency';


import mainMapData from '../../mainMapData.json';
import squashMapData from '../../squashMapData.json';

const BUILDINGS = {
  main: { label: 'Main Building', data: mainMapData },
  squash: { label: 'Squash Building', data: squashMapData },
};

export default function AdminDashboard() {
  const { user } = useAuth();
  const [selectedBuilding, setSelectedBuilding] = useState('main');
  const [emergencyActive, setEmergencyActive] = useState(false);
  const [hazards, setHazards] = useState([]);
  const [userLocations, setUserLocations] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [staffList, setStaffList] = useState([]);

  // Modals
  const [showStaffModal, setShowStaffModal] = useState(false);
  const [showAnnouncementModal, setShowAnnouncementModal] = useState(false);
  const [showCreateStaff, setShowCreateStaff] = useState(false);

  // New staff form
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffEmail, setNewStaffEmail] = useState('');
  const [newStaffPassword, setNewStaffPassword] = useState('');
  const [announcementText, setAnnouncementText] = useState('');

  const mapData = BUILDINGS[selectedBuilding].data;

  // Subscribe to real-time data
  useEffect(() => {
    const unsub1 = onEmergencyStateChange(selectedBuilding, (s) => setEmergencyActive(s.active || false));
    const unsub2 = onHazardsChange(selectedBuilding, (h) => setHazards(h));
    const unsub3 = onUserLocationsChange(selectedBuilding, (u) => setUserLocations(u));
    const unsub4 = onAnnouncementsChange(selectedBuilding, (a) => setAnnouncements(a));
    return () => { unsub1(); unsub2(); unsub3(); unsub4(); };
  }, [selectedBuilding]);

  // Load staff list
  const loadStaff = async () => {
    try {
      const snapshot = await getDocs(collection(db, 'users'));
      const users = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      setStaffList(users);
    } catch (e) {
      console.error('Error loading staff:', e);
    }
  };

  useEffect(() => { loadStaff(); }, []);

  const handleActivateEmergency = () => {
    Alert.alert('🚨 Activate Emergency', 'This will alert all staff in the building.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'ACTIVATE', style: 'destructive', onPress: () => activateEmergency(selectedBuilding, user?.email) },
    ]);
  };

  const handleDeactivateEmergency = () => {
    Alert.alert('Deactivate Emergency', 'This will clear the emergency state and all hazard reports.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Deactivate', onPress: () => { deactivateEmergency(selectedBuilding); setHazards([]); } },
    ]);
  };

  const handleSendAnnouncement = async () => {
    if (!announcementText.trim()) return;
    await sendAnnouncement(selectedBuilding, announcementText.trim(), user?.email || 'Admin');
    setAnnouncementText('');
    Alert.alert('Sent', 'Announcement sent to all staff.');
  };

  const handleCreateStaff = async () => {
    if (!newStaffName || !newStaffEmail || !newStaffPassword) {
      Alert.alert('Error', 'Please fill all fields.');
      return;
    }
    try {
      await createStaffAccount(newStaffEmail, newStaffPassword, newStaffName, 'staff');
      Alert.alert('Success', `Staff account created for ${newStaffName}`);
      setNewStaffName(''); setNewStaffEmail(''); setNewStaffPassword('');
      setShowCreateStaff(false);
      loadStaff();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  };

  const safeCount = userLocations.filter((u) => u.safe).length;
  const totalInBuilding = userLocations.length;

  const hazardMarkers = hazards.map((h) => ({ x: h.x, y: h.y, nodeId: h.nodeId, type: h.type }));

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Admin Dashboard</Text>
          <Text style={styles.subtitle}>{user?.email}</Text>
        </View>
        <TouchableOpacity style={styles.signOutBtn} onPress={logout}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Emergency Status Card */}
        <View style={[styles.card, emergencyActive && styles.cardDanger]}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>
              {emergencyActive ? '🚨 Emergency Active' : '✅ No Active Emergency'}
            </Text>
            <View style={[styles.statusDot, { backgroundColor: emergencyActive ? '#da3633' : '#238636' }]} />
          </View>
          {emergencyActive && (
            <View style={styles.statsRow}>
              <View style={styles.stat}>
                <Text style={styles.statNumber}>{totalInBuilding}</Text>
                <Text style={styles.statLabel}>In Building</Text>
              </View>
              <View style={styles.stat}>
                <Text style={[styles.statNumber, { color: '#238636' }]}>{safeCount}</Text>
                <Text style={styles.statLabel}>Safe</Text>
              </View>
              <View style={styles.stat}>
                <Text style={[styles.statNumber, { color: '#da3633' }]}>{totalInBuilding - safeCount}</Text>
                <Text style={styles.statLabel}>Not Safe</Text>
              </View>
              <View style={styles.stat}>
                <Text style={[styles.statNumber, { color: '#9a6700' }]}>{hazards.length}</Text>
                <Text style={styles.statLabel}>Hazards</Text>
              </View>
            </View>
          )}
          <View style={styles.cardActions}>
            {!emergencyActive ? (
              <TouchableOpacity style={styles.dangerBtn} onPress={handleActivateEmergency}>
                <Text style={styles.btnText}>🚨 Activate Emergency</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.resolveBtn} onPress={handleDeactivateEmergency}>
                <Text style={styles.btnText}>✅ Resolve Emergency</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.callBtn} onPress={() => Linking.openURL('tel:911')}>
              <Text style={styles.btnText}>📞 Call 911</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Building Selector */}
        <View style={styles.buildingSelector}>
          {Object.entries(BUILDINGS).map(([key, val]) => (
            <TouchableOpacity
              key={key}
              style={[styles.buildingTab, selectedBuilding === key && styles.buildingTabActive]}
              onPress={() => setSelectedBuilding(key)}
            >
              <Text style={[styles.buildingTabText, selectedBuilding === key && styles.buildingTabTextActive]}>
                {val.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Map with user locations */}
        <View style={styles.mapContainer}>
          <BuildingMap
            mapData={mapData}
            hazards={hazardMarkers}
            otherUsers={userLocations}
            selectedBuilding={selectedBuilding}
            showLabels={true}
          />
        </View>

        {/* Active Hazards */}
        {hazards.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>🔥 Active Hazards</Text>
            {hazards.map((h, i) => (
              <View key={h.id || i} style={styles.hazardRow}>
                <View>
                  <Text style={styles.hazardText}>
                    {h.type === 'fire' ? '🔥' : '💨'} {h.nodeId || 'Unknown location'} ({h.x?.toFixed(1)}m, {h.y?.toFixed(1)}m)
                  </Text>
                  <Text style={styles.hazardMeta}>Reported by: {h.reportedBy}</Text>
                </View>
                <TouchableOpacity
                  style={styles.removeBtn}
                  onPress={() => removeHazard(selectedBuilding, h.id)}
                >
                  <Text style={styles.removeBtnText}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {/* Quick Actions */}
        <View style={styles.actionsGrid}>
          <TouchableOpacity style={styles.actionCard} onPress={() => setShowAnnouncementModal(true)}>
            <Text style={styles.actionIcon}>📢</Text>
            <Text style={styles.actionLabel}>Send Announcement</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionCard} onPress={() => { loadStaff(); setShowStaffModal(true); }}>
            <Text style={styles.actionIcon}>👥</Text>
            <Text style={styles.actionLabel}>Manage Staff</Text>
          </TouchableOpacity>
        </View>

        {/* User Locations List */}
        {userLocations.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>👥 Staff Locations</Text>
            {userLocations.map((u, i) => (
              <View key={u.uid || i} style={styles.userRow}>
                <View style={[styles.userDot, { backgroundColor: u.safe ? '#238636' : '#f39c12' }]} />
                <View>
                  <Text style={styles.userName}>{u.name || u.uid}</Text>
                  <Text style={styles.userMeta}>
                    {u.safe ? '✅ Evacuated safely' : `📍 (${u.x?.toFixed(1)}m, ${u.y?.toFixed(1)}m)`}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Recent Announcements */}
        {announcements.length > 0 && (
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardTitle}>📢 Recent Announcements</Text>
              <TouchableOpacity onPress={() => clearAnnouncements(selectedBuilding)}>
                <Text style={styles.clearText}>Clear All</Text>
              </TouchableOpacity>
            </View>
            {announcements.slice(0, 5).map((a, i) => (
              <View key={a.id || i} style={styles.announcementItem}>
                <Text style={styles.announcementText}>{a.message}</Text>
                <Text style={styles.announcementMeta}>
                  {a.sender} • {new Date(a.sentAt).toLocaleTimeString()}
                </Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Send Announcement Modal */}
      <Modal visible={showAnnouncementModal} animationType="slide" transparent onRequestClose={() => setShowAnnouncementModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>📢 Send Announcement</Text>
            <TextInput
              style={styles.textArea}
              placeholder="Type your announcement..."
              placeholderTextColor="#8b949e"
              value={announcementText}
              onChangeText={setAnnouncementText}
              multiline
              numberOfLines={4}
            />
            <TouchableOpacity style={styles.sendBtn} onPress={handleSendAnnouncement}>
              <Text style={styles.sendBtnText}>Send to All Staff</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalClose} onPress={() => setShowAnnouncementModal(false)}>
              <Text style={styles.modalCloseText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Staff Management Modal */}
      <Modal visible={showStaffModal} animationType="slide" transparent onRequestClose={() => setShowStaffModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '80%' }]}>
            <Text style={styles.modalTitle}>👥 Staff Management</Text>
            <TouchableOpacity
              style={styles.addStaffBtn}
              onPress={() => setShowCreateStaff(!showCreateStaff)}
            >
              <Text style={styles.addStaffBtnText}>
                {showCreateStaff ? '− Cancel' : '+ Add Staff Member'}
              </Text>
            </TouchableOpacity>

            {showCreateStaff && (
              <View style={styles.createStaffForm}>
                <TextInput style={styles.input} placeholder="Name" placeholderTextColor="#8b949e"
                  value={newStaffName} onChangeText={setNewStaffName} />
                <TextInput style={styles.input} placeholder="Email" placeholderTextColor="#8b949e"
                  value={newStaffEmail} onChangeText={setNewStaffEmail} autoCapitalize="none" keyboardType="email-address" />
                <TextInput style={styles.input} placeholder="Password" placeholderTextColor="#8b949e"
                  value={newStaffPassword} onChangeText={setNewStaffPassword} secureTextEntry />
                <TouchableOpacity style={styles.createBtn} onPress={handleCreateStaff}>
                  <Text style={styles.createBtnText}>Create Account</Text>
                </TouchableOpacity>
              </View>
            )}

            <ScrollView style={styles.staffList}>
              {staffList.map((s) => (
                <View key={s.id} style={styles.staffRow}>
                  <View>
                    <Text style={styles.staffName}>{s.name || 'Unnamed'}</Text>
                    <Text style={styles.staffEmail}>{s.email}</Text>
                    <Text style={[styles.staffRole, { color: s.role === 'admin' ? '#58a6ff' : '#8b949e' }]}>
                      {s.role} {!s.active && '(inactive)'}
                    </Text>
                  </View>
                  {s.role !== 'admin' && (
                    <TouchableOpacity
                      style={[styles.toggleBtn, { backgroundColor: s.active ? '#9a6700' : '#238636' }]}
                      onPress={async () => {
                        if (s.active) await deactivateStaff(s.id);
                        else await reactivateStaff(s.id);
                        loadStaff();
                      }}
                    >
                      <Text style={styles.toggleBtnText}>{s.active ? 'Deactivate' : 'Reactivate'}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </ScrollView>

            <TouchableOpacity style={styles.modalClose} onPress={() => setShowStaffModal(false)}>
              <Text style={styles.modalCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d1117' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 54, paddingBottom: 12,
    backgroundColor: '#161b22', borderBottomWidth: 1, borderBottomColor: '#21262d',
  },
  title: { fontSize: 20, fontWeight: 'bold', color: '#f0f6fc' },
  subtitle: { fontSize: 12, color: '#8b949e', marginTop: 2 },
  signOutBtn: {
    paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#21262d',
    borderRadius: 6, borderWidth: 1, borderColor: '#30363d',
  },
  signOutText: { color: '#8b949e', fontSize: 12 },
  scrollView: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 32, gap: 12 },
  card: {
    backgroundColor: '#161b22', borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: '#21262d',
  },
  cardDanger: { borderColor: '#da3633' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  cardTitle: { color: '#f0f6fc', fontSize: 16, fontWeight: 'bold' },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statsRow: { flexDirection: 'row', marginTop: 12, justifyContent: 'space-around' },
  stat: { alignItems: 'center' },
  statNumber: { color: '#f0f6fc', fontSize: 24, fontWeight: 'bold' },
  statLabel: { color: '#8b949e', fontSize: 11, marginTop: 2 },
  cardActions: { flexDirection: 'row', marginTop: 14, gap: 8 },
  dangerBtn: { flex: 1, backgroundColor: '#da3633', paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  resolveBtn: { flex: 1, backgroundColor: '#238636', paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  callBtn: { flex: 1, backgroundColor: '#1f3a5f', paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  btnText: { color: '#fff', fontSize: 13, fontWeight: 'bold' },
  buildingSelector: { flexDirection: 'row', gap: 8 },
  buildingTab: {
    flex: 1, paddingVertical: 8, alignItems: 'center', backgroundColor: '#161b22',
    borderRadius: 8, borderWidth: 1, borderColor: '#21262d',
  },
  buildingTabActive: { backgroundColor: '#1f3a5f', borderColor: '#3498db' },
  buildingTabText: { color: '#8b949e', fontSize: 13, fontWeight: '600' },
  buildingTabTextActive: { color: '#58a6ff' },
  mapContainer: { borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#21262d' },
  hazardRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#21262d',
  },
  hazardText: { color: '#f0f6fc', fontSize: 13 },
  hazardMeta: { color: '#8b949e', fontSize: 11, marginTop: 2 },
  removeBtn: { backgroundColor: '#da3633', width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  removeBtnText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  actionsGrid: { flexDirection: 'row', gap: 8 },
  actionCard: {
    flex: 1, backgroundColor: '#161b22', borderRadius: 12, padding: 16,
    alignItems: 'center', borderWidth: 1, borderColor: '#21262d',
  },
  actionIcon: { fontSize: 24, marginBottom: 6 },
  actionLabel: { color: '#c9d1d9', fontSize: 12, fontWeight: '600', textAlign: 'center' },
  userRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: 10 },
  userDot: { width: 10, height: 10, borderRadius: 5 },
  userName: { color: '#f0f6fc', fontSize: 13, fontWeight: '600' },
  userMeta: { color: '#8b949e', fontSize: 11 },
  clearText: { color: '#da3633', fontSize: 12 },
  announcementItem: { backgroundColor: '#21262d', padding: 10, borderRadius: 6, marginBottom: 6 },
  announcementText: { color: '#f0f6fc', fontSize: 13 },
  announcementMeta: { color: '#8b949e', fontSize: 10, marginTop: 4 },
  // Modals
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#161b22', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20 },
  modalTitle: { color: '#f0f6fc', fontSize: 18, fontWeight: 'bold', marginBottom: 12 },
  textArea: {
    backgroundColor: '#21262d', color: '#f0f6fc', padding: 12, borderRadius: 8,
    fontSize: 14, minHeight: 80, textAlignVertical: 'top', borderWidth: 1, borderColor: '#30363d',
  },
  sendBtn: { backgroundColor: '#238636', paddingVertical: 12, borderRadius: 8, alignItems: 'center', marginTop: 10 },
  sendBtnText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  modalClose: { marginTop: 10, paddingVertical: 10, backgroundColor: '#21262d', borderRadius: 8, alignItems: 'center' },
  modalCloseText: { color: '#c9d1d9', fontSize: 14, fontWeight: '600' },
  addStaffBtn: { backgroundColor: '#238636', paddingVertical: 10, borderRadius: 8, alignItems: 'center', marginBottom: 12 },
  addStaffBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  createStaffForm: { gap: 8, marginBottom: 12, padding: 12, backgroundColor: '#21262d', borderRadius: 8 },
  input: {
    backgroundColor: '#161b22', color: '#f0f6fc', padding: 12, borderRadius: 6,
    fontSize: 14, borderWidth: 1, borderColor: '#30363d',
  },
  createBtn: { backgroundColor: '#1f6feb', paddingVertical: 10, borderRadius: 6, alignItems: 'center', marginTop: 4 },
  createBtnText: { color: '#fff', fontSize: 13, fontWeight: 'bold' },
  staffList: { maxHeight: 300 },
  staffRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#21262d',
  },
  staffName: { color: '#f0f6fc', fontSize: 14, fontWeight: '600' },
  staffEmail: { color: '#8b949e', fontSize: 12 },
  staffRole: { fontSize: 11, marginTop: 2 },
  toggleBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  toggleBtnText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
});
