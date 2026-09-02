# Adding maps and terrain tiles

AVERA maps are data packs. Runtime terrain, rendering, pathfinding, bases,
resources, camera bounds and multiplayer snapshots all read the same map.

## Add a map

1. Copy a file in `src/assets/maps/` and give it a unique `id`.
2. Set its tile dimensions and world dimensions.
3. Paint terrain with ordered `features`:
   - `rect`: `x`, `y`, `width`, `height`
   - `ellipse`: centre `x`, `y`, `radiusX`, `radiusY`
4. Place `bases` and `resources` using tile coordinates.
5. Register the imported JSON in `src/game/maps.ts`.

Later features overwrite earlier ones, so a land rectangle after a water
ellipse can create an island, bridge or causeway.

## Reuse a tileset

Each map names a tileset and selects its own `landTiles` and `waterTiles`.
The built-in `frontier` pack contains 28 individual 64×64 PNG assets:

- 8 reusable land variants;
- 4 reusable water variants;
- 16 NESW shoreline masks (`shore-0` through `shore-15`).

The renderer assembles the chosen individual PNGs into one efficient Phaser
atlas at load time. A map never needs to duplicate those images.

## Add a tileset

1. Create `src/assets/tiles/<tileset-id>/`.
2. Add separate 64×64 PNGs and a `<tileset-id>.tileset.json` manifest.
3. Register that manifest in `src/game/maps.ts`.
4. Reference its id from a map pack.

`scripts/generate-terrain-tiles.ps1` regenerates the built-in Frontier tile
library deterministically. It does not read API keys or call an image API.
