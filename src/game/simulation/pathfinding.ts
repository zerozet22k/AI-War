import type { MapState, MovementDomain, Vector2 } from '../../types/game';
import { TILE_SIZE } from '../constants';
import { worldToTile } from './mapGen';

interface TilePoint {
  col: number;
  row: number;
}

const NEIGHBORS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

function tileIndex(map: MapState, col: number, row: number): number {
  return row * map.terrainCols + col;
}

function tilePoint(map: MapState, index: number): TilePoint {
  return { col: index % map.terrainCols, row: Math.floor(index / map.terrainCols) };
}

function passable(map: MapState, col: number, row: number, domain: MovementDomain): boolean {
  if (col < 0 || row < 0 || col >= map.terrainCols || row >= map.terrainRows) return false;
  if (domain === 'air') return true;
  const terrain = map.terrain[tileIndex(map, col, row)];
  return domain === 'sea' ? terrain === 'water' : terrain === 'land';
}

function heuristic(a: TilePoint, b: TilePoint): number {
  const dx = Math.abs(a.col - b.col);
  const dy = Math.abs(a.row - b.row);
  return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
}

function nearestPassableTile(map: MapState, tile: TilePoint, domain: MovementDomain): TilePoint | null {
  let best: TilePoint | null = null;
  let bestDistance = Infinity;
  for (let row = 0; row < map.terrainRows; row += 1) {
    for (let col = 0; col < map.terrainCols; col += 1) {
      if (!passable(map, col, row, domain)) continue;
      const d = Math.hypot(col - tile.col, row - tile.row);
      if (d < bestDistance) {
        bestDistance = d;
        best = { col, row };
      }
    }
  }
  return best;
}

function tileCenter(tile: TilePoint): Vector2 {
  return { x: tile.col * TILE_SIZE + TILE_SIZE / 2, y: tile.row * TILE_SIZE + TILE_SIZE / 2 };
}

/**
 * A* over the actual generated terrain grid. If the requested destination is
 * in the wrong movement domain (ground order in water or ship order on land),
 * the search returns the reachable tile closest to it instead of driving the
 * unit into the shoreline forever.
 */
export function findTerrainPath(map: MapState, start: Vector2, target: Vector2, domain: MovementDomain): Vector2[] {
  if (domain === 'air') return [{ ...target }];

  const rawStart = worldToTile(start, map.terrainCols, map.terrainRows);
  const goal = worldToTile(target, map.terrainCols, map.terrainRows);
  const startWasPassable = passable(map, rawStart.col, rawStart.row, domain);
  const startTile = startWasPassable
    ? rawStart
    : nearestPassableTile(map, rawStart, domain);
  if (!startTile) return [];

  const cellCount = map.terrainCols * map.terrainRows;
  const startIndex = tileIndex(map, startTile.col, startTile.row);
  const goalIndex = tileIndex(map, goal.col, goal.row);
  const gScore = new Float64Array(cellCount);
  const fScore = new Float64Array(cellCount);
  const cameFrom = new Int32Array(cellCount);
  gScore.fill(Infinity);
  fScore.fill(Infinity);
  cameFrom.fill(-1);
  gScore[startIndex] = 0;
  fScore[startIndex] = heuristic(startTile, goal);

  const open = new Set<number>([startIndex]);
  const closed = new Uint8Array(cellCount);
  let bestIndex = startIndex;
  let bestDistance = heuristic(startTile, goal);
  let reachedGoal = false;

  while (open.size > 0) {
    let current = -1;
    let currentScore = Infinity;
    for (const candidate of open) {
      if (fScore[candidate] < currentScore) {
        current = candidate;
        currentScore = fScore[candidate];
      }
    }
    if (current < 0) break;
    open.delete(current);
    if (closed[current]) continue;
    closed[current] = 1;

    const point = tilePoint(map, current);
    const goalDistance = heuristic(point, goal);
    if (goalDistance < bestDistance) {
      bestDistance = goalDistance;
      bestIndex = current;
    }
    if (current === goalIndex && passable(map, goal.col, goal.row, domain)) {
      bestIndex = current;
      reachedGoal = true;
      break;
    }

    for (const [dc, dr, cost] of NEIGHBORS) {
      const col = point.col + dc;
      const row = point.row + dr;
      if (!passable(map, col, row, domain)) continue;
      // Do not squeeze diagonally through two blocked shoreline corners.
      if (dc !== 0 && dr !== 0 && (!passable(map, point.col + dc, point.row, domain) || !passable(map, point.col, point.row + dr, domain))) continue;
      const neighbor = tileIndex(map, col, row);
      if (closed[neighbor]) continue;
      const tentative = gScore[current] + cost;
      if (tentative >= gScore[neighbor]) continue;
      cameFrom[neighbor] = current;
      gScore[neighbor] = tentative;
      fScore[neighbor] = tentative + heuristic({ col, row }, goal);
      open.add(neighbor);
    }
  }

  const reversed: TilePoint[] = [];
  let cursor = bestIndex;
  while (cursor !== startIndex && cursor >= 0) {
    reversed.push(tilePoint(map, cursor));
    cursor = cameFrom[cursor];
  }
  reversed.reverse();
  const waypoints = reversed.map(tileCenter);
  if (!startWasPassable) waypoints.unshift(tileCenter(startTile));
  if (reachedGoal) waypoints.push({ ...target });
  return waypoints;
}

export function terrainTileKey(map: MapState, position: Vector2): number {
  const tile = worldToTile(position, map.terrainCols, map.terrainRows);
  return tileIndex(map, tile.col, tile.row);
}
