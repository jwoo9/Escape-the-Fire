/**
 * BuildingMap Component
 * 
 * Renders the building floor plan as SVG with:
 *   - Rooms (blue polygons) and corridors (green polygons)
 *   - Doors (circles, green for exits)
 *   - Barriers (gray lines)
 *   - Pre-determined arrow path sets (colored arrows leading to exits)
 *   - Active path set highlighted/glowing, inactive sets dimmed
 *   - Guidance dashed line from user to nearest arrow in active set
 *   - User position (blue dot)
 *   - Hazard markers (fire icons)
 *   - Other users (admin view)
 */

import React, { useMemo } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Svg, {
  Polygon,
  Circle,
  Line,
  Polyline,
  G,
  Text as SvgText,
  Rect,
  Path,
} from 'react-native-svg';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const MAP_PADDING = 10;

export default function BuildingMap({
  mapData,
  userPosition = null,
  activePathSet = null,       // The resolved path set to highlight
  nearestArrow = null,        // Nearest arrow in active set (for guidance line)
  hazards = [],
  otherUsers = [],
  showLabels = true,
}) {
  const shapes = mapData?.shapes || [];
  const arrowPaths = mapData?.arrowPaths || {};
  const pathSets = arrowPaths.pathSets || [];
  const meta = arrowPaths.meta || {};
  const pxToM = meta.px_to_m || 0.11;
  const imgH = meta.image_height_px || 524;

  // Calculate bounds from shapes
  const bounds = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of shapes) {
      if (s.polygon) {
        for (const p of s.polygon) {
          minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
        }
      }
      if (s.position) {
        minX = Math.min(minX, s.position.x); minY = Math.min(minY, s.position.y);
        maxX = Math.max(maxX, s.position.x); maxY = Math.max(maxY, s.position.y);
      }
      if (s.start && s.end) {
        minX = Math.min(minX, s.start.x, s.end.x);
        minY = Math.min(minY, s.start.y, s.end.y);
        maxX = Math.max(maxX, s.start.x, s.end.x);
        maxY = Math.max(maxY, s.start.y, s.end.y);
      }
    }
    return {
      minX: minX - MAP_PADDING, minY: minY - MAP_PADDING,
      maxX: maxX + MAP_PADDING, maxY: maxY + MAP_PADDING,
    };
  }, [shapes]);

  const mapWidth = bounds.maxX - bounds.minX;
  const mapHeight = bounds.maxY - bounds.minY;
  const svgWidth = SCREEN_WIDTH - 20;
  const svgHeight = (svgWidth / mapWidth) * mapHeight;
  const scale = svgWidth / mapWidth;

  // World coords → SVG coords (flip Y)
  const toSvg = (wx, wy) => ({
    sx: (wx - bounds.minX) * scale,
    sy: (bounds.maxY - wy) * scale,
  });

  // Pixel coords from arrows → world meters → SVG
  const arrowPxToSvg = (pxX, pxY) => {
    const wx = pxX * pxToM;
    const wy = (imgH - pxY) * pxToM;
    return toSvg(wx, wy);
  };

  const rooms = shapes.filter((s) => s.type === 'room');
  const corridors = shapes.filter((s) => s.type === 'corridor');
  const doors = shapes.filter((s) => s.type === 'door');
  const barriers = shapes.filter((s) => s.type === 'barrier');

  const polygonPoints = (polygon) =>
    polygon.map((p) => { const { sx, sy } = toSvg(p.x, p.y); return `${sx},${sy}`; }).join(' ');

  const shapeCentroid = (polygon) => {
    const n = polygon.length;
    const cx = polygon.reduce((s, p) => s + p.x, 0) / n;
    const cy = polygon.reduce((s, p) => s + p.y, 0) / n;
    return toSvg(cx, cy);
  };

  // Build SVG arrow path (line + triangle head)
  const renderArrow = (a, color, opacity, strokeW, key) => {
    const from = arrowPxToSvg(a.x1_px, a.y1_px);
    const to = arrowPxToSvg(a.x2_px, a.y2_px);

    const dx = to.sx - from.sx;
    const dy = to.sy - from.sy;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 2) return null;

    const ux = dx / len;
    const uy = dy / len;
    const headSize = (a.headSize || 16) * scale * pxToM;
    const baseX = to.sx - ux * headSize;
    const baseY = to.sy - uy * headSize;
    const wingX = -uy * headSize * 0.55;
    const wingY = ux * headSize * 0.55;

    const trianglePoints = `${to.sx},${to.sy} ${baseX + wingX},${baseY + wingY} ${baseX - wingX},${baseY - wingY}`;

    return (
      <G key={key} opacity={opacity}>
        <Line
          x1={from.sx} y1={from.sy} x2={baseX} y2={baseY}
          stroke={color} strokeWidth={strokeW} strokeLinecap="round"
        />
        <Polygon points={trianglePoints} fill={color} />
      </G>
    );
  };

  return (
    <View style={styles.container}>
      <Svg width={svgWidth} height={svgHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`}>
        {/* Background */}
        <Rect x={0} y={0} width={svgWidth} height={svgHeight} fill="#0d1117" rx={8} />

        {/* Corridors */}
        {corridors.map((c) => (
          <G key={c.id}>
            <Polygon
              points={polygonPoints(c.polygon)}
              fill="#1a3a2a" stroke="#2d6a4f" strokeWidth={1} opacity={0.8}
            />
            {showLabels && (() => {
              const { sx, sy } = shapeCentroid(c.polygon);
              return (
                <SvgText x={sx} y={sy} fill="#5cba7d"
                  fontSize={Math.max(7, 9 * scale / 4)} textAnchor="middle" opacity={0.7}>
                  {c.label}
                </SvgText>
              );
            })()}
          </G>
        ))}

        {/* Rooms */}
        {rooms.map((r) => {
          const isHazardous = hazards.some((h) => h.nodeId === r.id);
          return (
            <G key={r.id}>
              <Polygon
                points={polygonPoints(r.polygon)}
                fill={isHazardous ? '#4a1515' : '#162033'}
                stroke={isHazardous ? '#e74c3c' : '#1e3a5f'}
                strokeWidth={isHazardous ? 2 : 1} opacity={0.8}
              />
              {showLabels && (() => {
                const { sx, sy } = shapeCentroid(r.polygon);
                return (
                  <SvgText x={sx} y={sy} fill={isHazardous ? '#e74c3c' : '#4a90c4'}
                    fontSize={Math.max(7, 9 * scale / 4)} textAnchor="middle" opacity={0.7}>
                    {r.label}
                  </SvgText>
                );
              })()}
            </G>
          );
        })}

        {/* Barriers */}
        {barriers.map((b) => {
          const { sx: x1, sy: y1 } = toSvg(b.start.x, b.start.y);
          const { sx: x2, sy: y2 } = toSvg(b.end.x, b.end.y);
          return (
            <Line key={b.id} x1={x1} y1={y1} x2={x2} y2={y2}
              stroke="#555" strokeWidth={1.5} opacity={0.5} />
          );
        })}

        {/* Doors */}
        {doors.map((d) => {
          const { sx, sy } = toSvg(d.position.x, d.position.y);
          return (
            <G key={d.id}>
              <Circle cx={sx} cy={sy} r={d.is_exit ? 5 : 3}
                fill={d.is_exit ? '#27ae60' : '#3498db'}
                stroke={d.is_exit ? '#2ecc71' : '#5dade2'}
                strokeWidth={d.is_exit ? 2 : 1} opacity={0.9} />
              {d.is_exit && showLabels && (
                <SvgText x={sx} y={sy - 8} fill="#2ecc71" fontSize={7}
                  textAnchor="middle" fontWeight="bold">EXIT</SvgText>
              )}
            </G>
          );
        })}

        {/* Arrow path sets */}
        {pathSets.map((set) => {
          const isActive = activePathSet && activePathSet.id === set.id;
          const hasActive = !!activePathSet;

          return set.arrows.map((a, i) => {
            if (isActive) {
              // Active set: bright with glow effect (double-draw for glow)
              return (
                <G key={`${set.id}-${i}`}>
                  {/* Glow layer */}
                  {renderArrow(a, set.color, 0.4, 4, `${set.id}-${i}-glow`)}
                  {/* Core layer */}
                  {renderArrow(a, set.color, 1.0, 2, `${set.id}-${i}-core`)}
                </G>
              );
            } else {
              // Inactive: heavily dimmed when another set is active, otherwise visible
              const opacity = hasActive ? 0.08 : 0.6;
              const color = hasActive ? '#555555' : set.color;
              return renderArrow(a, color, opacity, 1.5, `${set.id}-${i}`);
            }
          });
        })}

        {/* Guidance line: user → nearest arrow tail in active set */}
        {activePathSet && nearestArrow && userPosition && (() => {
          const userSvg = toSvg(userPosition.x, userPosition.y);
          const arrowTail = arrowPxToSvg(nearestArrow.x1_px, nearestArrow.y1_px);
          return (
            <G>
              <Line
                x1={userSvg.sx} y1={userSvg.sy}
                x2={arrowTail.sx} y2={arrowTail.sy}
                stroke="#ffffff" strokeWidth={1.5} strokeDasharray="6,5" opacity={0.5}
              />
              <Circle cx={arrowTail.sx} cy={arrowTail.sy} r={5}
                stroke={activePathSet.color} strokeWidth={2} fill="none" opacity={0.8} />
            </G>
          );
        })()}

        {/* Hazard markers */}
        {hazards.map((h, i) => {
          const { sx, sy } = toSvg(h.x, h.y);
          return (
            <G key={`hazard-${i}`}>
              <Circle cx={sx} cy={sy} r={12} fill="#e74c3c" opacity={0.3} />
              <Circle cx={sx} cy={sy} r={8} fill="#e74c3c" opacity={0.5} />
              <Circle cx={sx} cy={sy} r={4} fill="#ff6b6b" />
              <SvgText x={sx} y={sy + 3} fill="#fff" fontSize={7}
                textAnchor="middle" fontWeight="bold">🔥</SvgText>
            </G>
          );
        })}

        {/* Other users (admin view) */}
        {otherUsers.map((u, i) => {
          if (!u.x || !u.y) return null;
          const { sx, sy } = toSvg(u.x, u.y);
          return (
            <G key={`user-${i}`}>
              <Circle cx={sx} cy={sy} r={5}
                fill={u.safe ? '#27ae60' : '#f39c12'} opacity={0.8} />
              <SvgText x={sx} y={sy - 8} fill={u.safe ? '#27ae60' : '#f39c12'}
                fontSize={6} textAnchor="middle">{u.name || 'User'}</SvgText>
            </G>
          );
        })}

        {/* User position */}
        {userPosition && (() => {
          const { sx, sy } = toSvg(userPosition.x, userPosition.y);
          return (
            <G>
              <Circle cx={sx} cy={sy}
                r={Math.max(8, (userPosition.accuracy || 3) * scale)}
                fill="#3498db" opacity={0.15} />
              <Circle cx={sx} cy={sy} r={10} fill="#3498db" opacity={0.3} />
              <Circle cx={sx} cy={sy} r={6} fill="#3498db" stroke="#fff" strokeWidth={2} />
              <SvgText x={sx} y={sy - 14} fill="#fff" fontSize={8}
                textAnchor="middle" fontWeight="bold">You</SvgText>
            </G>
          );
        })()}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center' },
});
