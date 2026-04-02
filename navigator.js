// =============================================================================
// navigator.js — Evacuation Navigator (read-only runtime)
// Companion to the annotator (scripts.js / index.html).
// Loads map_data.json, which is the IMMUTABLE source of truth.
// Does NOT write, modify, or re-export any data.
//
// JSON STRUCTURE expected in map_data.json:
// {
//   "meta": { "px_to_m": 0.11, "image_height_px": 524, "image_src": "MyMap.png" },
//   "shapes": [
//     {
//       "id": "room_1", "type": "room", "label": "Room 1",
//       "polygon": [ {"x": 1.2, "y": 3.4}, ... ],
//       "evacuation_route_color": null,
//       "connected_doors": ["door_1"]
//     },
//     { "id": "corridor_1", "type": "corridor", ... },
//     { "id": "door_1", "type": "door",
//       "position": {"x": 5.1, "y": 2.3}, "is_exit": true }
//   ],
//   "arrowPaths": {
//     "meta": { "px_to_m": 0.11, "image_height_px": 524 },
//     "pathSets": [
//       {
//         "id": "ps_yellow", "name": "Yellow Route",
//         "color": "#f5c518", "exitDoorId": "door_north",
//         "arrows": [
//           { "x1_px": 120, "y1_px": 200, "x2_px": 180, "y2_px": 160,
//             "headSize": 16, "lineWidth": 2 }
//         ]
//       }
//     ]
//   }
// }
// =============================================================================

// ─── Runtime state ─────────────────────────────────────────────────────────────
let canvas, context;
let mapImage      = null;   // HTMLImageElement
let mapData       = null;   // parsed map_data.json
let shapes        = [];     // rehydrated shapes with _px arrays
let pathSets      = [];     // arrowPaths.pathSets with px coords
let overlapMap    = {};     // { shapeId: [pathSetId, ...] }
let mousePos      = { px: 0, py: 0 };
let manualUserPos = null;   // { px, py } when pinned, else null
let activeSetId   = null;   // currently glowing path set id
let glowPhase     = 0;
let animFrameId   = null;

const PX_TO_M_DEFAULT   = 0.11;
const IMG_H_PX_DEFAULT  = 524;
const SAMPLES_PER_ARROW = 16;

// ─── Init ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  canvas = document.getElementById('mapCanvas');
  context    = canvas.getContext('2d');

  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseleave', onMouseLeave);
  window.addEventListener('keydown', onKeyDown);
});

// ─── Public: called by HTML Unpin button ───────────────────────────────────────
function unpinUser() {
  manualUserPos = null;
  const hint = document.getElementById('pin-hint');
  if (hint) {
    hint.classList.remove('pinned');
    hint.innerHTML = '&#128205; Pin User &mdash; Press <kbd>P</kbd>';
  }
  _activate(null);
  _updateInfoPanel(null, null);
  setNavStatus('User position unpinned — following cursor.');
  if (!animFrameId) redraw();
}

// ─── File loading ──────────────────────────────────────────────────────────────
function loadMapFile() {
  const input  = document.createElement('input');
  input.type   = 'file';
  input.accept = '.json';
  input.onchange = e => {
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        mapData = JSON.parse(ev.target.result);
        _ingestMapData(mapData);
        setLoadStatus('Map loaded. Click "Build Route Map" to enable navigation.', 'ok');
      } catch (err) {
        setLoadStatus('Failed to parse JSON: ' + err.message, 'err');
      }
    };
    reader.readAsText(e.target.files[0]);
  };
  input.click();
}

// ─── Ingest + rehydrate ────────────────────────────────────────────────────────
function _ingestMapData(data) {
  const meta    = data.meta || data.arrowPaths?.meta || {};
  const PX_TO_M = meta.px_to_m        || PX_TO_M_DEFAULT;
  const IMG_H   = meta.image_height_px || IMG_H_PX_DEFAULT;
  const imgSrc  = meta.image_src       || '';

  // Rehydrate shapes: convert world-metre polygon coords → canvas pixel coords.
  // Canvas Y is flipped: py = IMG_H - (y_m / PX_TO_M)
  shapes = (data.shapes || []).map(s => {
    const out = { ...s };
    if ((s.type === 'room' || s.type === 'corridor') && s.polygon) {
      out._px = s.polygon.map(p => ({
        px: p.x / PX_TO_M,
        py: IMG_H - p.y / PX_TO_M,
      }));
    } else if (s.type === 'door' && s.position) {
      out._px = {
        px: s.position.x / PX_TO_M,
        py: IMG_H - s.position.y / PX_TO_M,
      };
    }
    return out;
  });

  // Rehydrate path sets: ensure _px coordinates exist (fall back from metres).
  pathSets = ((data.arrowPaths || {}).pathSets || []).map(s => ({
    ...s,
    arrows: (s.arrows || []).map(a => ({
      ...a,
      x1_px: a.x1_px ?? a.x1_m / PX_TO_M,
      y1_px: a.y1_px ?? (IMG_H - a.y1_m / PX_TO_M),
      x2_px: a.x2_px ?? a.x2_m / PX_TO_M,
      y2_px: a.y2_px ?? (IMG_H - a.y2_m / PX_TO_M),
    })),
  }));

  // Load background map image.
  mapImage     = new Image();
  mapImage.src = imgSrc;
  mapImage.onload = () => {
    canvas.width  = mapImage.naturalWidth;
    canvas.height = mapImage.naturalHeight;
    redraw();
  };
  mapImage.onerror = () => {
    setLoadStatus(`Warning: could not load image "${imgSrc}". Drawing shapes without background.`, 'err');
    canvas.width  = 1043;
    canvas.height = IMG_H;
    redraw();
  };
}

// =============================================================================
// PART 1 — Overlap map + arrow adjacency graph
//
// overlapMap: for each room/corridor, record which path sets have arrows
//             passing through it (by sampling SAMPLES_PER_ARROW points per arrow).
//
// arrowGraph: directed adjacency list.  Each entry = one arrow linking
//             its tail-room → head-room for a given path set.
// =============================================================================
const nav = {

  buildOverlapMap() {
    overlapMap = {};

    const rooms = shapes.filter(s =>
      (s.type === 'room' || s.type === 'corridor') && s._px?.length >= 3
    );

    for (const set of pathSets) {
      for (const a of set.arrows) {
        // Sample SAMPLES_PER_ARROW + 1 evenly-spaced points along the arrow shaft.
        for (let i = 0; i <= SAMPLES_PER_ARROW; i++) {
          const t  = i / SAMPLES_PER_ARROW;
          const sx = a.x1_px + (a.x2_px - a.x1_px) * t;
          const sy = a.y1_px + (a.y2_px - a.y1_px) * t;

          for (const shape of rooms) {
            if (_pointInPolygonPx(sx, sy, shape._px)) {
              if (!overlapMap[shape.id]) overlapMap[shape.id] = [];
              if (!overlapMap[shape.id].includes(set.id)) {
                overlapMap[shape.id].push(set.id);
              }
            }
          }
        }
      }
    }

    const count = Object.keys(overlapMap).length;
    setLoadStatus(
      `Route map built — ${count} room(s) mapped to path set(s). Hover or pin to navigate.`,
      'ok'
    );
    console.log('[nav] overlapMap:', overlapMap);

    this.buildArrowGraph();
    redraw();
  },

  buildArrowGraph() {
    this.arrowGraph = [];

    for (const set of pathSets) {
      for (const a of set.arrows) {
        // An arrow "belongs" to the room its TAIL sits in and points toward its head room.
        const tailRoom = _findContainingShape(a.x1_px, a.y1_px);
        const headRoom = _findContainingShape(a.x2_px, a.y2_px);

        // Include arrows whose tail is in a room even if head is not (e.g. corridor exit).
        if (!tailRoom) continue;

        this.arrowGraph.push({
          pathSet: set,
          arrow: a,
          tailRoomId: tailRoom.id,
          headRoomId: headRoom?.id ?? null,
        });
      }
    }

    console.log('[nav] arrowGraph:', this.arrowGraph);
  },

  // ===========================================================================
  // PART 2 — Resolve position → route
  //
  // Strategy (two-pass, robust):
  //
  // Pass A — overlapMap lookup:
  //   If the user's room appears in overlapMap, use the FIRST matching path set.
  //   This covers the common case where arrows physically pass through the room.
  //
  // Pass B — nearest-arrow fallback:
  //   If overlapMap has no entry (arrows don't clip this room), find the arrow
  //   across ALL path sets whose tail (x1,y1) is nearest to the user and use
  //   that path set.  This handles rooms that are adjacent to but not overlapped
  //   by any arrow.
  // ===========================================================================
  update(cursorPx, cursorPy) {
    const pos = manualUserPos || { px: cursorPx, py: cursorPy };

    // ── 1. Which room/corridor contains the position? ──
    const foundShape = _findContainingShape(pos.px, pos.py);

    if (!foundShape) {
      _activate(null);
      _updateInfoPanel(null, null);
      return;
    }

    // ── 2. Pass A: overlapMap ──
    let resolvedSet = null;
    const mappedSetIds = overlapMap[foundShape.id] || [];

    if (mappedSetIds.length > 0) {
      // Pick the first mapped set (deterministic; sets are ordered as in JSON).
      resolvedSet = pathSets.find(s => s.id === mappedSetIds[0]) || null;
    }

    // ── 3. Pass B: nearest-arrow fallback ──
    if (!resolvedSet && pathSets.length > 0) {
      let nearDist = Infinity;
      for (const set of pathSets) {
        for (const a of set.arrows) {
          // Test both tail and head distance.
          const dTail = _dist(pos.px, pos.py, a.x1_px, a.y1_px);
          const dHead = _dist(pos.px, pos.py, a.x2_px, a.y2_px);
          const d = Math.min(dTail, dHead);
          if (d < nearDist) { nearDist = d; resolvedSet = set; }
        }
      }
    }

    // ── 4. Activate route and update UI ──
    if (!resolvedSet) {
      _activate(null);
      _updateInfoPanel(foundShape, null);
      setNavStatus(`In: ${foundShape.label || foundShape.id} — no evacuation route found.`);
      return;
    }

    _activate(resolvedSet.id);
    _updateInfoPanel(foundShape, resolvedSet);
    setNavStatus(
      `\u25BA Follow ${resolvedSet.name}` +
      (resolvedSet.exitDoorId ? `  \u2192  Exit: ${resolvedSet.exitDoorId}` : '') +
      '  \u2014  Move toward the glowing arrows.'
    );
  },
};

// =============================================================================
// PART 3 — Rendering
// Draw order: background → dim inactive arrows → active arrows (glow) →
//             shape outlines → guidance line → user marker
// =============================================================================
function redraw() {
  if (!canvas) return;
  context.clearRect(0, 0, canvas.width, canvas.height);

  if (mapImage && mapImage.complete && mapImage.naturalWidth > 0) {
    context.drawImage(mapImage, 0, 0);
  }

  _drawAllArrows();
  _drawShapes();
  _drawGuidanceLine();
  _drawUserMarker();
}

// ── Draw all arrows: glow active set, heavily dim others ─────────────────────
function _drawAllArrows() {
  const hasActive = !!activeSetId;

  for (const set of pathSets) {
    const isActive = set.id === activeSetId;

    for (const a of set.arrows) {
      const hs = a.headSize  || 16;
      const lw = a.lineWidth || 2;

      if (isActive) {
        // Pass 1 — wide pulsing coloured halo.
        // Shadow params go INSIDE _drawArrow (as extra args) — setting them on
        // the outer context is wiped by _drawArrow's own save/restore.
        const pulse = 10 + 8 * Math.sin(glowPhase);
        _drawArrow(
          a.x1_px, a.y1_px, a.x2_px, a.y2_px,
          set.color, hs * 1.6, lw * 3, 0.6,
          set.color, pulse
        );
        // Pass 2 — crisp bright core with white inner glow.
        _drawArrow(
          a.x1_px, a.y1_px, a.x2_px, a.y2_px,
          set.color, hs, lw, 1.0,
          '#ffffff', 4
        );
      } else {
        // Inactive: near-invisible when a route is active, readable otherwise.
        const alpha = hasActive ? 0.07 : 0.75;
        const color = hasActive ? '#555555' : set.color;
        _drawArrow(a.x1_px, a.y1_px, a.x2_px, a.y2_px, color, hs, lw, alpha);
      }
    }
  }
}

// ── Shape outlines (rooms, corridors, doors) ──────────────────────────────────
function _drawShapes() {
  const pos         = manualUserPos || mousePos;
  const activeShape = pos ? _findContainingShape(pos.px, pos.py) : null;
  const activeSet   = pathSets.find(s => s.id === activeSetId);

  for (const s of shapes) {
    if (s.type === 'room' || s.type === 'corridor') {
      if (!s._px || s._px.length < 2) continue;

      const isActiveRoom = !!(activeShape && activeSet && s.id === activeShape.id);

      // Wrap each shape in save/restore so shadow never leaks to next shape.
      context.save();

      let fill, stroke, strokeAlpha;
      if (isActiveRoom) {
        fill        = _hexToRgba(activeSet.color, 0.22);
        stroke      = activeSet.color;
        strokeAlpha = 0.9;
        context.shadowColor = activeSet.color;
        context.shadowBlur  = 14;
      } else {
        fill        = s.type === 'room' ? 'rgba(220,50,50,0.12)' : 'rgba(50,200,50,0.12)';
        stroke      = s.type === 'room' ? '#ff4444' : '#44ff44';
        strokeAlpha = 0.45;
      }

      context.beginPath();
      context.moveTo(s._px[0].px, s._px[0].py);
      s._px.slice(1).forEach(p => context.lineTo(p.px, p.py));
      context.closePath();

      context.fillStyle = fill;
      context.fill();

      context.strokeStyle = stroke;
      context.lineWidth   = isActiveRoom ? 2 : 1;
      context.globalAlpha = strokeAlpha;
      context.stroke();

      context.restore(); // clears shadowColor/shadowBlur/globalAlpha cleanly

    } else if (s.type === 'door' && s._px) {
      context.save();
      context.beginPath();
      context.arc(s._px.px, s._px.py, 5, 0, Math.PI * 2);
      context.fillStyle = s.is_exit ? 'rgba(80,255,80,0.85)' : 'rgba(80,80,255,0.8)';
      context.fill();
      context.restore();
    }
  }
}

// =============================================================================
// PART 4 — Guidance line
// Dashed line from the user position to the nearest arrow TAIL (x1,y1) in the
// active path set that is inside the same room as the user.
// Falls back to the globally nearest arrow tail if none share the room.
// =============================================================================
function _drawGuidanceLine() {
  const pos = manualUserPos || mousePos;
  if (!activeSetId || !pos) return;

  const set = pathSets.find(s => s.id === activeSetId);
  if (!set || set.arrows.length === 0) return;

  // Find nearest arrow tail in this set.
  // Prefer arrows whose tail is in the same room as the user.
  const userShape = _findContainingShape(pos.px, pos.py);

  let nearest  = null;
  let nearDist = Infinity;

  for (const a of set.arrows) {
    // Give a bonus to arrows whose tail room matches the user's room.
    const tailRoom = _findContainingShape(a.x1_px, a.y1_px);
    const inSameRoom = userShape && tailRoom && tailRoom.id === userShape.id;

    const d = _dist(pos.px, pos.py, a.x1_px, a.y1_px);
    // Apply a strong discount for same-room arrows so they win.
    const effective = inSameRoom ? d * 0.01 : d;

    if (effective < nearDist) { nearDist = effective; nearest = a; }
  }
  if (!nearest) return;

  const tx = nearest.x1_px;
  const ty = nearest.y1_px;

  // Dashed line: user → arrow tail
  context.save();
  context.setLineDash([6, 5]);
  context.lineWidth   = 1.5;
  context.strokeStyle = '#ffffff';
  context.globalAlpha = 0.5;
  context.shadowColor = '#ffffff';
  context.shadowBlur  = 5;
  context.beginPath();
  context.moveTo(pos.px, pos.py);
  context.lineTo(tx, ty);
  context.stroke();
  context.restore();

  // Destination ring at the arrow tail
  context.save();
  context.beginPath();
  context.arc(tx, ty, 6, 0, Math.PI * 2);
  context.strokeStyle = set.color;
  context.lineWidth   = 2;
  context.shadowColor = set.color;
  context.shadowBlur  = 10;
  context.stroke();
  context.restore();

  // Distance label at midpoint
  const mx    = (pos.px + tx) / 2;
  const my    = (pos.py + ty) / 2 - 10;
  const distM = (_dist(pos.px, pos.py, tx, ty) * _getPxToM()).toFixed(1);
  context.save();
  context.font        = '11px monospace';
  context.fillStyle   = '#ffffff';
  context.globalAlpha = 0.65;
  context.fillText(`${distM}m`, mx, my);
  context.restore();
}

// ── User position marker ───────────────────────────────────────────────────────
function _drawUserMarker() {
  const pos = manualUserPos || mousePos;
  if (!pos || (!manualUserPos && pos.px === 0 && pos.py === 0)) return;

  context.save();
  context.shadowColor = '#00e5ff';
  context.shadowBlur  = 16;
  context.beginPath();
  context.arc(pos.px, pos.py, manualUserPos ? 8 : 4, 0, Math.PI * 2);
  context.fillStyle   = '#00e5ff';
  context.globalAlpha = manualUserPos ? 1.0 : 0.7;
  context.fill();
  context.restore();

  // Pinned: draw a second outer ring to make it unmistakable
  if (manualUserPos) {
    context.save();
    context.beginPath();
    context.arc(pos.px, pos.py, 13, 0, Math.PI * 2);
    context.strokeStyle = '#00e5ff';
    context.lineWidth   = 1.5;
    context.globalAlpha = 0.35;
    context.stroke();
    context.restore();
  }
}

// =============================================================================
// PART 5 — Glow animation loop
// Runs only while a route is active.
// =============================================================================
function _startGlow() {
  if (animFrameId) return;
  function tick() {
    glowPhase   = (glowPhase + 0.07) % (Math.PI * 2);
    redraw();
    animFrameId = requestAnimationFrame(tick);
  }
  animFrameId = requestAnimationFrame(tick);
}

function _stopGlow() {
  if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
  glowPhase = 0;
  redraw();
}

// Activate a path set by id (pass null to deactivate).
function _activate(setId) {
  activeSetId = setId;
  if (!setId) { _stopGlow(); return; }
  _startGlow();
}

// =============================================================================
// PART 6 — Event handlers
// =============================================================================
function onMouseMove(e) {
  const rect   = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / rect.width;
  const scaleY = canvas.height / rect.height;

  mousePos = {
    px: (e.clientX - rect.left) * scaleX,
    py: (e.clientY - rect.top)  * scaleY,
  };

  // Update position cell
  const m = _getPxToM();
  const H = _getImgH();
  const el = document.getElementById('cell-pos');
  if (el) {
    el.textContent =
      `${Math.round(mousePos.px)}px, ${Math.round(mousePos.py)}px` +
      `  /  ${(mousePos.px * m).toFixed(1)}m, ${((H - mousePos.py) * m).toFixed(1)}m`;
  }

  // Drive navigation only if route map is built and user is not pinned
  if (!manualUserPos && nav.arrowGraph) {
    nav.update(mousePos.px, mousePos.py);
  } else if (!animFrameId) {
    redraw();
  }
}

function onMouseLeave() {
  if (!manualUserPos && !animFrameId) redraw();
}

function onKeyDown(e) {
  if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;

  if (e.key === 'p' || e.key === 'P') {
    const hint = document.getElementById('pin-hint');

    if (manualUserPos) {
      // Unpin
      unpinUser();
    } else {
      // Pin at current cursor position
      manualUserPos = { px: mousePos.px, py: mousePos.py };

// ALWAYS resolve the exact room/corridor immediately
const pinnedShape = _findContainingShape(manualUserPos.px, manualUserPos.py);

// Update UI regardless of route existence
_updateInfoPanel(pinnedShape, null);

// Then resolve navigation (routes, glow, etc.)
if (nav.arrowGraph) {
  nav.update(manualUserPos.px, manualUserPos.py);
}
      if (hint) {
        hint.classList.add('pinned');
        hint.innerHTML =
          '&#128205; Pinned (' +
          Math.round(manualUserPos.px) + ', ' +
          Math.round(manualUserPos.py) +
          ') &mdash; <kbd>P</kbd> to unpin';
      }
    }
  }
}

// =============================================================================
// PART 7 — Info panel update
// Reads every available field from the shape and path-set objects and
// populates the HTML panel cells.
// =============================================================================
function _updateInfoPanel(shape, set) {
  // ── Room / shape card ──
  _setText('cell-room',
    shape ? (shape.label || shape.id) : '—',
    !shape
  );
  _setText('cell-room-id',   shape ? shape.id   : '—', !shape);
  _setText('cell-room-type', shape ? shape.type  : '—', !shape);

  // Connected doors: may be an array of ids or absent
  const doors = shape?.connected_doors;
  _setText('cell-room-doors',
    !shape          ? '—'         :
    !doors          ? 'none'      :
    Array.isArray(doors) && doors.length > 0
      ? doors.join(', ')
      : 'none',
    !shape
  );

  // evacuation_route_color field on the shape itself (may differ from active set)
  const shapeRouteCol = shape?.evacuation_route_color;
  _setText('cell-room-routecol',
    !shape        ? '—'           :
    shapeRouteCol ? shapeRouteCol : 'unassigned',
    !shape
  );

  // ── Route / path-set card ──
  const swatch = document.getElementById('cell-route-swatch');
  if (swatch) swatch.style.background = set ? set.color : '#333';

  _setText('cell-route-name',      set ? set.name                        : '—', !set);
  _setText('cell-route-id',        set ? set.id                          : '—', !set);
  _setText('cell-exit',            set ? (set.exitDoorId || 'none')      : '—', !set);
  _setText('cell-arrow-count',     set ? String(set.arrows?.length ?? 0) : '—', !set);
  _setText('cell-route-color-hex', set ? set.color                       : '—', !set);

  // Flash updated cells to draw attention
  ['cell-room', 'cell-route-name', 'cell-exit'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('flash');
    void el.offsetWidth; // force reflow to restart animation
    el.classList.add('flash');
  });
}

// Helper: set text content and optionally add/remove the 'muted' class
function _setText(id, text, muted = false) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('muted', muted);
}

function setNavStatus(msg) {
  const el = document.getElementById('nav-status-bar');
  if (el) el.textContent = msg;
}

function setLoadStatus(msg, cls) {
  const el = document.getElementById('load-status');
  if (!el) return;
  el.textContent = msg;
  el.className   = cls || '';
}

// =============================================================================
// PART 8 — Geometry helpers
// =============================================================================

// Ray-casting point-in-polygon, pixel space ({ px, py } point array)
function _pointInPolygonPx(x, y, pxPoints) {
  if (!pxPoints || pxPoints.length < 3) return false;
  let inside = false;
  const n    = pxPoints.length;
  let j      = n - 1;
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

// Return the first room/corridor shape that contains the pixel point (px, py).
function _findContainingShape(px, py) {
  for (const s of shapes) {
    if (
      (s.type === 'room' || s.type === 'corridor') &&
      s._px &&
      _pointInPolygonPx(px, py, s._px)
    ) {
      return s;
    }
  }
  return null;
}

function _dist(ax, ay, bx, by) {
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
}

function _getPxToM() {
  return mapData?.meta?.px_to_m
    || mapData?.arrowPaths?.meta?.px_to_m
    || PX_TO_M_DEFAULT;
}

function _getImgH() {
  return mapData?.meta?.image_height_px
    || mapData?.arrowPaths?.meta?.image_height_px
    || IMG_H_PX_DEFAULT;
}

// =============================================================================
// PART 9 — Arrow drawing primitive
// =============================================================================
// shadowColor/shadowBlur MUST be passed inside the save/restore block —
// setting them on the outer context before calling this is wiped by restore().
function _drawArrow(x1, y1, x2, y2, color, headSize, lineWidth, alpha,
                    shadowColor, shadowBlur) {
  const dx  = x2 - x1;
  const dy  = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 2) return;

  const ux    = dx / len;
  const uy    = dy / len;
  const baseX = x2 - ux * headSize;
  const baseY = y2 - uy * headSize;
  const wingX = -uy * headSize * 0.55;
  const wingY =  ux * headSize * 0.55;

  context.save();
  context.globalAlpha = alpha;
  context.strokeStyle = color;
  context.fillStyle   = color;
  context.lineWidth   = lineWidth;
  context.lineCap     = 'round';
  if (shadowColor) {
    context.shadowColor = shadowColor;
    context.shadowBlur  = shadowBlur || 0;
  }

  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(baseX, baseY);
  context.stroke();

  context.beginPath();
  context.moveTo(x2, y2);
  context.lineTo(baseX + wingX, baseY + wingY);
  context.lineTo(baseX - wingX, baseY - wingY);
  context.closePath();
  context.fill();

  context.restore();
}

function _hexToRgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}