/**
 * useEmergency Hook
 * 
 * Combines emergency state, hazard tracking, user locations,
 * and announcements into a single reactive hook.
 */

import { useState, useEffect } from 'react';
import {
  onEmergencyStateChange,
  onHazardsChange,
  onUserLocationsChange,
  onAnnouncementsChange,
} from '../services/emergency';

export function useEmergency(buildingId = 'main') {
  const [emergencyActive, setEmergencyActive] = useState(false);
  const [emergencyData, setEmergencyData] = useState(null);
  const [hazards, setHazards] = useState([]);
  const [userLocations, setUserLocations] = useState([]);
  const [announcements, setAnnouncements] = useState([]);

  useEffect(() => {
    const unsub1 = onEmergencyStateChange(buildingId, (state) => {
      setEmergencyActive(state.active || false);
      setEmergencyData(state);
    });

    const unsub2 = onHazardsChange(buildingId, (h) => {
      setHazards(h);
    });

    const unsub3 = onUserLocationsChange(buildingId, (u) => {
      setUserLocations(u);
    });

    const unsub4 = onAnnouncementsChange(buildingId, (a) => {
      setAnnouncements(a);
    });

    return () => {
      unsub1();
      unsub2();
      unsub3();
      unsub4();
    };
  }, [buildingId]);

  const blockedNodeIds = new Set(
    hazards.map((h) => h.nodeId).filter(Boolean)
  );

  const safeCount = userLocations.filter((u) => u.safe).length;
  const unsafeCount = userLocations.filter((u) => !u.safe).length;

  return {
    emergencyActive,
    emergencyData,
    hazards,
    userLocations,
    announcements,
    blockedNodeIds,
    safeCount,
    unsafeCount,
    totalUsers: userLocations.length,
  };
}
