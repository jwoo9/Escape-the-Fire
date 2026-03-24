// ─── Config ───────────────────────────────────────────────────────────────────
const IMAGE_SRC   = 'Main_Annotated_Simple.png';
const PX_TO_M     = 0.11;          // 1 pixel = 0.11 metres
const IMG_HEIGHT  = 524;           // used to flip Y axis (origin = bottom-left)

// ─── State ────────────────────────────────────────────────────────────────────
let canvas, ctx, img;
let mode          = 'room';        // 'room' | 'corridor' | 'door' | 'barrier'
let currentPoints = [];            // points being drawn for the active shape
let shapes        = [];            // all finished shapes
let idCounter     = { room: 0, corridor: 0, door: 0, barrier: 0 };

const COLOURS = {
  room:     'rgba(220, 50,  50,  0.4)',
  corridor: 'rgba(50,  200, 50,  0.4)',
  door:     'rgba(80,  80,  255, 0.9)',
  barrier:  'rgba(255, 140, 0,   0.9)',
};
const STROKE = {
  room:     '#ff4444',
  corridor: '#44ff44',
  door:     '#4444ff',
  barrier:  '#ff8800',
};

// ─── Coordinate helpers ───────────────────────────────────────────────────────
/** pixel → real-world metres (origin bottom-left) */
function pxToWorld(px, py) {
  return {
    x: parseFloat((px * PX_TO_M).toFixed(3)),
    y: parseFloat(((IMG_HEIGHT - py) * PX_TO_M).toFixed(3)),
  };
}

/** real-world metres → pixel */
function worldToPx(wx, wy) {
  return {
    px: wx / PX_TO_M,
    py: IMG_HEIGHT - wy / PX_TO_M,
  };
}

// ─── Init ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  canvas = document.getElementById('mapCanvas');
  ctx    = canvas.getContext('2d');

  img = new Image();
  img.src = IMAGE_SRC;
  img.onload = () => {
    canvas.width  = img.width;
    canvas.height = img.height;
    redraw();
  };
  img.onerror = () => console.error(`Could not load image: ${IMAGE_SRC}`);

  canvas.addEventListener('click',     onCanvasClick);
  canvas.addEventListener('mousemove', onMouseMove);
});

// ─── Mode switching ───────────────────────────────────────────────────────────
function setMode(newMode) {
  mode          = newMode;
  currentPoints = [];
  updateStatus();
  redraw();
}

// ─── Mouse events ─────────────────────────────────────────────────────────────
let mousePos = { x: 0, y: 0 };

function onMouseMove(e) {
  const r  = canvas.getBoundingClientRect();
  mousePos = { x: e.clientX - r.left, y: e.clientY - r.top };
  redraw();
}

function onCanvasClick(e) {
  const r  = canvas.getBoundingClientRect();
  const px = e.clientX - r.left;
  const py = e.clientY - r.top;

  if (mode === 'door') {
    // Doors are single-point — save immediately
    const world = pxToWorld(px, py);
    shapes.push({
      id:       `door_${++idCounter.door}`,
      type:     'door',
      position: world,
      pixel:    { px, py },
      is_exit:  false,
      connects: [],
    });
    updateStatus(`Door placed at (${world.x}m, ${world.y}m)`);
    redraw();
    return;
  }

  if (mode === 'barrier') {
    currentPoints.push({ px, py, ...pxToWorld(px, py) });
    if (currentPoints.length === 2) {
      // Barriers are two-point lines — save when second point placed
      shapes.push({
        id:    `barrier_${++idCounter.barrier}`,
        type:  'barrier',
        start: { x: currentPoints[0].x, y: currentPoints[0].y },
        end:   { x: currentPoints[1].x, y: currentPoints[1].y },
        _px:   [...currentPoints],
      });
      currentPoints = [];
      updateStatus('Barrier saved. Click to start another.');
    } else {
      updateStatus('Barrier: click second point to complete line.');
    }
    redraw();
    return;
  }

  // room / corridor — accumulate polygon points
  currentPoints.push({ px, py, ...pxToWorld(px, py) });
  updateStatus(`${mode}: ${currentPoints.length} point(s). Close Shape when done.`);
  redraw();
}

// ─── Close polygon ────────────────────────────────────────────────────────────
function closePolygon() {
  if ((mode === 'room' || mode === 'corridor') && currentPoints.length >= 3) {
    const polygon = currentPoints.map(p => ({ x: p.x, y: p.y }));
    shapes.push({
      id:      `${mode}_${++idCounter[mode]}`,
      type:    mode,
      label:   `${mode} ${idCounter[mode]}`,
      polygon,
      _px:     [...currentPoints],   // keep pixel coords for drawing
      evacuation_route_color: null,
      connected_doors:        [],
    });
    currentPoints = [];
    updateStatus(`${mode} saved! Start a new shape or switch mode.`);
    redraw();
  } else {
    updateStatus('Need at least 3 points to close a polygon.');
  }
}

// ─── Undo ─────────────────────────────────────────────────────────────────────
function undoLast() {
  if (currentPoints.length > 0) {
    currentPoints.pop();
  } else {
    shapes.pop();
  }
  redraw();
  updateStatus('Undone.');
}

// ─── Draw ─────────────────────────────────────────────────────────────────────
function redraw() {
  if (!img.complete) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);

  // Draw finished shapes
  for (const s of shapes) {
    if (s.type === 'room' || s.type === 'corridor') {
      drawPolygon(s._px, COLOURS[s.type], STROKE[s.type]);
    } else if (s.type === 'door') {
      drawDot(s.pixel.px, s.pixel.py, COLOURS.door);
    } else if (s.type === 'barrier') {
      drawLine(s._px[0], s._px[1], STROKE.barrier);
    }
  }

  // Draw in-progress shape
  if (currentPoints.length > 0) {
    const preview = [...currentPoints, { px: mousePos.x, py: mousePos.y }];
    drawPolygon(preview, COLOURS[mode], STROKE[mode], /* close= */ false);
    currentPoints.forEach(p => drawDot(p.px, p.py, STROKE[mode], 4));
  }
}

function drawPolygon(points, fill, stroke, close = true) {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0].px, points[0].py);
  points.slice(1).forEach(p => ctx.lineTo(p.px, p.py));
  if (close) ctx.closePath();
  ctx.fillStyle   = fill;
  if (close) ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth   = 2;
  ctx.stroke();
}

function drawDot(px, py, colour, radius = 6) {
  ctx.beginPath();
  ctx.arc(px, py, radius, 0, Math.PI * 2);
  ctx.fillStyle = colour;
  ctx.fill();
}

function drawLine(p1, p2, colour) {
  ctx.beginPath();
  ctx.moveTo(p1.px, p1.py);
  ctx.lineTo(p2.px, p2.py);
  ctx.strokeStyle = colour;
  ctx.lineWidth   = 3;
  ctx.stroke();
}

// ─── Export / Import ──────────────────────────────────────────────────────────
function exportData() {

    // This downloads the map data containing coordinates (in pixels) of all the points defining rooms, doors, corridors

  // Strip internal _px fields before saving
  const clean = shapes.map(({ _px, pixel, ...rest }) => rest);
  const blob  = new Blob([JSON.stringify({ shapes: clean }, null, 2)],
                         { type: 'application/json' });
  const a     = document.createElement('a');
  a.href      = URL.createObjectURL(blob);
  a.download  = 'map_data.json';
  a.click();
}

function importData() {   
    
    // This can be used to import data in (i.e. importing data will auto-add shapes to the map. 
    // This should be used to make necessary edits to the map data boundaries, doors, etc.


  const input    = document.createElement('input');
  input.type     = 'file';
  input.accept   = '.json';
  input.onchange = e => {
    const reader = new FileReader();
    reader.onload = ev => {
      const data = JSON.parse(ev.target.result);
      // Rehydrate pixel coordinates from world coords for rendering
      shapes = data.shapes.map(s => {
        if (s.type === 'room' || s.type === 'corridor') {
          s._px = s.polygon.map(p => ({ px: p.x / PX_TO_M, py: IMG_HEIGHT - p.y / PX_TO_M }));
        } else if (s.type === 'door') {
          s.pixel = worldToPx(s.position.x, s.position.y);
        } else if (s.type === 'barrier') {
          s._px = [worldToPx(s.start.x, s.start.y), worldToPx(s.end.x, s.end.y)]
                    .map(p => ({ px: p.px, py: p.py }));
        }
        return s;
      });
      redraw();
    };
    reader.readAsText(e.target.files[0]);
  };
  input.click();
}

// ─── Positioning (runtime use) ────────────────────────────────────────────────
/** Point-in-polygon ray casting — pass world coords */
function pointInPolygon(wx, wy, polygon) {
  let inside = false;
  const n    = polygon.length;
  let j      = n - 1;
  for (let i = 0; i < n; i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = (yi > wy) !== (yj > wy)
      && wx < ((xj - xi) * (wy - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
    j = i;
  }
  return inside;
}

/** Given a world position, return which room/corridor contains it */
function getLocation(wx, wy) {
  for (const s of shapes) {
    if ((s.type === 'room' || s.type === 'corridor') && s.polygon) {
      if (pointInPolygon(wx, wy, s.polygon)) return s;
    }
  }
  return null;
}

// ─── Status bar ───────────────────────────────────────────────────────────────
function updateStatus(msg) {
  document.getElementById('status').textContent =
    msg ?? `Mode: ${mode} | Click to place points | Close Shape to finish polygon`;
}