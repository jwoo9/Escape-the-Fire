import { off, onValue, ref, set } from 'firebase/database';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { db, rtdb } from './firebase';

// ─── Firestore collections ────────────────────────────────────────────────────
// emergencies/current  — single doc with active emergency state
// blockedZones/{id}    — zones marked as on-fire / off-limits

export const EMERGENCY_DOC = 'emergencies/current';

// Trigger a building-wide emergency alert
export const triggerEmergency = async (reportedBy, note = '') => {
  await setDoc(doc(db, 'emergencies', 'current'), {
    active: true,
    triggeredAt: serverTimestamp(),
    reportedBy,
    note,
  });
};

// Clear the emergency
export const clearEmergency = async () => {
  try {
    // 1. Mark the emergency as inactive safely
    await setDoc(doc(db, 'emergencies', 'current'), {
      active: false,
      clearedAt: serverTimestamp(),
    }, { merge: true });

    // 2. Fetch and delete all blocked fire zones so the map resets
    const blockedSnap = await getDocs(collection(db, 'blockedZones'));
    const deleteZones = blockedSnap.docs.map(d => deleteDoc(d.ref));

    // 3. Fetch and delete all safe check-ins so staff can check in next time
    const safeSnap = await getDocs(collection(db, 'safeCheckIns'));
    const deleteSafe = safeSnap.docs.map(d => deleteDoc(d.ref));

    // Execute all deletions at once
    await Promise.all([...deleteZones, ...deleteSafe]);
  } catch (error) {
    console.error('Error clearing emergency: ', error);
  }
};

// Mark a zone (room/corridor id from map data) as blocked / on fire
export const blockZone = async (zoneId, zoneLabel, reportedBy) => {
  await setDoc(doc(db, 'blockedZones', zoneId), {
    zoneId,
    zoneLabel,
    reportedBy,
    blockedAt: serverTimestamp(),
  });
};

// Unblock a zone
export const unblockZone = async (zoneId) => {
  await deleteDoc(doc(db, 'blockedZones', zoneId));
};

// Fetch all currently blocked zones once
export const getBlockedZones = async () => {
  const snap = await getDocs(collection(db, 'blockedZones'));
  return snap.docs.map(d => d.data());
};

// Subscribe to emergency state changes — calls cb({ active, triggeredAt, ... })
export const subscribeEmergency = (cb) => {
  const unsub = onSnapshot(doc(db, 'emergencies', 'current'), snap => {
    cb(snap.exists() ? snap.data() : { active: false });
  });
  return unsub;
};

// Mark a user as safe — writes to safeCheckIns/{uid}
export const checkInSafe = async (uid, displayName) => {
  await setDoc(doc(db, 'safeCheckIns', uid), {
    uid,
    displayName: displayName ?? 'Unknown',
    checkedInAt: serverTimestamp(),
  });
};

// Subscribe to safe check-ins — calls cb([{ uid, displayName, checkedInAt }])
export const subscribeSafeCheckIns = (cb) => {
  const unsub = onSnapshot(collection(db, 'safeCheckIns'), snap => {
    cb(snap.docs.map(d => d.data()));
  });
  return unsub;
};

// Subscribe to blocked zones — calls cb([{ zoneId, zoneLabel, ... }])
export const subscribeBlockedZones = (cb) => {
  const unsub = onSnapshot(collection(db, 'blockedZones'), snap => {
    cb(snap.docs.map(d => d.data()));
  });
  return unsub;
};

// ─── Realtime DB — staff location writes ─────────────────────────────────────
// Path: locations/{uid} = { x_px, y_px, floor, updatedAt }

export const writeLocation = (uid, x_px, y_px, floor = 'main') => {
  const locRef = ref(rtdb, `locations/${uid}`);
  return set(locRef, { x_px, y_px, floor, updatedAt: Date.now() });
};

// Subscribe to all staff locations — calls cb({ uid: { x_px, y_px, floor, updatedAt } })
export const subscribeLocations = (cb) => {
  const locRef = ref(rtdb, 'locations');
  onValue(locRef, snap => cb(snap.val() || {}));
  return () => off(locRef);
};