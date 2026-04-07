/**
 * Route Resolver Service
 * 
 * Uses PRE-DETERMINED evacuation routes (arrow path sets) drawn on the
 * building blueprints. Does NOT compute paths dynamically.
 * 
 * How it works:
 *   1. On init, build an "overlap map": for each room/corridor, record which
 *      path sets have arrows passing through it (by sampling points along
 *      each arrow and checking point-in-polygon).
 *   2. When the user's position is known, find which room they're in.
 *   3. Look up that room in the overlap map to find the matching path set.
 *   4. If no direct overlap, fall back to the nearest arrow across all sets.
 *   5. Return the full path set (arrows + color + exit door) for rendering.
 * 
 * This mirrors the logic in navigator.js but adapted for React Native.
 */

// ── Geometry Helpers ──────────────────────────────────────────────────────

const PX_TO_M = 0.11;
const IMG_HEIGHT_PX = 524;

/** Convert world meters → pixel coords (for arrow overlap checks) */
function worldToPx(wx, wy) {
  return {
    px: wx / PX_TO_M,
    py: IMG_HEIGHT_PX - wy / PX_TO_M,
  };
}

/** Point-in-polygon (ray casting) using world coordinates */
function pointInPolygon(px, py, polygon) {
  let inside = false;
  const n = polygon.length;
  let j = n - 1;
  for (let i = 0; i < n; i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
    j = i;
  }
  return inside;
}

/** Point-in-polygon using pixel coordinates */
function pointInPolygonPx(x, y, pxPoints) {
  if (!pxPoints || pxPoints.length < 3) return false;
  let inside = false;
  const n = pxPoints.length;
  let j = n - 1;
  for (let i = 0; i < n; i++) {
    const xi = pxPoints[i].px, yi = pxPoints[i].py;
    const xj = pxPoints[j].px, yj = pxPoints[j].py;
    const hit =
      (yi > y) !== (yj > y) &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
    j = i;
  }
  return inside;
}

function distance(ax, ay, bx, by) {
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
}

function centroid(polygon) {
  const n = polygon.length;
  return {
    x: polygon.reduce((s, p) => s + p.x, 0) / n,
    y: polygon.reduce((s, p) => s + p.y, 0) / n,
  };
}

// ── Route Resolver ────────────────────────────────────────────────────────

const SAMPLES_PER_ARROW = 16;

/**
 * Build the route resolver from map data.
 * 
 * @param {Object} mapData — parsed JSON with { shapes, arrowPaths }
 * @returns {Object} resolver with .resolve(wx, wy) method
 */
export function buildRouteResolver(mapData) {
  const shapes = mapData.shapes || [];
  const arrowPathsMeta = mapData.arrowPaths?.meta || {};
  const pxToM = arrowPathsMeta.px_to_m || PX_TO_M;
  const imgH = arrowPathsMeta.image_height_px || IMG_HEIGHT_PX;
  const pathSets = (mapData.arrowPaths?.pathSets || []);

  // Rehydrate shapes: add _px arrays for polygon containment checks
  const rehydratedShapes = shapes.map((s) => {
    const out = { ...s };
    if ((s.type === 'room' || s.type === 'corridor') && s.polygon) {
      out._px = s.polygon.map((p) => ({
        px: p.x / pxToM,
        py: imgH - p.y / pxToM,
      }));
    }
    return out;
  });

  const rooms = rehydratedShapes.filter(
    (s) => (s.type === 'room' || s.type === 'corridor') && s._px?.length >= 3
  );

  // Rehydrate path sets: ensure pixel coordinates exist
  const rehydratedPathSets = pathSets.map((s) => ({
    ...s,
    arrows: (s.arrows || []).map((a) => ({
      ...a,
      x1_px: a.x1_px ?? a.x1_m / pxToM,
      y1_px: a.y1_px ?? (imgH - a.y1_m / pxToM),
      x2_px: a.x2_px ?? a.x2_m / pxToM,
      y2_px: a.y2_px ?? (imgH - a.y2_m / pxToM),
      // Also store world-meter coords for SVG rendering
      x1_m: a.x1_m ?? a.x1_px * pxToM,
      y1_m: a.y1_m ?? (imgH - a.y1_px) * pxToM,
      x2_m: a.x2_m ?? a.x2_px * pxToM,
      y2_m: a.y2_m ?? (imgH - a.y2_px) * pxToM,
    })),
  }));

  // ── Build overlap map ──
  // For each room/corridor, which path sets have arrows passing through?
  const overlapMap = {};

  for (const set of rehydratedPathSets) {
    for (const a of set.arrows) {
      // Sample points along the arrow shaft
      for (let i = 0; i <= SAMPLES_PER_ARROW; i++) {
        const t = i / SAMPLES_PER_ARROW;
        const sx = a.x1_px + (a.x2_px - a.x1_px) * t;
        const sy = a.y1_px + (a.y2_px - a.y1_px) * t;

        for (const shape of rooms) {
          if (pointInPolygonPx(sx, sy, shape._px)) {
            if (!overlapMap[shape.id]) overlapMap[shape.id] = [];
            if (!overlapMap[shape.id].includes(set.id)) {
              overlapMap[shape.id].push(set.id);
            }
          }
        }
      }
    }
  }

  // ── Build arrow graph (tail room → head room per arrow) ──
  const arrowGraph = [];
  for (const set of rehydratedPathSets) {
    for (const a of set.arrows) {
      const tailRoom = rooms.find((r) => pointInPolygonPx(a.x1_px, a.y1_px, r._px));
      const headRoom = rooms.find((r) => pointInPolygonPx(a.x2_px, a.y2_px, r._px));
      arrowGraph.push({
        pathSetId: set.id,
        arrow: a,
        tailRoomId: tailRoom?.id ?? null,
        headRoomId: headRoom?.id ?? null,
      });
    }
  }

  // ── Resolver ──
  return {
    pathSets: rehydratedPathSets,
    overlapMap,
    arrowGraph,
    rooms,
    shapes: rehydratedShapes,
    pxToM,
    imgH,

    /**
     * Find the user's room and matching evacuation route.
     * 
     * @param {number} wx — user X position in meters (world coords)
     * @param {number} wy — user Y position in meters (world coords)
     * @param {Set<string>} blockedSetIds — path set IDs to exclude (blocked by fire)
     * @returns {{ room, pathSet, nearestArrow } | null}
     */
    resolve(wx, wy, blockedSetIds = new Set()) {
      // 1. Find which room/corridor the user is in
      const foundRoom = rooms.find((r) => {
        if (!r.polygon) return false;
        return pointInPolygon(wx, wy, r.polygon);
      });

      if (!foundRoom) {
        // Fallback: find nearest room by centroid distance
        let nearest = null;
        let minDist = Infinity;
        for (const r of rooms) {
          if (!r.polygon) continue;
          const c = centroid(r.polygon);
          const d = distance(wx, wy, c.x, c.y);
          if (d < minDist) { minDist = d; nearest = r; }
        }
        if (!nearest || minDist > 10) return null; // too far from any room
        return this._resolveForRoom(nearest, wx, wy, blockedSetIds);
      }

      return this._resolveForRoom(foundRoom, wx, wy, blockedSetIds);
    },

    _resolveForRoom(room, wx, wy, blockedSetIds) {
      // Pass A: check overlap map
      const mappedSetIds = (overlapMap[room.id] || []).filter(
        (id) => !blockedSetIds.has(id)
      );

      let resolvedSet = null;

      if (mappedSetIds.length > 0) {
        resolvedSet = rehydratedPathSets.find((s) => s.id === mappedSetIds[0]) || null;
      }

      // Pass B: nearest arrow fallback
      if (!resolvedSet && rehydratedPathSets.length > 0) {
        const userPx = wx / pxToM;
        const userPy = imgH - wy / pxToM;
        let nearDist = Infinity;

        for (const set of rehydratedPathSets) {
          if (blockedSetIds.has(set.id)) continue;
          for (const a of set.arrows) {
            const dTail = distance(userPx, userPy, a.x1_px, a.y1_px);
            const dHead = distance(userPx, userPy, a.x2_px, a.y2_px);
            const d = Math.min(dTail, dHead);
            if (d < nearDist) { nearDist = d; resolvedSet = set; }
          }
        }
      }

      if (!resolvedSet) {
        return { room, pathSet: null, nearestArrow: null };
      }

      // Find the nearest arrow in the resolved set to draw guidance
      const userPx = wx / pxToM;
      const userPy = imgH - wy / pxToM;
      let nearestArrow = resolvedSet.arrows[0];
      let nearDist = Infinity;

      for (const a of resolvedSet.arrows) {
        const tailRoom = rooms.find((r) => pointInPolygonPx(a.x1_px, a.y1_px, r._px));
        const inSameRoom = tailRoom && tailRoom.id === room.id;
        const d = distance(userPx, userPy, a.x1_px, a.y1_px);
        const effective = inSameRoom ? d * 0.01 : d;
        if (effective < nearDist) { nearDist = effective; nearestArrow = a; }
      }

      return { room, pathSet: resolvedSet, nearestArrow };
    },
  };
}

/**
 * Find which room/corridor contains a world position.
 */
export function findUserRoom(mapData, wx, wy) {
  for (const s of mapData.shapes || []) {
    if ((s.type === 'room' || s.type === 'corridor') && s.polygon) {
      if (pointInPolygon(wx, wy, s.polygon)) return s;
    }
  }
  return null;
}
