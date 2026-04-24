/**
 * FloorMap.tsx
 *
 * - Clean SVG map (no background image) — rooms drawn as labelled polygons
 * - Fits entire floor on screen by default (zoomed out)
 * - Working zone tap selection (pan/pinch/tap gesture fix)
 * - Emergency mode: shows A* evacuation arrows
 * - Blocked zones: red highlight + fire emoji
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import {
  Gesture, GestureDetector
} from 'react-native-gesture-handler';
import Animated, {
  Easing, runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat, withSequence, withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, G, Path, Polygon, Rect, Text as SvgText } from 'react-native-svg';

import { FloorData, MapPoint, ZONE_TO_NODES } from '../constants/mapData';

const SCREEN = Dimensions.get('window');

interface StaffDot { uid: string; svgX: number; svgY: number; initials: string }

interface FloorMapProps {
  floor:             FloorData;
  userPosition?:     { svgX: number; svgY: number } | null;
  allStaff?:         StaffDot[];
  blockedZoneIds?:   string[];
  isEmergency?:      boolean;
  isAdmin?:          boolean;
  onZoneTap?:        (zoneId: string, zoneLabel: string) => void;
}

// ─── Arrow ────────────────────────────────────────────────────────────────────
function Arrow({ x1, y1, x2, y2, color }: { x1:number; y1:number; x2:number; y2:number; color:string }) {
  const dx = x2-x1, dy = y2-y1, len = Math.sqrt(dx*dx+dy*dy);
  if (len < 2) return null;
  const ux = dx/len, uy = dy/len, h = 15;
  return (
    <Path
      d={`M${x1},${y1}L${x2},${y2}M${x2},${y2}L${x2-h*ux+h*0.45*uy},${y2-h*uy-h*0.45*ux}M${x2},${y2}L${x2-h*ux-h*0.45*uy},${y2-h*uy+h*0.45*ux}`}
      stroke={color} strokeWidth={4} strokeLinecap="round" fill="none"
    />
  );
}

// ─── Pulsing user dot ─────────────────────────────────────────────────────────
function UserDot({ x, y, scale }: { x:number; y:number; scale:number }) {
  const pulse   = useSharedValue(0);
  const opacity = useSharedValue(0);
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    pulse.value = withDelay(300, withRepeat(
      withSequence(
        withTiming(1, { duration: 800, easing: Easing.out(Easing.ease) }),
        withTiming(0, { duration: 800, easing: Easing.in(Easing.ease) }),
      ), -1, false,
    ));
    opacity.value = withTiming(1, { duration: 250 });
  }, []);

  const ringStyle = useAnimatedStyle(() => ({
    position: 'absolute' as const,
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(37,99,235,0.25)',
    opacity: pulse.value * 0.85,
    transform: [{ scale: 1 + pulse.value * 0.65 }],
    left: x * scale - 19, top: y * scale - 19,
    pointerEvents: 'none' as const,
  }));

  const dotStyle = useAnimatedStyle(() => ({
    position: 'absolute' as const,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: '#2563eb',
    borderWidth: 3, borderColor: '#ffffff',
    shadowColor: '#1d4ed8', shadowOffset: { width:0, height:2 },
    shadowOpacity: 0.6, shadowRadius: 6, elevation: 8,
    opacity: opacity.value,
    left: x * scale - 9, top: y * scale - 9,
    pointerEvents: 'none' as const,
  }));

  return (
    <>
      <Animated.View style={ringStyle} />
      <Animated.View style={dotStyle} />
    </>
  );
}

// ─── Point-in-polygon ─────────────────────────────────────────────────────────
function pointInPoly(px: number, py: number, pts: MapPoint[]): boolean {
  let inside = false;
  const n = pts.length;
  let j = n - 1;
  for (let i = 0; i < n; i++) {
    const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
    if ((yi > py) !== (yj > py) && px < ((xj-xi)*(py-yi))/(yj-yi)+xi) inside = !inside;
    j = i;
  }
  return inside;
}

// ─── A* pathfinding ───────────────────────────────────────────────────────────
function findEvacPath(
  startX: number, startY: number,
  floor: FloorData,
  blockedZoneIds: string[],
): Array<{ x:number; y:number }> {
  if (!floor.navGraph || floor.navGraph.length === 0) return [];

  const blockedNodes = new Set<string>();
  blockedZoneIds.forEach(zid => {
    const nodes = ZONE_TO_NODES[zid];
    if (nodes) nodes.forEach(n => blockedNodes.add(n));
  });

  const nodeMap = new Map(floor.navGraph.map(n => [n.id, n]));

  // Nearest non-blocked nav node to user
  let startNode = floor.navGraph[0];
  let bestDist = Infinity;
  for (const node of floor.navGraph) {
    if (blockedNodes.has(node.id)) continue;
    const d = Math.hypot(node.x - startX, node.y - startY);
    if (d < bestDist) { bestDist = d; startNode = node; }
  }

  // Exit node IDs
  const exitNodeIds = new Set<string>();
  for (const exit of floor.exits) {
    let nearest = floor.navGraph[0]; let nd = Infinity;
    for (const node of floor.navGraph) {
      if (blockedNodes.has(node.id)) continue;
      const d = Math.hypot(node.x - exit.x, node.y - exit.y);
      if (d < nd) { nd = d; nearest = node; }
    }
    exitNodeIds.add(nearest.id);
  }
  if (exitNodeIds.size === 0) return [];

  const h = (id: string) => {
    const n = nodeMap.get(id); if (!n) return 9999;
    let best = 9999;
    exitNodeIds.forEach(eid => { const e = nodeMap.get(eid); if (e) best = Math.min(best, Math.hypot(n.x-e.x, n.y-e.y)); });
    return best;
  };

  type Entry = { id:string; g:number; f:number };
  const open: Entry[] = [{ id: startNode.id, g:0, f: h(startNode.id) }];
  const gScore = new Map<string,number>([[startNode.id, 0]]);
  const parent = new Map<string, string|null>([[startNode.id, null]]);
  const closed = new Set<string>();

  while (open.length > 0) {
    open.sort((a,b) => a.f - b.f);
    const curr = open.shift()!;
    if (exitNodeIds.has(curr.id)) {
      const path: Array<{x:number;y:number}> = [];
      let cid: string|null = curr.id;
      while (cid !== null) {
        const n = nodeMap.get(cid)!;
        path.unshift({ x: n.x, y: n.y });
        cid = parent.get(cid) ?? null;
      }
      path.unshift({ x: startX, y: startY });
      return path;
    }
    closed.add(curr.id);
    const currNode = nodeMap.get(curr.id); if (!currNode) continue;
    for (const nid of currNode.neighbors) {
      if (closed.has(nid) || blockedNodes.has(nid)) continue;
      const neighbor = nodeMap.get(nid); if (!neighbor) continue;
      const tentG = (gScore.get(curr.id) ?? 0) + Math.hypot(neighbor.x-currNode.x, neighbor.y-currNode.y);
      if (tentG < (gScore.get(nid) ?? Infinity)) {
        gScore.set(nid, tentG);
        parent.set(nid, curr.id);
        open.push({ id: nid, g: tentG, f: tentG + h(nid) });
      }
    }
  }
  return [];
}

function centroid(pts: MapPoint[]) {
  return {
    cx: pts.reduce((s,p) => s+p.x, 0) / pts.length,
    cy: pts.reduce((s,p) => s+p.y, 0) / pts.length,
  };
}

// ─── FloorMap ─────────────────────────────────────────────────────────────────
export default function FloorMap({
  floor,
  userPosition,
  allStaff = [],
  blockedZoneIds = [],
  isEmergency = false,
  isAdmin = false,
  onZoneTap,
}: FloorMapProps) {
  const containerW = SCREEN.width;

  // Scale SVG to fit screen width, then compute a scale so the full floor fits
  const svgNativeW = containerW;
  const svgNativeH = containerW * (floor.viewBoxH / floor.viewBoxW);
  const svgScale   = svgNativeW / floor.viewBoxW;   // px per SVG unit

  // Fit entire floor on screen initially
  const mapContainerH = SCREEN.height * 0.65; // Approximate map viewport height
  const FIT_S = Math.min(
    containerW / svgNativeW,
    mapContainerH / svgNativeH,
  ) * 0.95; // 0.95 adds a small inner padding so it doesn't touch edges
  const INIT_S  = FIT_S;
  const MIN_S   = FIT_S * 0.8;
  const MAX_S   = 4;

  // Strict clamping to lock the map inside the screen boundaries
  const clampX = (v: number, s: number) => {
    'worklet';
    const mapW = svgNativeW * s;
    const offset = (svgNativeW - mapW) / 2;
    if (mapW <= containerW) return (containerW - mapW) / 2 - offset; // Center exactly if smaller
    const visualX = v + offset;
    return Math.max(containerW - mapW, Math.min(0, visualX)) - offset;
  };
  const clampY = (v: number, s: number) => {
    'worklet';
    const mapH = svgNativeH * s;
    const offset = (svgNativeH - mapH) / 2;
    if (mapH <= mapContainerH) return (mapContainerH - mapH) / 2 - offset; // Center exactly if smaller
    const visualY = v + offset;
    return Math.max(mapContainerH - mapH, Math.min(0, visualY)) - offset;
  };

  const focusX  = userPosition?.svgX ?? floor.viewBoxW * 0.5;
  const focusY  = userPosition?.svgY ?? floor.viewBoxH * 0.5;
  const iTxRaw = containerW / 2 - (focusX * svgScale - svgNativeW / 2) * INIT_S - svgNativeW / 2;
  const iTyRaw = mapContainerH / 2 - (focusY * svgScale - svgNativeH / 2) * INIT_S - svgNativeH / 2;

  // Lock the map before the first frame even renders
  const iTx = clampX(iTxRaw, INIT_S);
  const iTy = clampY(iTyRaw, INIT_S);

  const sc  = useSharedValue(INIT_S);
  const tx  = useSharedValue(iTx);
  const ty  = useSharedValue(iTy);
  
  // Gesture sync state
  const savedTx = useSharedValue(iTx);
  const savedTy = useSharedValue(iTy);
  const savedScale = useSharedValue(INIT_S);
  const originFocalX = useSharedValue(0);
  const originFocalY = useSharedValue(0);
  const isPinching = useSharedValue(false);

  const [tappedZoneId, setTappedZoneId] = useState<string|null>(null);

  const fireTap = useCallback((ex: number, ey: number, currentTx: number, currentTy: number, currentSc: number) => {
    if (!onZoneTap) return;
    
    const mapX_px = (ex - currentTx - svgNativeW / 2) / currentSc + svgNativeW / 2;
    const mapY_px = (ey - currentTy - svgNativeH / 2) / currentSc + svgNativeH / 2;
    const svgX = mapX_px / svgScale;
    const svgY = mapY_px / svgScale;

    for (const shape of floor.shapes) {
      if (pointInPoly(svgX, svgY, shape.points)) {
        setTappedZoneId(shape.id);
        setTimeout(() => setTappedZoneId(null), 600); // Flash color for 600ms
        onZoneTap(shape.id, shape.label);
        return;
      }
    }
  }, [onZoneTap, floor.shapes, svgScale, svgNativeW, svgNativeH]);

  // ── Gestures ──────────────────────────────────────────────────────────────
  const pan = Gesture.Pan()
    .minPointers(1)
    .maxPointers(2)
    .activeOffsetX([-10, 10]) // Hijack gestures but allow slight finger movements for taps
    .activeOffsetY([-10, 10])
    .onStart(() => {
      if (isPinching.value) return;
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    })
    .onUpdate(e => {
      if (isPinching.value) return;
      tx.value = clampX(savedTx.value + e.translationX, sc.value);
      ty.value = clampY(savedTy.value + e.translationY, sc.value);
    });

  const pinch = Gesture.Pinch()
    .onStart((e) => {
      isPinching.value = true;
      savedScale.value = sc.value;
      savedTx.value = tx.value;
      savedTy.value = ty.value;
      originFocalX.value = e.focalX;
      originFocalY.value = e.focalY;
    })
    .onUpdate((e) => {
      const nextScale = Math.min(MAX_S, Math.max(MIN_S, savedScale.value * e.scale));
      
      // Compensate for center scaling to zoom strictly into the focal point
      const mapX_offset = (originFocalX.value - savedTx.value - svgNativeW/2) / savedScale.value;
      const nextTx = e.focalX - mapX_offset * nextScale - svgNativeW/2;
      
      const mapY_offset = (originFocalY.value - savedTy.value - svgNativeH/2) / savedScale.value;
      const nextTy = e.focalY - mapY_offset * nextScale - svgNativeH/2;

      sc.value = nextScale;
      tx.value = clampX(nextTx, nextScale);
      ty.value = clampY(nextTy, nextScale);
    })
    .onEnd(() => {
      isPinching.value = false;
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    });

  // Use a manual tap via onStart/onEnd on a separate Tap gesture
  const tap = Gesture.Tap()
    .maxDuration(500)
    .maxDistance(40) // Extremely forgiving tap distance for sloppy touches
    .onEnd((e) => {
      // Pass live values from UI thread to JS thread safely
      runOnJS(fireTap)(e.x, e.y, tx.value, ty.value, sc.value);
    });

  // Evaluate all gestures together so panning doesn't swallow the tap
  const composed = Gesture.Simultaneous(pinch, pan, tap);

  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: sc.value },
    ],
  }));

  // ── Evacuation path ───────────────────────────────────────────────────────
  const evacPath = (isEmergency && userPosition)
    ? findEvacPath(userPosition.svgX, userPosition.svgY, floor, blockedZoneIds)
    : [];

  const displayPos = userPosition ?? { svgX: focusX, svgY: focusY };

  // ── Zone colors ───────────────────────────────────────────────────────────
  const roomFill = (id: string, type: string) => {
    if (id === tappedZoneId) return 'rgba(251,146,60,0.6)'; // Flash bright orange on tap
    if (blockedZoneIds.includes(id)) return 'rgba(239,68,68,0.35)';
    return type === 'room' ? '#1e3a5f' : '#162032';
  };

  const roomStroke = (id: string, type: string) => {
    if (blockedZoneIds.includes(id)) return '#ef4444';
    return '#334155';
  };

  const roomStrokeW = (id: string, type: string) => {
    if (blockedZoneIds.includes(id)) return 2.5;
    return 1;
  };

  return (
    <View style={s.container}>
      <GestureDetector gesture={composed}>
        <View style={StyleSheet.absoluteFill}>
          <Animated.View style={[{ width: svgNativeW, height: svgNativeH }, animStyle]}>

            <Svg
              width={svgNativeW}
              height={svgNativeH}
              viewBox={`0 0 ${floor.viewBoxW} ${floor.viewBoxH}`}
              style={{ position: 'absolute' }}
            >
              {/* Dark background */}
              <Rect
                width={floor.viewBoxW} height={floor.viewBoxH}
                fill="#0f172a"
                stroke="#334155"
                strokeWidth={8}
              />

              {/* Room / corridor shapes */}
              {floor.shapes.map(shape => {
                const blocked   = blockedZoneIds.includes(shape.id);
                const pts       = shape.points.map(p => `${p.x},${p.y}`).join(' ');
                const { cx, cy } = centroid(shape.points);
                const isRoom    = shape.type === 'room';

                return (
                  <G key={shape.id}>
                    <Polygon
                      points={pts}
                      fill={roomFill(shape.id, shape.type)}
                      stroke={roomStroke(shape.id, shape.type)}
                      strokeWidth={roomStrokeW(shape.id, shape.type)}
                    />

                    {/* Room labels — always shown */}
                    {isRoom && (
                      <SvgText
                        x={cx} y={cy + 2.5}
                        textAnchor="middle"
                        fontSize={7}
                        fontWeight="600"
                        fill={blocked ? '#fca5a5' : '#94a3b8'}
                        stroke="rgba(0,0,0,0.4)"
                        strokeWidth={0.3}
                      >
                        {shape.label}
                      </SvgText>
                    )}

                    {/* Fire emoji on blocked zones */}
                    {blocked && (
                      <SvgText x={cx} y={cy - 9} textAnchor="middle" fontSize={16}>🔥</SvgText>
                    )}

                  </G>
                );
              })}

              {/* Exit markers */}
              {floor.exits.map(exit => (
                <G key={exit.id}>
                  <Circle cx={exit.x} cy={exit.y} r={7} fill="#22c55e" stroke="#fff" strokeWidth={2.5} />
                  <SvgText x={exit.x} y={exit.y-11} textAnchor="middle" fontSize={6} fontWeight="800"
                    fill="#ffffff" stroke="rgba(0,0,0,0.4)" strokeWidth={0.3}>
                    EXIT
                  </SvgText>
                </G>
              ))}

              {/* Evacuation route */}
              {evacPath.length > 1 && evacPath.slice(0, -1).map((pt, i) => {
                const next = evacPath[i + 1];
                return (
                  <Arrow key={`evac-${i}`}
                    x1={pt.x} y1={pt.y} x2={next.x} y2={next.y}
                    color="#38bdf8"
                  />
                );
              })}

              {/* Staff dots — admin emergency view */}
              {isAdmin && allStaff.filter(s => s.svgX && s.svgY).map(s => (
                <G key={s.uid}>
                  <Circle cx={s.svgX} cy={s.svgY} r={10} fill="#8b5cf6" stroke="#fff" strokeWidth={2.5} />
                  <SvgText x={s.svgX} y={s.svgY+4} textAnchor="middle" fontSize={6} fontWeight="bold" fill="#fff">
                    {s.initials}
                  </SvgText>
                </G>
              ))}
            </Svg>

            {/* User position dot */}
            <UserDot
              x={displayPos.svgX}
              y={displayPos.svgY}
              scale={svgScale}
            />

          </Animated.View>
        </View>
      </GestureDetector>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: '#0f172a',
  },
});