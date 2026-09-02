import twinSeas from '../assets/maps/twin-seas.map.json';
import centralBasin from '../assets/maps/central-basin.map.json';
import brokenCoast from '../assets/maps/broken-coast.map.json';
import titanExpanse from '../assets/maps/titan-expanse.map.json';
import shatteredIsles from '../assets/maps/shattered-isles.map.json';
import frontierTileset from '../assets/tiles/frontier/frontier.tileset.json';
import type { PlayerId, TerrainType } from '../types/game';

export type MapId = 'twin-seas' | 'central-basin' | 'broken-coast' | 'titan-expanse' | 'shattered-isles';
export type TerrainTilesetId = 'frontier';

export interface MapFeature {
  terrain: TerrainType;
  shape: 'rect' | 'ellipse';
  x: number;
  y: number;
  width?: number;
  height?: number;
  radiusX?: number;
  radiusY?: number;
}

export interface MapPack {
  id: MapId;
  name: string;
  description: string;
  /** How many active sides this map is actually designed for (2-4) — every
   * map still defines all 4 physical base corners for engine uniformity
   * (see mapGen.ts), but the lobby caps slot counts to this so a map not
   * built for a crowded 4-way fight isn't offered as one. */
  maxPlayers: number;
  tileset: TerrainTilesetId;
  columns: number;
  rows: number;
  worldWidth: number;
  worldHeight: number;
  baseTerrain: TerrainType;
  landTiles: string[];
  waterTiles: string[];
  features: MapFeature[];
  bases: Record<PlayerId, [number, number]>;
  resources: Array<[number, number]>;
}

export interface TerrainTileset {
  id: TerrainTilesetId;
  name: string;
  tileSize: number;
  land: string[];
  water: string[];
  shore: string[];
}

export const MAPS: Record<MapId, MapPack> = {
  'twin-seas': twinSeas as MapPack,
  'central-basin': centralBasin as MapPack,
  'broken-coast': brokenCoast as MapPack,
  'titan-expanse': titanExpanse as MapPack,
  'shattered-isles': shatteredIsles as MapPack,
};

export const MAP_ID_LIST = Object.keys(MAPS) as MapId[];
export const DEFAULT_MAP_ID: MapId = 'twin-seas';

export const TERRAIN_TILESETS: Record<TerrainTilesetId, TerrainTileset> = {
  frontier: frontierTileset as TerrainTileset,
};

export function isMapId(value: unknown): value is MapId {
  return typeof value === 'string' && value in MAPS;
}

export function mapPack(id: MapId = DEFAULT_MAP_ID): MapPack {
  return MAPS[id];
}
