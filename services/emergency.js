/**
 * Emergency Service
 * 
 * Manages real-time emergency state via Firebase Realtime Database:
 *   - Emergency active/inactive state
 *   - Reported hazards (fire/smoke at specific nodes)
 *   - User locations and safe status
 *   - Push notifications for emergencies
 */

import { ref, set, onValue, push, remove, update, get, serverTimestamp } from 'firebase/database';
import { rtdb } from './firebase';

// ── Emergency State ───────────────────────────────────────────────────────────

/**
 * Activate emergency mode for a building
 */
export async function activateEmergency(buildingId = 'main', reportedBy = 'unknown') {
  const emergencyRef = ref(rtdb, `emergencies/${buildingId}`);
  await set(emergencyRef, {
    active: true,
    activatedAt: Date.now(),
    reportedBy,
    resolved: false,
  });
}

/**
 * Deactivate emergency mode
 */
export async function deactivateEmergency(buildingId = 'main') {
  const emergencyRef = ref(rtdb, `emergencies/${buildingId}`);
  await update(emergencyRef, {
    active: false,
    resolvedAt: Date.now(),
    resolved: true,
  });
  // Clear all hazard reports
  const hazardsRef = ref(rtdb, `hazards/${buildingId}`);
  await remove(hazardsRef);
}

/**
 * Listen for emergency state changes
 * @returns {Function} unsubscribe function
 */
export function onEmergencyStateChange(buildingId = 'main', callback) {
  const emergencyRef = ref(rtdb, `emergencies/${buildingId}`);
  return onValue(emergencyRef, (snapshot) => {
    const data = snapshot.val();
    callback(data || { active: false });
  });
}

// ── Hazard Reports ────────────────────────────────────────────────────────────

/**
 * Report a hazard (fire/smoke) at a specific location/node
 */
export async function reportHazard(buildingId = 'main', hazard) {
  const hazardsRef = ref(rtdb, `hazards/${buildingId}`);
  const newRef = push(hazardsRef);
  await set(newRef, {
    ...hazard,
    reportedAt: Date.now(),
    id: newRef.key,
  });
  return newRef.key;
}

/**
 * Remove a hazard report
 */
export async function removeHazard(buildingId = 'main', hazardId) {
  const hazardRef = ref(rtdb, `hazards/${buildingId}/${hazardId}`);
  await remove(hazardRef);
}

/**
 * Listen for hazard reports (blocked nodes)
 * @returns {Function} unsubscribe function
 */
export function onHazardsChange(buildingId = 'main', callback) {
  const hazardsRef = ref(rtdb, `hazards/${buildingId}`);
  return onValue(hazardsRef, (snapshot) => {
    const data = snapshot.val();
    const hazards = data ? Object.values(data) : [];
    callback(hazards);
  });
}

// ── User Location Tracking ────────────────────────────────────────────────────

/**
 * Update user's current location in the building
 */
export async function updateUserLocation(buildingId = 'main', userId, locationData) {
  const userRef = ref(rtdb, `locations/${buildingId}/${userId}`);
  await set(userRef, {
    ...locationData,
    updatedAt: Date.now(),
  });
}

/**
 * Mark user as safely evacuated
 */
export async function markUserSafe(buildingId = 'main', userId) {
  const userRef = ref(rtdb, `locations/${buildingId}/${userId}`);
  await update(userRef, {
    safe: true,
    evacuatedAt: Date.now(),
  });
}

/**
 * Listen for all user locations (admin view)
 * @returns {Function} unsubscribe function
 */
export function onUserLocationsChange(buildingId = 'main', callback) {
  const locationsRef = ref(rtdb, `locations/${buildingId}`);
  return onValue(locationsRef, (snapshot) => {
    const data = snapshot.val();
    const users = data ? Object.entries(data).map(([uid, loc]) => ({ uid, ...loc })) : [];
    callback(users);
  });
}

/**
 * Remove user location on disconnect
 */
export async function clearUserLocation(buildingId = 'main', userId) {
  const userRef = ref(rtdb, `locations/${buildingId}/${userId}`);
  await remove(userRef);
}

// ── Announcements ─────────────────────────────────────────────────────────────

/**
 * Send an announcement to all users
 */
export async function sendAnnouncement(buildingId = 'main', message, sender) {
  const announcementsRef = ref(rtdb, `announcements/${buildingId}`);
  const newRef = push(announcementsRef);
  await set(newRef, {
    message,
    sender,
    sentAt: Date.now(),
    id: newRef.key,
  });
  return newRef.key;
}

/**
 * Listen for announcements
 * @returns {Function} unsubscribe function
 */
export function onAnnouncementsChange(buildingId = 'main', callback) {
  const announcementsRef = ref(rtdb, `announcements/${buildingId}`);
  return onValue(announcementsRef, (snapshot) => {
    const data = snapshot.val();
    const announcements = data
      ? Object.values(data).sort((a, b) => b.sentAt - a.sentAt)
      : [];
    callback(announcements);
  });
}

/**
 * Clear all announcements
 */
export async function clearAnnouncements(buildingId = 'main') {
  const announcementsRef = ref(rtdb, `announcements/${buildingId}`);
  await remove(announcementsRef);
}
