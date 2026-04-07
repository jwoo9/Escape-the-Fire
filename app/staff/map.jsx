/**
 * Staff Map Screen
 * 
 * Uses PRE-DETERMINED evacuation routes (arrow path sets) drawn on the blueprints.
 * When an emergency is active:
 *   1. Determines user's room from their position
 *   2. Finds which path set covers that room (via arrow overlap)
 *   3. Highlights that path set on the map, dims all others
 *   4. Draws a guidance line from user to the nearest arrow
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert,
  ScrollView, Dimensions, Vibration, Modal,
} from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { logout } from '../../services/auth';
import BuildingMap from '../../components/BuildingMap';
import { buildRouteResolver, findUserRoom } from '../../services/routeResolver';
import { simulateBeaconReadings, estimatePosition, checkPerimeter } from '../../services/beacon';
import {
  activateEmergency, onEmergencyStateChange,
  reportHazard, onHazardsChange,
  updateUserLocation, markUserSafe, onAnnouncementsChange,
} from '../../services/emergency';

import mainMapData from '../../mainMapData.json';
import squashMapData from '../../squashMapData.json';

const BUILDINGS = {
  main: { label: 'Main Building', data: mainMapData },
  squash: { label: 'Squash Building', data: squashMapData },
};

export default function StaffMap() {
  const { user } = useAuth();
  const [selectedBuilding, setSelectedBuilding] = useState('main');
  const [userPosition, setUserPosition] = useState(null);
  const [activePathSet, setActivePathSet] = useState(null);
  const [nearestArrow, setNearestArrow] = useState(null);
  const [currentRoom, setCurrentRoom] = useState(null);
  const [emergencyActive, setEmergencyActive] = useState(false);
  const [hazards, setHazards] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [showAnnouncements, setShowAnnouncements] = useState(false);
  const [resolver, setResolver] = useState(null);
  const [isSafe, setIsSafe] = useState(false);

  const mapData = BUILDINGS[selectedBuilding].data;

  // Build route resolver when map data changes
  useEffect(() => {
    const r = buildRouteResolver(mapData);
    setResolver(r);
  }, [mapData]);

  // Listen for emergency state
  useEffect(() => {
    const unsub = onEmergencyStateChange(selectedBuilding, (state) => {
      const wasInactive = !emergencyActive;
      setEmergencyActive(state.active || false);
      if (state.active && wasInactive) {
        Vibration.vibrate([0, 500, 200, 500, 200, 500]);
        Alert.alert('🚨 EMERGENCY ACTIVE',
          'An emergency has been reported. Follow your evacuation route immediately.',
          [{ text: 'OK', style: 'destructive' }]);
      }
    });
    return unsub;
  }, [selectedBuilding]);

  useEffect(() => {
    const unsub = onHazardsChange(selectedBuilding, (h) => setHazards(h));
    return unsub;
  }, [selectedBuilding]);

  useEffect(() => {
    const unsub = onAnnouncementsChange(selectedBuilding, (a) => {
      setAnnouncements(a);
      if (a.length > 0 && a[0].sentAt > Date.now() - 5000) setShowAnnouncements(true);
    });
    return unsub;
  }, [selectedBuilding]);

  // Resolve evacuation route when position/emergency changes
  useEffect(() => {
    if (!emergencyActive || !resolver || !userPosition) {
      setActivePathSet(null);
      setNearestArrow(null);
      setCurrentRoom(null);
      return;
    }

    const result = resolver.resolve(userPosition.x, userPosition.y);
    if (result) {
      setCurrentRoom(result.room);
      setActivePathSet(result.pathSet);
      setNearestArrow(result.nearestArrow);

      if (!result.pathSet) {
        Alert.alert('No Route Found',
          'No evacuation route covers your current location. Move toward the nearest visible exit.');
      }
    }
  }, [emergencyActive, resolver, userPosition, hazards]);

  // Also show current room even when no emergency
  useEffect(() => {
    if (userPosition && mapData) {
      const room = findUserRoom(mapData, userPosition.x, userPosition.y);
      if (!emergencyActive) setCurrentRoom(room);
    }
  }, [userPosition, mapData, emergencyActive]);

  const simulatePresetPosition = (presetName) => {
    const presets = {
      'Room 1':  { x: 31, y: 16 },  'Room 5':  { x: 4, y: 28 },
      'Corridor 4': { x: 43, y: 19 }, 'Room 9':  { x: 43, y: 30 },
      'Room 21 (Gym)': { x: 93, y: 33 }, 'Room 13': { x: 58, y: 28 },
    };
    const pos = presets[presetName];
    if (!pos) return;
    const readings = simulateBeaconReadings(pos.x, pos.y);
    const estimated = estimatePosition(readings);
    if (estimated) {
      setUserPosition(estimated);
      if (user) {
        updateUserLocation(selectedBuilding, user.uid, {
          x: estimated.x, y: estimated.y, accuracy: estimated.accuracy,
          name: user.email?.split('@')[0] || 'Staff', safe: false,
        });
      }
      const perimeter = checkPerimeter(estimated.x, estimated.y, selectedBuilding);
      if (perimeter.pastSafeZone && !isSafe) {
        setIsSafe(true);
        if (user) markUserSafe(selectedBuilding, user.uid);
        Alert.alert('✅ Safe Zone', 'You have reached the safe zone outside the building.');
      }
    }
  };

  const handleReportEmergency = () => {
    Alert.alert('🚨 Report Emergency',
      'This will activate emergency mode for the entire building and alert all staff.',
      [{ text: 'Cancel', style: 'cancel' },
       { text: 'ACTIVATE EMERGENCY', style: 'destructive',
         onPress: () => activateEmergency(selectedBuilding, user?.email || 'unknown') }]);
  };

  const handleReportHazard = () => {
    if (!userPosition) {
      Alert.alert('Location Required', 'Your position must be known to report a hazard.');
      return;
    }
    const roomLabel = currentRoom?.label || currentRoom?.id || 'your location';
    Alert.alert('🔥 Report Hazard', `Report fire/smoke at ${roomLabel}?`,
      [{ text: 'Cancel', style: 'cancel' },
       { text: 'Report Fire/Smoke', style: 'destructive',
         onPress: () => reportHazard(selectedBuilding, {
           type: 'fire', x: userPosition.x, y: userPosition.y,
           nodeId: currentRoom?.id, reportedBy: user?.email || 'unknown',
         }) }]);
  };

  const hazardMarkers = hazards.map((h) => ({ x: h.x, y: h.y, nodeId: h.nodeId, type: h.type }));

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Escape the Fire</Text>
          <Text style={styles.subtitle}>{BUILDINGS[selectedBuilding].label}</Text>
        </View>
        <View style={styles.headerRight}>
          {emergencyActive && (
            <View style={styles.emergencyBadge}>
              <Text style={styles.emergencyBadgeText}>🚨 ACTIVE</Text>
            </View>
          )}
          <TouchableOpacity style={styles.signOutBtn} onPress={logout}>
            <Text style={styles.signOutText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Emergency Banner */}
      {emergencyActive && (
        <View style={styles.emergencyBanner}>
          <Text style={styles.emergencyBannerText}>⚠️ EMERGENCY — Follow the glowing arrows to exit</Text>
          {activePathSet && (
            <Text style={styles.routeInfo}>
              Route: {activePathSet.name} → Exit {activePathSet.exitDoorId || ''}
            </Text>
          )}
        </View>
      )}

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Building selector */}
        <View style={styles.buildingSelector}>
          {Object.entries(BUILDINGS).map(([key, val]) => (
            <TouchableOpacity key={key}
              style={[styles.buildingTab, selectedBuilding === key && styles.buildingTabActive]}
              onPress={() => {
                setSelectedBuilding(key); setActivePathSet(null);
                setUserPosition(null); setIsSafe(false); setNearestArrow(null);
              }}>
              <Text style={[styles.buildingTabText, selectedBuilding === key && styles.buildingTabTextActive]}>
                {val.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Map */}
        <View style={styles.mapContainer}>
          <BuildingMap
            mapData={mapData}
            userPosition={userPosition}
            activePathSet={activePathSet}
            nearestArrow={nearestArrow}
            hazards={hazardMarkers}
            showLabels={true}
          />
        </View>

        {/* Position + Room Info */}
        {userPosition && (
          <View style={styles.positionInfo}>
            <Text style={styles.positionText}>
              📍 Position: ({userPosition.x}m, {userPosition.y}m) ±{userPosition.accuracy}m
            </Text>
            {currentRoom && (
              <Text style={styles.positionSubtext}>
                Location: {currentRoom.label || currentRoom.id}
              </Text>
            )}
            {emergencyActive && activePathSet && (
              <Text style={[styles.positionSubtext, { color: activePathSet.color }]}>
                Follow: {activePathSet.name} → Exit {activePathSet.exitDoorId || ''}
              </Text>
            )}
          </View>
        )}

        {/* Simulation Controls */}
        <View style={styles.simSection}>
          <Text style={styles.sectionTitle}>📡 Simulate Position</Text>
          <Text style={styles.simHint}>Tap a preset to simulate your BLE beacon position</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.presetRow}>
              {['Room 1', 'Room 5', 'Corridor 4', 'Room 9', 'Room 13', 'Room 21 (Gym)'].map((name) => (
                <TouchableOpacity key={name} style={styles.presetBtn}
                  onPress={() => simulatePresetPosition(name)}>
                  <Text style={styles.presetBtnText}>{name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>

        {/* Action Buttons */}
        <View style={styles.actionSection}>
          {!emergencyActive ? (
            <TouchableOpacity style={styles.emergencyBtn} onPress={handleReportEmergency}>
              <Text style={styles.emergencyBtnText}>🚨 Report Emergency</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.hazardBtn} onPress={handleReportHazard}>
                <Text style={styles.hazardBtnText}>🔥 Report Fire/Smoke</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.safeBtn, isSafe && styles.safeBtnDone]}
                onPress={() => {
                  if (user) markUserSafe(selectedBuilding, user.uid);
                  setIsSafe(true);
                  Alert.alert('✅ Marked Safe', 'You have been marked as safely evacuated.');
                }} disabled={isSafe}>
                <Text style={styles.safeBtnText}>{isSafe ? '✅ Safe' : '🏃 Mark Safe'}</Text>
              </TouchableOpacity>
            </View>
          )}
          {announcements.length > 0 && (
            <TouchableOpacity style={styles.announcementBtn} onPress={() => setShowAnnouncements(true)}>
              <Text style={styles.announcementBtnText}>
                📢 {announcements.length} Announcement{announcements.length > 1 ? 's' : ''}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Legend */}
        <View style={styles.legend}>
          <Text style={styles.legendTitle}>Map Legend</Text>
          <View style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: '#162033' }]} />
            <Text style={styles.legendText}>Rooms</Text>
            <View style={[styles.legendDot, { backgroundColor: '#1a3a2a' }]} />
            <Text style={styles.legendText}>Corridors</Text>
            <View style={[styles.legendDot, { backgroundColor: '#3498db' }]} />
            <Text style={styles.legendText}>Doors</Text>
          </View>
          <View style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: '#27ae60' }]} />
            <Text style={styles.legendText}>Exits</Text>
            <View style={[styles.legendDot, { backgroundColor: '#e74c3c' }]} />
            <Text style={styles.legendText}>Hazards</Text>
          </View>
          {(mapData?.arrowPaths?.pathSets || []).length > 0 && (
            <View style={styles.legendRow}>
              {(mapData.arrowPaths.pathSets).map((ps) => (
                <React.Fragment key={ps.id}>
                  <View style={[styles.legendDot, { backgroundColor: ps.color }]} />
                  <Text style={styles.legendText}>{ps.name}</Text>
                </React.Fragment>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Announcements Modal */}
      <Modal visible={showAnnouncements} animationType="slide" transparent
        onRequestClose={() => setShowAnnouncements(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>📢 Announcements</Text>
            <ScrollView style={styles.announcementsList}>
              {announcements.map((a, i) => (
                <View key={a.id || i} style={styles.announcementItem}>
                  <Text style={styles.announcementMessage}>{a.message}</Text>
                  <Text style={styles.announcementMeta}>
                    From: {a.sender} • {new Date(a.sentAt).toLocaleTimeString()}
                  </Text>
                </View>
              ))}
              {announcements.length === 0 && (
                <Text style={styles.noAnnouncements}>No announcements yet.</Text>
              )}
            </ScrollView>
            <TouchableOpacity style={styles.modalClose} onPress={() => setShowAnnouncements(false)}>
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
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  emergencyBadge: { backgroundColor: '#da3633', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 },
  emergencyBadgeText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  signOutBtn: {
    paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#21262d',
    borderRadius: 6, borderWidth: 1, borderColor: '#30363d',
  },
  signOutText: { color: '#8b949e', fontSize: 12 },
  emergencyBanner: { backgroundColor: '#da3633', paddingHorizontal: 16, paddingVertical: 10 },
  emergencyBannerText: { color: '#fff', fontSize: 14, fontWeight: 'bold', textAlign: 'center' },
  routeInfo: { color: '#ffdddd', fontSize: 11, textAlign: 'center', marginTop: 2 },
  scrollView: { flex: 1 },
  scrollContent: { paddingBottom: 32 },
  buildingSelector: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  buildingTab: {
    flex: 1, paddingVertical: 8, alignItems: 'center', backgroundColor: '#161b22',
    borderRadius: 8, borderWidth: 1, borderColor: '#21262d',
  },
  buildingTabActive: { backgroundColor: '#1f3a5f', borderColor: '#3498db' },
  buildingTabText: { color: '#8b949e', fontSize: 13, fontWeight: '600' },
  buildingTabTextActive: { color: '#58a6ff' },
  mapContainer: {
    marginHorizontal: 10, borderRadius: 12, overflow: 'hidden',
    borderWidth: 1, borderColor: '#21262d',
  },
  positionInfo: {
    marginHorizontal: 16, marginTop: 8, padding: 10, backgroundColor: '#161b22',
    borderRadius: 8, borderWidth: 1, borderColor: '#21262d',
  },
  positionText: { color: '#58a6ff', fontSize: 13, fontWeight: '600' },
  positionSubtext: { color: '#8b949e', fontSize: 12, marginTop: 2 },
  simSection: {
    marginHorizontal: 16, marginTop: 12, padding: 12, backgroundColor: '#161b22',
    borderRadius: 8, borderWidth: 1, borderColor: '#21262d',
  },
  sectionTitle: { color: '#f0f6fc', fontSize: 14, fontWeight: 'bold', marginBottom: 4 },
  simHint: { color: '#8b949e', fontSize: 11, marginBottom: 8 },
  presetRow: { flexDirection: 'row', gap: 8 },
  presetBtn: {
    paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#21262d',
    borderRadius: 6, borderWidth: 1, borderColor: '#30363d',
  },
  presetBtnText: { color: '#c9d1d9', fontSize: 12 },
  actionSection: { marginHorizontal: 16, marginTop: 12, gap: 8 },
  emergencyBtn: { backgroundColor: '#da3633', paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  emergencyBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  actionRow: { flexDirection: 'row', gap: 8 },
  hazardBtn: { flex: 1, backgroundColor: '#9a6700', paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  hazardBtnText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  safeBtn: { flex: 1, backgroundColor: '#238636', paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  safeBtnDone: { backgroundColor: '#1a7f37', opacity: 0.7 },
  safeBtnText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  announcementBtn: {
    backgroundColor: '#1f3a5f', paddingVertical: 10, borderRadius: 8,
    alignItems: 'center', borderWidth: 1, borderColor: '#58a6ff',
  },
  announcementBtnText: { color: '#58a6ff', fontSize: 13, fontWeight: '600' },
  legend: {
    marginHorizontal: 16, marginTop: 16, padding: 12, backgroundColor: '#161b22',
    borderRadius: 8, borderWidth: 1, borderColor: '#21262d',
  },
  legendTitle: { color: '#8b949e', fontSize: 11, fontWeight: 'bold', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginVertical: 2, flexWrap: 'wrap' },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { color: '#8b949e', fontSize: 11, marginRight: 8 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#161b22', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, maxHeight: '60%' },
  modalTitle: { color: '#f0f6fc', fontSize: 18, fontWeight: 'bold', marginBottom: 12 },
  announcementsList: { maxHeight: 300 },
  announcementItem: { backgroundColor: '#21262d', padding: 12, borderRadius: 8, marginBottom: 8 },
  announcementMessage: { color: '#f0f6fc', fontSize: 14 },
  announcementMeta: { color: '#8b949e', fontSize: 11, marginTop: 4 },
  noAnnouncements: { color: '#8b949e', fontSize: 13, textAlign: 'center', paddingVertical: 20 },
  modalClose: { marginTop: 12, paddingVertical: 10, backgroundColor: '#21262d', borderRadius: 8, alignItems: 'center' },
  modalCloseText: { color: '#c9d1d9', fontSize: 14, fontWeight: '600' },
});
