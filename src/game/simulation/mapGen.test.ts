import { describe, expect, it } from 'vitest';
import { generateMap, isWater, tileAt, worldToTile } from './mapGen';
import { MAP_HEIGHT, MAP_WIDTH, TILE_SIZE } from '../constants';

describe('generateMap terrain', () => {
  it('sizes the terrain grid to cover the whole map at TILE_SIZE resolution', () => {
    const map = generateMap();
    expect(map.terrainCols).toBe(Math.ceil(MAP_WIDTH / TILE_SIZE));
    expect(map.terrainRows).toBe(Math.ceil(MAP_HEIGHT / TILE_SIZE));
    expect(map.terrain).toHaveLength(map.terrainCols * map.terrainRows);
  });

  it('has at least some water and mostly land', () => {
    const map = generateMap();
    const waterCount = map.terrain.filter((t) => t === 'water').length;
    expect(waterCount).toBeGreaterThan(0);
    expect(waterCount).toBeLessThan(map.terrain.length / 2);
  });

  it('keeps both bases, and every resource node, on dry land', () => {
    const map = generateMap();
    expect(isWater(map, map.bases.player)).toBe(false);
    expect(isWater(map, map.bases.enemy)).toBe(false);
    for (const node of map.resourceNodes) {
      expect(isWater(map, node.position)).toBe(false);
    }
  });

  it('mirrors the lakes across the map\'s vertical centre line', () => {
    const map = generateMap();
    const centerY = MAP_HEIGHT / 2;
    // A point just left of centre and its mirror just right of centre should
    // report the same terrain, for every offset checked.
    for (let dx = 100; dx < MAP_WIDTH / 2; dx += 137) {
      const left = tileAt(map, { x: MAP_WIDTH / 2 - dx, y: centerY });
      const right = tileAt(map, { x: MAP_WIDTH / 2 + dx, y: centerY });
      expect(left).toBe(right);
    }
  });

  it('worldToTile clamps out-of-range points onto the grid instead of throwing', () => {
    const map = generateMap();
    const { col, row } = worldToTile({ x: -500, y: MAP_HEIGHT + 500 }, map.terrainCols, map.terrainRows);
    expect(col).toBe(0);
    expect(row).toBe(map.terrainRows - 1);
  });
});
