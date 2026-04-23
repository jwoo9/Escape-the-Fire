/**
 * pathfinding.ts
 *
 * A* over the floor navigation graph.
 * Blocked zones remove their associated nav nodes from the traversal,
 * forcing the algorithm to route around them.
 *
 * Usage:
 *   const path = findPath(floor, userNodeId, blockedZoneIds);
 *   // returns NavNode[] from user's nearest node to the nearest reachable exit
 */

import { FloorData, NavNode, ZONE_TO_NODES } from '../../constants/mapData';

// ─── Helpers ────────────────────────────────────────────────────────────────
const dist = (a: NavNode, b: NavNode) =>
  Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

const heuristic = (a: NavNode, b: NavNode) => dist(a, b);

/** Find the nav node nearest to a given SVG coordinate */
export const nearestNode = (
  graph: NavNode[],
  svgX: number,
  svgY: number,
  blockedNodes: Set<string> = new Set(),
): NavNode | null => {
  let best: NavNode | null = null;
  let bestD = Infinity;
  for (const n of graph) {
    if (blockedNodes.has(n.id)) continue;
    const d = Math.sqrt((n.x - svgX) ** 2 + (n.y - svgY) ** 2);
    if (d < bestD) { bestD = d; best = n; }
  }
  return best;
};

/** Collect all nav node IDs that are blocked given a set of blocked zone IDs */
export const blockedNodeIds = (blockedZoneIds: string[]): Set<string> => {
  const out = new Set<string>();
  for (const zid of blockedZoneIds) {
    const nodes = ZONE_TO_NODES[zid] ?? [];
    nodes.forEach((n: string) => out.add(n));
  }
  return out;
};

/** A* — returns ordered list of NavNodes forming the route, or null if no path */
export const astar = (
  graph: NavNode[],
  startId: string,
  goalId: string,
  blocked: Set<string>,
): NavNode[] | null => {
  const nodeMap = new Map<string, NavNode>(graph.map(n => [n.id, n]));
  const goal    = nodeMap.get(goalId);
  const start   = nodeMap.get(startId);
  if (!start || !goal) return null;

  const open   = new Set<string>([startId]);
  const cameFrom = new Map<string, string>();
  const gScore   = new Map<string, number>([[startId, 0]]);
  const fScore   = new Map<string, number>([[startId, heuristic(start, goal)]]);

  while (open.size > 0) {
    // Pick node in open with lowest fScore
    let currentId = '';
    let lowestF   = Infinity;
    for (const id of open) {
      const f = fScore.get(id) ?? Infinity;
      if (f < lowestF) { lowestF = f; currentId = id; }
    }

    if (currentId === goalId) {
      // Reconstruct path
      const path: NavNode[] = [];
      let cur = goalId;
      while (cur) {
        path.unshift(nodeMap.get(cur)!);
        cur = cameFrom.get(cur) ?? '';
      }
      return path;
    }

    open.delete(currentId);
    const current = nodeMap.get(currentId)!;

    for (const neighborId of current.neighbors) {
      if (blocked.has(neighborId)) continue;
      const neighbor = nodeMap.get(neighborId);
      if (!neighbor) continue;

      const tentativeG = (gScore.get(currentId) ?? Infinity) + dist(current, neighbor);
      if (tentativeG < (gScore.get(neighborId) ?? Infinity)) {
        cameFrom.set(neighborId, currentId);
        gScore.set(neighborId, tentativeG);
        fScore.set(neighborId, tentativeG + heuristic(neighbor, goal));
        open.add(neighborId);
      }
    }
  }

  return null; // No path found
};

/**
 * High-level route finder.
 * Finds the shortest path from the user's position to the nearest reachable exit.
 * Tries all exits and returns the shortest valid path.
 */
export const findEvacRoute = (
  floor: FloorData,
  svgX: number,
  svgY: number,
  blockedZoneIds: string[],
): NavNode[] | null => {
  const blocked = blockedNodeIds(blockedZoneIds);
  const start   = nearestNode(floor.navGraph, svgX, svgY, blocked);
  if (!start) return null;

  // Find exit node IDs from the graph
  const exitNodeIds = floor.navGraph
    .filter((n: NavNode) => n.id.includes('exit'))
    .map((n: NavNode) => n.id)
    .filter((id: string) => !blocked.has(id));

  let bestPath: NavNode[] | null = null;
  let bestLen = Infinity;

  for (const exitId of exitNodeIds) {
    const path = astar(floor.navGraph, start.id, exitId, blocked);
    if (path) {
      // Path length in SVG pixels
      let len = 0;
      for (let i = 1; i < path.length; i++) len += dist(path[i-1], path[i]);
      if (len < bestLen) { bestLen = len; bestPath = path; }
    }
  }

  return bestPath;
};

/** Convert a NavNode path to an array of [x1,y1,x2,y2] arrow segments */
export const pathToArrows = (path: NavNode[]): [number,number,number,number][] => {
  const arrows: [number,number,number,number][] = [];
  for (let i = 0; i < path.length - 1; i++) {
    arrows.push([path[i].x, path[i].y, path[i+1].x, path[i+1].y]);
  }
  return arrows;
};