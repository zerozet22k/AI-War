import { PLAYER_ID_LIST, type MapState, type PlayerId, type ResourceNodeState, type TerrainType, type Vector2 } from '../../types/game';
import { RESOURCE_NODE_AMOUNT, TILE_SIZE } from '../constants';
import { DEFAULT_MAP_ID, mapPack, type MapFeature, type MapId, type MapPack } from '../maps';
import { makeId } from '../../utils/id';
import { distance } from '../../utils/math';

/** Cell index for the world point `pos` — clamped to the grid, so a point
 * exactly on (or just past) the map edge still resolves to a real cell. */
export function worldToTile(pos: Vector2, cols: number, rows: number): { col: number; row: number } {
  const col = Math.min(cols - 1, Math.max(0, Math.floor(pos.x / TILE_SIZE)));
  const row = Math.min(rows - 1, Math.max(0, Math.floor(pos.y / TILE_SIZE)));
  return { col, row };
}

export function tileAt(map: Pick<MapState, 'terrain' | 'terrainCols' | 'terrainRows'>, pos: Vector2): TerrainType {
  const { col, row } = worldToTile(pos, map.terrainCols, map.terrainRows);
  return map.terrain[row * map.terrainCols + col];
}

export function isWater(map: Pick<MapState, 'terrain' | 'terrainCols' | 'terrainRows'>, pos: Vector2): boolean {
  return tileAt(map, pos) === 'water';
}

function tileCenter(col: number, row: number): Vector2 {
  return { x: col * TILE_SIZE + TILE_SIZE / 2, y: row * TILE_SIZE + TILE_SIZE / 2 };
}

function featureContains(feature: MapFeature, col: number, row: number): boolean {
  if (feature.shape === 'rect') {
    return col >= feature.x && row >= feature.y && col < feature.x + (feature.width ?? 0) && row < feature.y + (feature.height ?? 0);
  }
  const radiusX = Math.max(0.01, feature.radiusX ?? 1);
  const radiusY = Math.max(0.01, feature.radiusY ?? 1);
  return ((col - feature.x) / radiusX) ** 2 + ((row - feature.y) / radiusY) ** 2 <= 1;
}

// A random spawn shouldn't also mean a possibly-adjacent one — reroll until
// the players who actually matter (the active ones) land at least this far
// apart, as a fraction of the map's diagonal. Random per-slot shuffling,
// not a fixed "farthest pair always wins" rule, so which physical corner
// you get still varies match to match.
const MIN_SPAWN_SEPARATION_FRACTION = 0.55;
const MAX_SHUFFLE_ATTEMPTS = 30;

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Randomizes which physical base slot each active player spawns at, instead
 * of always the map's fixed named corner — rerolling if the active players
 * would land too close together. Inactive slots (a 2-player match's unused
 * player3/player4 corners) just get whatever's left over; nothing reads them. */
function randomizedBases(pack: MapPack, activePlayers: PlayerId[]): Record<PlayerId, Vector2> {
  const positions = PLAYER_ID_LIST.map((owner) => tileCenter(...pack.bases[owner]));
  const minDistance = Math.hypot(pack.worldWidth, pack.worldHeight) * MIN_SPAWN_SEPARATION_FRACTION;
  const activeIndices = activePlayers
    .map((owner) => PLAYER_ID_LIST.indexOf(owner))
    .filter((index) => index >= 0);

  let order = PLAYER_ID_LIST.map((_, index) => index);
  for (let attempt = 0; attempt < MAX_SHUFFLE_ATTEMPTS; attempt += 1) {
    order = shuffled(order);
    let closestActivePair = Infinity;
    for (let a = 0; a < activeIndices.length; a += 1) {
      for (let b = a + 1; b < activeIndices.length; b += 1) {
        closestActivePair = Math.min(closestActivePair, distance(positions[order[activeIndices[a]]], positions[order[activeIndices[b]]]));
      }
    }
    if (activeIndices.length < 2 || closestActivePair >= minDistance) break;
  }

  return Object.fromEntries(PLAYER_ID_LIST.map((owner, index) => [owner, positions[order[index]]])) as Record<PlayerId, Vector2>;
}

/** Loads a packaged map definition and expands its reusable shape features
 * into the authoritative terrain grid consumed by rendering and A*.
 * `randomizeSpawns` defaults off so `new Simulation()` stays deterministic
 * for tests/tools that assume the map's named corners — the real match path
 * (MatchController) opts in explicitly. */
export function generateMap(
  mapId: MapId = DEFAULT_MAP_ID,
  activePlayers: PlayerId[] = ['player', 'enemy'],
  randomizeSpawns = false,
): MapState {
  const pack = mapPack(mapId);
  const terrain: TerrainType[] = new Array(pack.columns * pack.rows).fill(pack.baseTerrain);
  for (const feature of pack.features) {
    for (let row = 0; row < pack.rows; row += 1) {
      for (let col = 0; col < pack.columns; col += 1) {
        if (featureContains(feature, col, row)) terrain[row * pack.columns + col] = feature.terrain;
      }
    }
  }

  const bases = randomizeSpawns
    ? randomizedBases(pack, activePlayers)
    : (Object.fromEntries(PLAYER_ID_LIST.map((owner) => [owner, tileCenter(...pack.bases[owner])])) as Record<PlayerId, Vector2>);
  const resourceNodes: ResourceNodeState[] = pack.resources.map(([col, row]) => ({
    id: makeId('node'),
    position: tileCenter(col, row),
    remaining: RESOURCE_NODE_AMOUNT,
    maxAmount: RESOURCE_NODE_AMOUNT,
  }));

  return {
    id: pack.id,
    name: pack.name,
    tileset: pack.tileset,
    landTiles: [...pack.landTiles],
    waterTiles: [...pack.waterTiles],
    width: pack.worldWidth,
    height: pack.worldHeight,
    terrainCols: pack.columns,
    terrainRows: pack.rows,
    terrain,
    resourceNodes,
    bases,
  };
}
