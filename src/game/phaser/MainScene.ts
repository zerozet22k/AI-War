import Phaser from 'phaser';
import type { MatchView } from '../matchView';
import { PLAYER_ID_LIST, RACE_ID_LIST, type BuildingState, type PlayerId, type ProjectileState, type UnitState } from '../../types/game';
import { BUILDING_SIGHT, FIXED_DT, RESOURCE_GARRISON_RADIUS, SNAPSHOT_INTERVAL, TILE_SIZE } from '../constants';
import { useAppStore } from '../../state/store';
import type { HudSnapshot } from '../../state/store';
import { RACES, buildingName, unitShortName } from '../races';
import type { BuildingAnimationState, UnitAnimationState } from '../races';
import { TERRAIN_TILESETS, type TerrainTilesetId } from '../maps';
import { gameAudio, type GameSoundCue } from '../audio/GameAudio';
import crystalDepositUrl from '../../assets/resources/crystal-deposit.png?url';
import { UNIT_MOTION_CONFIG, resolveUnitFacingAngle, resolveUnitPose } from './unitAnimations';

const FRAME_URLS = import.meta.glob('../../assets/races/*/sprites/*/*/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const TERRAIN_TILE_URLS = import.meta.glob('../../assets/tiles/*/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

function frameTextureKey(race: string, kind: 'unit' | 'building', type: string, frame: string): string {
  return `race-${race}-${kind}-${type}-${frame}`;
}

function frameUrl(race: string, asset: string, frame: string): string {
  const directory = asset.replace(/\.png$/, '');
  const fileName = frame.endsWith('.png') ? frame : `${frame}.png`;
  const key = `../../assets/races/${race}/${directory}/${fileName}`;
  const url = FRAME_URLS[key];
  if (!url) throw new Error(`Missing race frame asset: ${key}`);
  return url;
}

function terrainTileTextureKey(tileset: string, tileId: string): string {
  return `terrain-source-${tileset}-${tileId}`;
}

function terrainTileUrl(tileset: string, tileId: string): string {
  const key = `../../assets/tiles/${tileset}/${tileId}.png`;
  const url = TERRAIN_TILE_URLS[key];
  if (!url) throw new Error(`Missing terrain tile asset: ${key}`);
  return url;
}

// A visible team-color cast on every unit/building without crushing the
// faction artwork the way a fully-saturated tint would (Phaser tints
// multiply per channel, so a strong tint clips channels the source art
// doesn't have much of) — roughly a 45/55 blend of the owner's chosen
// color and white, computed from whatever color the lobby assigned
// (Simulation's DEFAULT_OWNER_COLOR when nothing was explicitly chosen).
function ownerTintFromColor(color: number): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const blend = (channel: number) => Math.round(channel * 0.45 + 255 * 0.55);
  return (blend(r) << 16) | (blend(g) << 8) | blend(b);
}
// Fixed-timestep simulation loop: gameplay always advances in constant FIXED_DT
// increments regardless of the browser's actual render frame rate. Real
// elapsed frame time (scaled by the speed control) accumulates and is drained
// in whole fixed steps, with a per-frame cap so a slow/backgrounded tab can't
// cause a runaway catch-up burst.
const MAX_STEPS_PER_FRAME = 8;
// Building PNGs intentionally include breathing room for animation effects;
// render them larger than their logical footprint so the actual structure is
// not dwarfed by units, health bars, and selection overlays.
const BUILDING_RENDER_SCALE = 1.3;

interface EntityVisual {
  container: Phaser.GameObjects.Container;
  shadow: Phaser.GameObjects.Ellipse;
  sprite: Phaser.GameObjects.Sprite;
  blendSprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  hpBarBg: Phaser.GameObjects.Rectangle;
  hpBarFill: Phaser.GameObjects.Rectangle;
  progressBarBg: Phaser.GameObjects.Rectangle;
  progressBarFill: Phaser.GameObjects.Rectangle;
  progressLabel: Phaser.GameObjects.Text;
  constructionHalo: Phaser.GameObjects.Ellipse;
  constructionScan: Phaser.GameObjects.Rectangle;
  lastHp: number;
  hitUntil: number;
  phase: number;
  deathTextureKey: string | null;
  deathSoundCue: GameSoundCue;
}

interface UnitMotionState {
  x: number;
  y: number;
  direction: number;
}

interface BuildingAudioState {
  underConstruction: boolean;
  productionHead: string | null;
  researchHead: string | null;
  lastDamagedAt: number | null;
  healthRatio: number;
}

interface UnitAudioState {
  gatherState: UnitState['gatherState'];
  carriedResources: number;
  supportWorking: boolean;
  healthRatio: number;
  orderType: UnitState['order']['type'];
  cargoCount: number;
  skillCooldowns: Record<string, number>;
}

export class MainScene extends Phaser.Scene {
  private controller!: MatchView;
  private viewSide: PlayerId = 'player';
  private unitVisuals = new Map<string, EntityVisual>();
  private unitMotion = new Map<string, UnitMotionState>();
  private unitAudioState = new Map<string, UnitAudioState>();
  private buildingVisuals = new Map<string, EntityVisual>();
  private buildingAudioState = new Map<string, BuildingAudioState>();
  private projectileVisuals = new Map<string, Phaser.GameObjects.Graphics>();
  private hudAccumulator = 0;
  private simAccumulator = 0;
  private placementGhost?: Phaser.GameObjects.Arc;
  private selectionRing?: Phaser.GameObjects.Graphics;
  private attackRangeRing?: Phaser.GameObjects.Graphics;
  private dragSelectBox?: Phaser.GameObjects.Graphics;
  /** Screen-space anchor for an in-progress drag-select; null when the
   * pointer isn't down or the drag hasn't started over the game view. */
  private dragSelectStart: { x: number; y: number } | null = null;
  private isDragSelecting = false;
  private visibilityMask?: Phaser.GameObjects.Graphics;
  private exploredMask?: Phaser.GameObjects.Graphics;
  private fogOverlay?: Phaser.GameObjects.Rectangle;
  private shroudOverlay?: Phaser.GameObjects.Rectangle;
  private exploredTiles = new Uint8Array(0);
  private fogAccumulator = 0;
  private initialEntitySyncComplete = false;
  private announcedMatchResult: PlayerId | 'draw' | null = null;
  private depletedNodeIds = new Set<string>();
  private announcedEnemyEntityIds = new Set<string>();
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd?: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;
  private unsubscribeStore?: () => void;
  /** Buildings are static structures — once scouted, they stay shown
   * (dimmed, "last seen") even after vision moves on, matching classic RTS
   * fog conventions. Units get no such memory: they fully vanish outside
   * current sight, since hiding live army movement is the point of fog. */
  private seenEnemyBuildingIds = new Set<string>();
  private minimapCamera?: Phaser.Cameras.Scene2D.Camera;
  private minimapViewportRect?: Phaser.GameObjects.Graphics;
  private minimapBlips?: Phaser.GameObjects.Graphics;
  private minimapRect = { x: 0, y: 0, w: 0, h: 0, zoom: 1 };
  private minimapDragging = false;
  // Phaser only receives pointer events while the cursor is over the canvas
  // (not the surrounding DOM, e.g. HUD overlays) — gameout/gameover track
  // that so edge-scroll doesn't keep panning once the mouse has left, using
  // a frozen last-known activePointer position just inside the border.
  private pointerInGame = true;

  constructor() {
    super('main');
  }

  init(data: { controller: MatchView; viewSide: PlayerId }): void {
    this.controller = data.controller;
    this.viewSide = data.viewSide;
  }

  preload(): void {
    this.load.image('resource-crystal-deposit', crystalDepositUrl);
    for (const tileset of Object.values(TERRAIN_TILESETS)) {
      for (const tileId of [...tileset.land, ...tileset.water, ...tileset.shore]) {
        this.load.image(terrainTileTextureKey(tileset.id, tileId), terrainTileUrl(tileset.id, tileId));
      }
    }
    for (const raceId of RACE_ID_LIST) {
      const race = RACES[raceId];
      for (const [unitId, definition] of Object.entries(race.units)) {
        const animation = race.animations[definition.animation];
        const frames = new Set(['idle', 'move', 'fire', 'death'].flatMap((state) => animation[state] as string[]));
        for (const frame of frames) this.load.image(frameTextureKey(raceId, 'unit', unitId, frame), frameUrl(raceId, definition.asset, frame));
      }
      for (const [buildingId, definition] of Object.entries(race.buildings)) {
        const frames = new Set(['idle', 'production', 'research', 'damaged', 'destroyed'].flatMap((state) => race.buildingAnimations[state] as string[]));
        for (const frame of frames) this.load.image(frameTextureKey(raceId, 'building', buildingId, frame), frameUrl(raceId, definition.asset, frame));
      }
    }
  }

  create(): void {
    const { width, height, bases } = this.controller.sim.state.map;
    const camera = this.cameras.main;
    camera.setBackgroundColor(0x141b24);
    camera.setSize(this.scale.width, this.scale.height);
    camera.setBounds(0, 0, width, height);
    // A close default view, WC3-style — roughly one base/resource cluster
    // per screen, not the whole neighborhood at once.
    camera.setZoom(2.2);
    camera.centerOn(bases[this.viewSide].x, bases[this.viewSide].y);
    this.drawTerrain();
    this.drawMapDecorations();

    // The canvas resizes to fill whatever space the match screen gives it
    // (see PhaserGame.tsx's Scale.RESIZE mode) — keep the camera's own
    // viewport in step, or it would stay pinned at its boot-time size.
    const onResize = (gameSize: Phaser.Structs.Size) => {
      camera.setSize(gameSize.width, gameSize.height);
      if (this.minimapCamera) {
        const y = gameSize.height - this.minimapRect.h - 16;
        this.minimapCamera.setPosition(this.minimapRect.x, y);
        this.minimapRect.y = y;
      }
    };
    this.scale.on('resize', onResize);

    this.input.mouse?.disableContextMenu();
    this.cursors = this.input.keyboard?.createCursorKeys();
    this.wasd = this.input.keyboard?.addKeys('W,A,S,D') as Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;
    // createCursorKeys()/addKeys() default to Phaser's "capture" mode, which
    // calls preventDefault() on these keys globally — regardless of DOM
    // focus. That silently ate every W/A/S/D and arrow keystroke typed into
    // the AI code editor (common letters — "was", "add", cursor navigation),
    // even though updateCamera() below already ignores them while the editor
    // is focused. Camera panning only needs the isDown state, not capture.
    this.input.keyboard?.clearCaptures();
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) {
        const store = useAppStore.getState();
        store.setFollowEntity(null); // manual pan overrides follow
        const panSpeed = store.cameraSettings.panSpeed;
        camera.scrollX -= ((pointer.x - pointer.prevPosition.x) / camera.zoom) * panSpeed;
        camera.scrollY -= ((pointer.y - pointer.prevPosition.y) / camera.zoom) * panSpeed;
        return;
      }
      if (this.minimapDragging && pointer.leftButtonDown()) {
        const mm = this.minimapRect;
        const clampedX = Phaser.Math.Clamp(pointer.x, mm.x, mm.x + mm.w);
        const clampedY = Phaser.Math.Clamp(pointer.y, mm.y, mm.y + mm.h);
        camera.centerOn((clampedX - mm.x) / mm.zoom, (clampedY - mm.y) / mm.zoom);
        return;
      }
      if (!this.dragSelectStart || !pointer.leftButtonDown()) return;
      // A plain click has some incidental pointer jitter — only treat it as a
      // drag once it's moved enough to be a deliberate box, in screen pixels
      // so the threshold doesn't change with camera zoom.
      if (!this.isDragSelecting && pointer.getDistance() > 6) this.isDragSelecting = true;
      if (this.isDragSelecting) this.updateDragSelectBox(pointer.worldX, pointer.worldY);
    });
    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _objects: unknown[], _dx: number, dy: number) => {
      const zoomSpeed = useAppStore.getState().cameraSettings.zoomSpeed;
      camera.setZoom(Phaser.Math.Clamp(camera.zoom - dy * 0.002 * zoomSpeed, 1.1, 3.2));
    });
    this.input.on('gameout', () => {
      this.pointerInGame = false;
    });
    this.input.on('gameover', () => {
      this.pointerInGame = true;
    });

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      gameAudio.unlock();
      if (pointer.rightButtonDown()) return;

      const mm = this.minimapRect;
      if (mm.w > 0 && pointer.x >= mm.x && pointer.x <= mm.x + mm.w && pointer.y >= mm.y && pointer.y <= mm.y + mm.h) {
        useAppStore.getState().setFollowEntity(null); // manual pan overrides follow
        this.minimapDragging = true;
        camera.centerOn((pointer.x - mm.x) / mm.zoom, (pointer.y - mm.y) / mm.zoom);
        return;
      }

      const store = useAppStore.getState();
      const world = { x: pointer.worldX, y: pointer.worldY };

      if (store.pendingCoordinateInsert) {
        store.resolveCoordinateInsert(world);
        return;
      }

      // Selection itself is resolved on pointerup, once we know whether this
      // was a click or turned into a drag — see the pointerup handler below.
      this.dragSelectStart = { x: pointer.worldX, y: pointer.worldY };
      this.isDragSelecting = false;
    });

    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      this.minimapDragging = false;
      if (!this.dragSelectStart) return;
      const start = this.dragSelectStart;
      const wasDragging = this.isDragSelecting;
      this.dragSelectStart = null;
      this.isDragSelecting = false;
      this.dragSelectBox?.clear().setVisible(false);

      const store = useAppStore.getState();
      if (!wasDragging) {
        const world = { x: pointer.worldX, y: pointer.worldY };
        const hit = this.hitTestEntity(world);
        store.setSelectedEntities(hit ? [hit] : []);
        if (hit) gameAudio.play('select', { pan: this.audioPan(world.x) });
        return;
      }

      // Drag-select is inspection only (see store.ts) — grabs every visible
      // unit in the box regardless of owner, buildings are click-only.
      const minX = Math.min(start.x, pointer.worldX);
      const maxX = Math.max(start.x, pointer.worldX);
      const minY = Math.min(start.y, pointer.worldY);
      const maxY = Math.max(start.y, pointer.worldY);
      const ids = this.controller.sim.state.units
        .filter((u) => this.isVisibleToViewer(u) && u.position.x >= minX && u.position.x <= maxX && u.position.y >= minY && u.position.y <= maxY)
        .map((u) => u.id);
      store.setSelectedEntities(ids);
      if (ids.length > 0) gameAudio.play('select', { pan: this.audioPan((minX + maxX) / 2) });
    });

    this.placementGhost = this.add.circle(0, 0, 14, 0x22c55e, 0.35).setVisible(false).setDepth(50);
    this.selectionRing = this.add.graphics().setVisible(false).setDepth(40);
    this.attackRangeRing = this.add.graphics().setDepth(3);
    this.dragSelectBox = this.add.graphics().setVisible(false).setDepth(45);
    this.visibilityMask = this.make.graphics({ x: 0, y: 0 });
    this.exploredMask = this.make.graphics({ x: 0, y: 0 });
    this.exploredTiles = new Uint8Array(this.controller.sim.state.map.terrainCols * this.controller.sim.state.map.terrainRows);

    // Seen terrain remains readable but muted outside current vision. Terrain
    // that has never been seen is covered by a second, fully opaque pure-black
    // shroud, giving fog the usual three RTS states instead of one grey state.
    this.fogOverlay = this.add.rectangle(0, 0, width, height, 0x05070a, 0.72).setOrigin(0).setDepth(80);
    const fogMask = this.visibilityMask.createGeometryMask();
    fogMask.invertAlpha = true;
    this.fogOverlay.setMask(fogMask);

    this.shroudOverlay = this.add.rectangle(0, 0, width, height, 0x000000, 1).setOrigin(0).setDepth(81);
    const shroudMask = this.exploredMask.createGeometryMask();
    shroudMask.invertAlpha = true;
    this.shroudOverlay.setMask(shroudMask);
    this.updateFogOfWar();

    this.minimapViewportRect = this.add.graphics().setDepth(200);
    camera.ignore(this.minimapViewportRect);
    this.setupMinimap(width, height);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubscribeStore?.();
      this.scale.off('resize', onResize);
    });
  }

  /** A Warcraft 3-style corner minimap: a second Phaser camera rendering the
   * same world zoomed out to fit entirely, bottom-left, with a click-to-jump
   * handler and a rectangle showing the main camera's current view. It
   * shares fog-of-war with the main view for free — entity visibility is a
   * property of the game objects themselves (see drawEntity), not per-camera. */
  private setupMinimap(mapWidth: number, mapHeight: number): void {
    const boxWidth = 260;
    const boxHeight = boxWidth * (mapHeight / mapWidth);
    const zoom = boxWidth / mapWidth;
    const x = 16;
    const y = this.scale.height - boxHeight - 16;

    this.minimapCamera = this.cameras.add(x, y, boxWidth, boxHeight, false, 'minimap');
    this.minimapCamera.setBounds(0, 0, mapWidth, mapHeight).setZoom(zoom).setScroll(0, 0).setBackgroundColor(0x05070c);
    // A hint of the main view shows through behind it, like a translucent
    // HUD panel rather than a fully opaque tile stamped over the game.
    this.minimapCamera.setAlpha(0.92);
    // Keep both fog layers in this camera so the minimap cannot reveal the
    // unexplored terrain. Transient editor/selection helpers stay main-view only.
    const toIgnore = [this.placementGhost, this.selectionRing, this.attackRangeRing, this.dragSelectBox].filter((o) => !!o) as Phaser.GameObjects.GameObject[];
    this.minimapCamera.ignore(toIgnore);
    this.minimapRect = { x, y, w: boxWidth, h: boxHeight, zoom };

    // Frame: drawn in world coordinates right at the map's own edges, with a
    // line width scaled by 1/zoom so it reads as a constant ~3px border on
    // screen no matter how large the map is. Only the minimap camera should
    // ever see it — the main view would otherwise show it as a giant box
    // drawn around the whole battlefield.
    const frame = this.add.graphics().setDepth(500);
    const frameLineWidth = 3 / zoom;
    frame.lineStyle(frameLineWidth, 0x94a3b8, 0.9);
    frame.strokeRect(frameLineWidth / 2, frameLineWidth / 2, mapWidth - frameLineWidth, mapHeight - frameLineWidth);
    this.cameras.main.ignore(frame);

    // Blips: units/buildings render as fixed-screen-size team-colored dots on
    // the minimap instead of their true (often sub-pixel-at-this-zoom) sprite
    // size — see updateMinimapBlips(). Only the minimap camera renders these.
    this.minimapBlips = this.add.graphics().setDepth(510);
    this.cameras.main.ignore(this.minimapBlips);
  }

  /** Fixed-apparent-size team-colored dots for every unit/building the viewer
   * can currently see (or, for enemy buildings, remembers) — the same rule
   * drawEntity() uses for main-view visibility, so the minimap never reveals
   * anything the fog of war wouldn't otherwise show. Drawn every frame since
   * entities move; the border frame above only needs drawing once. */
  private updateMinimapBlips(): void {
    if (!this.minimapBlips || !this.minimapCamera) return;
    const g = this.minimapBlips;
    g.clear();
    const zoom = this.minimapCamera.zoom;
    const unitRadius = 3 / zoom;
    const buildingRadius = 5 / zoom;

    for (const u of this.controller.sim.state.units) {
      if (!this.isVisibleToViewer(u)) continue;
      g.fillStyle(this.controller.sim.state.players[u.owner].color, 1);
      g.fillCircle(u.position.x, u.position.y, unitRadius);
    }
    for (const b of this.controller.sim.state.buildings) {
      const currentlyVisible = this.isVisibleToViewer(b);
      const remembered = !currentlyVisible && this.seenEnemyBuildingIds.has(b.id);
      if (!currentlyVisible && !remembered) continue;
      g.fillStyle(this.controller.sim.state.players[b.owner].color, remembered ? 0.5 : 1);
      g.fillRect(b.position.x - buildingRadius, b.position.y - buildingRadius, buildingRadius * 2, buildingRadius * 2);
    }
  }

  update(_time: number, deltaMs: number): void {
    const store = useAppStore.getState();
    const frameDt = Math.min(deltaMs / 1000, 0.25);
    this.updateCamera(frameDt, store);

    if (!store.isPaused) {
      const speedScale = store.simSpeed;
      this.simAccumulator += frameDt * speedScale;
      let steps = 0;
      while (this.simAccumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
        this.controller.update(FIXED_DT);
        this.simAccumulator -= FIXED_DT;
        steps += 1;
      }
    }

    this.syncEntities(this.controller.sim.state.units, this.unitVisuals, false);
    this.syncEntities(this.controller.sim.state.buildings, this.buildingVisuals, true);
    this.initialEntitySyncComplete = true;
    this.syncProjectiles(this.controller.sim.state.projectiles);
    this.updatePlacementGhost();
    this.updateSelectionRing();
    this.updateMinimapViewportRect();
    this.updateMinimapBlips();

    this.fogAccumulator += frameDt;
    if (this.fogAccumulator >= SNAPSHOT_INTERVAL) {
      this.fogAccumulator = 0;
      this.updateFogOfWar();
    }

    this.hudAccumulator += frameDt;
    if (this.hudAccumulator >= SNAPSHOT_INTERVAL) {
      this.hudAccumulator = 0;
      this.pushHud();
    }
  }

  private updateCamera(dt: number, store: ReturnType<typeof useAppStore.getState>): void {
    const active = document.activeElement;
    if (active?.closest('.cm-editor, input, textarea')) return;
    const camera = this.cameras.main;
    const amount = ((620 * dt) / camera.zoom) * store.cameraSettings.panSpeed;
    const left = this.cursors?.left.isDown || this.wasd?.A.isDown;
    const right = this.cursors?.right.isDown || this.wasd?.D.isDown;
    const up = this.cursors?.up.isDown || this.wasd?.W.isDown;
    const down = this.cursors?.down.isDown || this.wasd?.S.isDown;

    if (left || right || up || down) {
      if (store.followEntityId) store.setFollowEntity(null); // manual pan overrides follow
      if (left) camera.scrollX -= amount;
      if (right) camera.scrollX += amount;
      if (up) camera.scrollY -= amount;
      if (down) camera.scrollY += amount;
      return;
    }

    // Edge-of-screen panning: nudge the camera whenever the cursor rests
    // near the viewport border, no button held — the fullscreen view has no
    // browser chrome to remind players that right-drag/WASD exist at all.
    if (this.pointerInGame && !this.dragSelectStart && !this.minimapDragging) {
      const pointer = this.input.activePointer;
      const mm = this.minimapRect;
      const overMinimap = mm.w > 0 && pointer.x >= mm.x && pointer.x <= mm.x + mm.w && pointer.y >= mm.y && pointer.y <= mm.y + mm.h;
      if (!overMinimap && !pointer.rightButtonDown()) {
        const EDGE = 24;
        let edgeX = 0;
        let edgeY = 0;
        if (pointer.x < EDGE) edgeX = -1;
        else if (pointer.x > camera.width - EDGE) edgeX = 1;
        if (pointer.y < EDGE) edgeY = -1;
        else if (pointer.y > camera.height - EDGE) edgeY = 1;
        if (edgeX !== 0 || edgeY !== 0) {
          if (store.followEntityId) store.setFollowEntity(null);
          camera.scrollX += edgeX * amount;
          camera.scrollY += edgeY * amount;
          return;
        }
      }
    }

    // "Follow unit" (see SelectedEntityPanel): keep this entity centered
    // every frame until the player pans manually or it stops existing.
    if (store.followEntityId) {
      const unit = this.controller.sim.state.units.find((u) => u.id === store.followEntityId);
      if (unit && unit.hp > 0) {
        camera.centerOn(unit.position.x, unit.position.y);
      } else {
        store.setFollowEntity(null);
      }
    }
  }

  private updateFogOfWar(): void {
    if (!this.visibilityMask || !this.exploredMask) return;
    const sim = this.controller.sim;
    const map = sim.state.map;
    this.visibilityMask.clear();
    this.visibilityMask.fillStyle(0xffffff, 1);
    for (const unit of sim.getUnits(this.viewSide)) {
      this.visibilityMask.fillCircle(unit.position.x, unit.position.y, unit.sight);
      this.revealExploredTiles(unit.position.x, unit.position.y, unit.sight);
    }
    for (const building of sim.getBuildings(this.viewSide)) {
      if (!building.underConstruction) {
        this.visibilityMask.fillCircle(building.position.x, building.position.y, BUILDING_SIGHT);
        this.revealExploredTiles(building.position.x, building.position.y, BUILDING_SIGHT);
      }
    }

    this.exploredMask.clear();
    this.exploredMask.fillStyle(0xffffff, 1);
    for (let row = 0; row < map.terrainRows; row += 1) {
      for (let col = 0; col < map.terrainCols; col += 1) {
        if (this.exploredTiles[row * map.terrainCols + col]) {
          this.exploredMask.fillRect(col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        }
      }
    }
  }

  private revealExploredTiles(x: number, y: number, sight: number): void {
    const map = this.controller.sim.state.map;
    const padding = TILE_SIZE * Math.SQRT1_2;
    const minCol = Math.max(0, Math.floor((x - sight - padding) / TILE_SIZE));
    const maxCol = Math.min(map.terrainCols - 1, Math.floor((x + sight + padding) / TILE_SIZE));
    const minRow = Math.max(0, Math.floor((y - sight - padding) / TILE_SIZE));
    const maxRow = Math.min(map.terrainRows - 1, Math.floor((y + sight + padding) / TILE_SIZE));
    const revealRadiusSq = (sight + padding) ** 2;

    for (let row = minRow; row <= maxRow; row += 1) {
      for (let col = minCol; col <= maxCol; col += 1) {
        const tileX = col * TILE_SIZE + TILE_SIZE / 2;
        const tileY = row * TILE_SIZE + TILE_SIZE / 2;
        const dx = tileX - x;
        const dy = tileY - y;
        if (dx * dx + dy * dy <= revealRadiusSq) this.exploredTiles[row * map.terrainCols + col] = 1;
      }
    }
  }

  private isVisibleToViewer(entity: UnitState | BuildingState): boolean {
    if (entity.owner === this.viewSide) return true;
    // A freshly-queued enemy foundation (no real construction progress yet)
    // is invisible to everyone but its owner no matter how good the
    // viewer's vision of that spot is — see Simulation.isBuildingVisibleTo.
    if (entity.kind === 'building' && entity.underConstruction && entity.constructionProgress <= 0) return false;
    return this.isPositionVisibleToViewer(entity.position.x, entity.position.y);
  }

  private isPositionVisibleToViewer(x: number, y: number): boolean {
    const sim = this.controller.sim;
    for (const unit of sim.getUnits(this.viewSide)) {
      if (Phaser.Math.Distance.Between(unit.position.x, unit.position.y, x, y) <= unit.sight) return true;
    }
    for (const building of sim.getBuildings(this.viewSide)) {
      if (
        !building.underConstruction &&
        Phaser.Math.Distance.Between(building.position.x, building.position.y, x, y) <= BUILDING_SIGHT
      ) {
        return true;
      }
    }
    return false;
  }

  private updateDragSelectBox(curX: number, curY: number): void {
    if (!this.dragSelectStart || !this.dragSelectBox) return;
    const x = Math.min(this.dragSelectStart.x, curX);
    const y = Math.min(this.dragSelectStart.y, curY);
    const w = Math.abs(curX - this.dragSelectStart.x);
    const h = Math.abs(curY - this.dragSelectStart.y);
    this.dragSelectBox.clear();
    this.dragSelectBox.fillStyle(0xfacc15, 0.12);
    this.dragSelectBox.fillRect(x, y, w, h);
    this.dragSelectBox.lineStyle(1.5, 0xfacc15, 0.85);
    this.dragSelectBox.strokeRect(x, y, w, h);
    this.dragSelectBox.setVisible(true);
  }

  /** Finds the entity nearest a click within its own selection radius, or null. */
  private hitTestEntity(world: { x: number; y: number }): string | null {
    const sim = this.controller.sim;
    let bestId: string | null = null;
    let bestDist = Infinity;

    for (const u of sim.state.units) {
      if (!this.isVisibleToViewer(u)) continue;
      const r = entityDisplaySize(u) * 0.48;
      const d = Phaser.Math.Distance.Between(world.x, world.y, u.position.x, u.position.y);
      if (d <= r + 6 && d < bestDist) {
        bestDist = d;
        bestId = u.id;
      }
    }
    for (const b of sim.state.buildings) {
      if (!this.isVisibleToViewer(b)) continue;
      const size = entityRenderSize(b);
      const d = Phaser.Math.Distance.Between(world.x, world.y, b.position.x, b.position.y);
      if (d <= size / 2 + 6 && d < bestDist) {
        bestDist = d;
        bestId = b.id;
      }
    }
    return bestId;
  }

  private updateSelectionRing(): void {
    if (!this.selectionRing) return;
    this.attackRangeRing?.clear();
    this.selectionRing.clear();
    this.selectionRing.setPosition(0, 0);
    const store = useAppStore.getState();
    const ids = store.selectedEntityIds;
    const sim = this.controller.sim.state;
    const entities = ids
      .map((id) => sim.units.find((u) => u.id === id) ?? sim.buildings.find((b) => b.id === id))
      .filter((e): e is UnitState | BuildingState => !!e);

    // Selection is live information. Remembered structures may still be drawn
    // dimly, but they cannot keep a ring, range indicator, or inspector panel
    // after leaving current vision.
    const stillVisible = entities.filter((e) => this.isVisibleToViewer(e));
    if (stillVisible.length !== ids.length) {
      const visibleIds = stillVisible.map((e) => e.id);
      store.setSelectedEntities(visibleIds);
      if (visibleIds.length === 0) {
        this.selectionRing.setVisible(false);
        return;
      }
    }
    if (stillVisible.length === 0) {
      this.selectionRing.setVisible(false);
      return;
    }

    this.selectionRing.setVisible(true);
    for (const entity of stillVisible) {
      const selectionRadius = entity.kind === 'building'
        ? entityRenderSize(entity) * 0.45
        : entityMarkerRadius(entity) + 3;
      // The dark outside stroke keeps the indicator readable over bright tiles;
      // the slimmer gold stroke is the actual selection color.
      this.selectionRing.lineStyle(4, 0x020617, 0.72);
      this.selectionRing.strokeCircle(entity.position.x, entity.position.y, selectionRadius);
      this.selectionRing.lineStyle(2, 0xfacc15, 0.96);
      this.selectionRing.strokeCircle(entity.position.x, entity.position.y, selectionRadius);
    }

    // Range indicators only make sense for a single focused entity — with a
    // whole group selected they'd just be visual noise.
    if (stillVisible.length !== 1 || !this.attackRangeRing) return;
    const entity = stillVisible[0];
    const attackRange = entity.attackRange ?? 0;
    if (attackRange > 0) {
      this.attackRangeRing.lineStyle(1, 0xfacc15, 0.24);
      this.attackRangeRing.strokeCircle(entity.position.x, entity.position.y, attackRange);
    }
    if (entity.kind === 'building' && (entity.type === 'outpost' || entity.type === 'commandCenter')) {
      this.attackRangeRing.lineStyle(1.5, 0x67e8f9, 0.18);
      this.attackRangeRing.strokeCircle(entity.position.x, entity.position.y, RESOURCE_GARRISON_RADIUS);
    }
  }

  private updateMinimapViewportRect(): void {
    if (!this.minimapViewportRect) return;
    const view = this.cameras.main.worldView;
    this.minimapViewportRect.clear();
    this.minimapViewportRect.lineStyle(3, 0xffffff, 0.95);
    this.minimapViewportRect.strokeRect(view.x, view.y, view.width, view.height);
  }

  private syncProjectiles(projectiles: ProjectileState[]): void {
    const seen = new Set<string>();

    for (const projectile of projectiles) {
      seen.add(projectile.id);
      const visible = projectile.owner === this.viewSide || this.isPositionVisibleToViewer(projectile.position.x, projectile.position.y);
      let visual = this.projectileVisuals.get(projectile.id);
      if (!visual) {
        const projectileRace = this.controller.sim.state.players[projectile.owner].race;
        const color = this.projectileColor(projectile.kind, projectileRace);
        visual = this.add.graphics().setDepth(30);
        this.drawProjectile(visual, projectile.kind, color, this.controller.sim.state.players[projectile.owner].color);
        visual.setData('kind', projectile.kind);
        this.projectileVisuals.set(projectile.id, visual);
        const target = this.controller.sim.state.units.find((unit) => unit.id === projectile.targetId)
          ?? this.controller.sim.state.buildings.find((building) => building.id === projectile.targetId);
        if (target) visual.setRotation(Math.atan2(target.position.y - projectile.position.y, target.position.x - projectile.position.x));
        visual.setData('lastTrailAt', this.controller.sim.state.time);
        if (visible && this.isPositionOnScreen(projectile.position.x, projectile.position.y)) {
          this.spawnMuzzleFlash(projectile.position.x, projectile.position.y, color, this.projectileMuzzleSize(projectile.kind));
          this.playWorldSound(projectile.kind as GameSoundCue, projectile.position.x, projectile.position.y, projectile.owner === this.viewSide ? 1 : 0.78);
        }
        if (
          target?.owner === this.viewSide
          && projectile.owner !== this.viewSide
          && (projectile.kind === 'artillery' || projectile.kind === 'bomb' || projectile.kind === 'meteor')
        ) {
          this.playWorldSound('incomingOrdnance', target.position.x, target.position.y, 0.84);
        }
      } else {
        const dx = projectile.position.x - visual.x;
        const dy = projectile.position.y - visual.y;
        if (dx * dx + dy * dy > 0.001) visual.setRotation(Math.atan2(dy, dx));
        const lastTrailAt = Number(visual.getData('lastTrailAt') ?? 0);
        if (visible && this.controller.sim.state.time - lastTrailAt >= this.projectileTrailInterval(projectile.kind)) {
          const projectileRace = this.controller.sim.state.players[projectile.owner].race;
          this.spawnProjectileTrail(visual.x, visual.y, this.projectileColor(projectile.kind, projectileRace), projectile.kind);
          visual.setData('lastTrailAt', this.controller.sim.state.time);
        }
      }
      const pulse = 1 + Math.sin(this.controller.sim.state.time * 11 + projectile.id.length) * this.projectilePulseAmount(projectile.kind);
      visual.setScale(pulse);
      visual.setPosition(projectile.position.x, projectile.position.y).setVisible(visible);
    }

    for (const [id, visual] of this.projectileVisuals) {
      if (!seen.has(id)) {
        const kind = visual.getData('kind') as ProjectileState['kind'];
        if (visual.visible) {
          const size = this.projectileImpactSize(kind);
          const impactCue = this.projectileImpactCue(kind);
          this.spawnExplosion(visual.x, visual.y, size, impactCue, this.projectileImpactColor(kind));
        }
        visual.destroy();
        this.projectileVisuals.delete(id);
      }
    }
  }

  private projectileColor(kind: ProjectileState['kind'], race: UnitState['race']): number {
    switch (kind) {
      case 'artillery': return 0xff8a1f;
      case 'bomb': return 0xff6b35;
      case 'meteor': return 0x86efac;
      case 'torpedo': return 0x22d3ee;
      case 'rocket': return 0xffd166;
      case 'missile': return 0xfb923c;
      case 'flak': return 0xfde68a;
      case 'shell': return 0xf59e0b;
      case 'cannon': return 0xfbbf24;
      case 'tracer': return 0xfef08a;
      case 'laser': return 0x67e8f9;
      case 'plasma': return race === 'aether' ? 0xa7f3d0 : 0xc084fc;
      case 'ion': return 0x38bdf8;
      case 'pulse': return race === 'aether' ? 0x86efac : 0x22d3ee;
      case 'railgun': return 0xf8fafc;
      case 'crystal': return 0x6ee7b7;
      case 'shard': return 0xa7f3d0;
      case 'acid': return 0xa3e635;
      default: return RACES[race].colors.projectile;
    }
  }

  private drawProjectile(graphics: Phaser.GameObjects.Graphics, kind: ProjectileState['kind'], color: number, ownerColor: number): void {
    graphics.clear();
    switch (kind) {
      case 'laser':
        graphics.lineStyle(7, color, 0.2).lineBetween(-13, 0, 13, 0);
        graphics.lineStyle(2, 0xffffff, 0.95).lineBetween(-12, 0, 12, 0);
        break;
      case 'railgun':
        graphics.lineStyle(6, ownerColor, 0.18).lineBetween(-18, 0, 18, 0);
        graphics.lineStyle(2, color, 1).lineBetween(-17, 0, 17, 0);
        break;
      case 'tracer':
        graphics.lineStyle(5, color, 0.16).lineBetween(-10, 0, 5, 0);
        graphics.lineStyle(1.5, 0xffffff, 0.95).lineBetween(-8, 0, 5, 0);
        graphics.fillStyle(color, 1).fillCircle(6, 0, 1.8);
        break;
      case 'pulse':
        graphics.fillStyle(color, 0.14).fillCircle(0, 0, 9);
        graphics.lineStyle(2, color, 0.82).strokeCircle(0, 0, 5.5);
        graphics.fillStyle(0xffffff, 0.95).fillCircle(0, 0, 2.2);
        break;
      case 'ion':
        graphics.lineStyle(6, color, 0.16).lineBetween(-12, 0, 9, 0);
        graphics.lineStyle(2, 0xe0f2fe, 0.95);
        graphics.beginPath().moveTo(-11, 2).lineTo(-5, -2).lineTo(0, 2).lineTo(5, -2).lineTo(10, 0).strokePath();
        break;
      case 'plasma':
        graphics.fillStyle(color, 0.2).fillCircle(0, 0, 8);
        graphics.fillStyle(color, 0.95).fillCircle(0, 0, 4.5);
        graphics.lineStyle(1, 0xffffff, 0.8).strokeCircle(0, 0, 3);
        break;
      case 'crystal':
        graphics.fillStyle(color, 0.32).fillCircle(0, 0, 7);
        graphics.fillStyle(0xffffff, 0.95).fillTriangle(-7, 0, 0, -4, 0, 4);
        graphics.fillStyle(color, 1).fillTriangle(0, -4, 8, 0, 0, 4);
        break;
      case 'shard':
        graphics.fillStyle(color, 0.22).fillCircle(0, 0, 8);
        graphics.fillStyle(0xecfeff, 1).fillTriangle(-9, 0, 1, -3.5, 1, 3.5);
        graphics.fillStyle(color, 1).fillTriangle(0, -3.5, 10, 0, 0, 3.5);
        graphics.lineStyle(1, 0xffffff, 0.75).lineBetween(-5, 0, 7, 0);
        break;
      case 'acid':
        graphics.fillStyle(color, 0.16).fillCircle(-3, 0, 8);
        graphics.fillStyle(color, 0.9).fillCircle(1, 0, 5);
        graphics.fillStyle(0xecfccb, 0.9).fillCircle(3, -2, 2);
        graphics.fillStyle(0x4d7c0f, 0.7).fillCircle(-5, 2, 2.5);
        break;
      case 'rocket':
        graphics.fillStyle(0xfff4c2, 1).fillTriangle(7, 0, -5, -3.5, -5, 3.5);
        graphics.lineStyle(3, color, 0.55).lineBetween(-6, 0, -12, 0);
        break;
      case 'missile':
        graphics.fillStyle(0xf8fafc, 1).fillRoundedRect(-7, -2.5, 14, 5, 2);
        graphics.fillStyle(color, 1).fillTriangle(8, 0, 3, -3.5, 3, 3.5);
        graphics.fillStyle(0xfb7185, 0.9).fillTriangle(-7, 0, -13, -3, -13, 3);
        break;
      case 'flak':
        graphics.fillStyle(color, 0.25).fillCircle(0, 0, 7);
        graphics.fillStyle(0xffffff, 1).fillCircle(3, -2.5, 2.2);
        graphics.fillStyle(color, 1).fillCircle(3, 2.5, 2.2);
        graphics.lineStyle(1, ownerColor, 0.8).strokeCircle(0, 0, 5);
        break;
      case 'torpedo':
        graphics.fillStyle(color, 0.24).fillEllipse(0, 0, 16, 7);
        graphics.fillStyle(0xe0f2fe, 0.95).fillEllipse(1, 0, 10, 4);
        break;
      case 'bomb':
        graphics.fillStyle(color, 0.25).fillEllipse(0, 0, 13, 9);
        graphics.fillStyle(0x1f2937, 1).fillEllipse(1, 0, 9, 6);
        graphics.fillStyle(color, 1).fillTriangle(-4, -3, -9, -6, -7, 0);
        graphics.fillStyle(color, 1).fillTriangle(-4, 3, -9, 6, -7, 0);
        break;
      case 'meteor':
        graphics.lineStyle(6, color, 0.2).lineBetween(-16, 0, -2, 0);
        graphics.fillStyle(color, 0.22).fillCircle(1, 0, 10);
        graphics.fillStyle(0x14532d, 1).fillCircle(2, 0, 6);
        graphics.fillStyle(0xd9f99d, 0.95).fillCircle(4, -2, 2.5);
        break;
      case 'artillery':
        graphics.fillStyle(color, 0.28).fillCircle(0, 0, 9);
        graphics.fillStyle(color, 1).fillCircle(0, 0, 5.5);
        graphics.lineStyle(1, 0xfff4c2, 0.9).strokeCircle(0, 0, 4);
        break;
      case 'shell':
        graphics.fillStyle(ownerColor, 0.3).fillCircle(0, 0, 6);
        graphics.fillStyle(color, 1).fillCircle(0, 0, 4);
        break;
      case 'cannon':
        graphics.lineStyle(5, ownerColor, 0.22).lineBetween(-10, 0, 1, 0);
        graphics.fillStyle(color, 0.3).fillCircle(2, 0, 7);
        graphics.fillStyle(0xf8fafc, 1).fillCircle(3, 0, 3.8);
        graphics.lineStyle(1.2, color, 0.95).strokeCircle(3, 0, 4.5);
        break;
      default:
        graphics.lineStyle(3, color, 0.35).lineBetween(-6, 0, 3, 0);
        graphics.fillStyle(0xffffff, 1).fillCircle(3, 0, 2.3);
        break;
    }
  }

  private projectileMuzzleSize(kind: ProjectileState['kind']): number {
    if (kind === 'artillery' || kind === 'cannon' || kind === 'meteor') return 14;
    if (kind === 'plasma' || kind === 'rocket' || kind === 'missile' || kind === 'bomb') return 10;
    if (kind === 'laser' || kind === 'railgun' || kind === 'pulse' || kind === 'tracer') return 7;
    return 8;
  }

  private projectileImpactSize(kind: ProjectileState['kind']): number {
    if (kind === 'artillery') return 140;
    if (kind === 'bomb') return 170;
    if (kind === 'meteor') return 150;
    if (kind === 'rocket' || kind === 'missile' || kind === 'torpedo' || kind === 'cannon') return 54;
    if (kind === 'plasma') return 46;
    if (kind === 'laser' || kind === 'railgun' || kind === 'ion' || kind === 'pulse') return 24;
    if (kind === 'crystal' || kind === 'shard') return 32;
    if (kind === 'acid') return 42;
    if (kind === 'tracer' || kind === 'flak') return 26;
    return 34;
  }

  private projectileImpactColor(kind: ProjectileState['kind']): number {
    if (kind === 'laser' || kind === 'torpedo' || kind === 'ion' || kind === 'pulse') return 0x22d3ee;
    if (kind === 'plasma') return 0xc084fc;
    if (kind === 'railgun') return 0xf8fafc;
    if (kind === 'crystal' || kind === 'shard' || kind === 'meteor') return 0x6ee7b7;
    if (kind === 'acid') return 0xa3e635;
    return 0xff8a1f;
  }

  private projectileImpactCue(kind: ProjectileState['kind']): GameSoundCue {
    if (kind === 'torpedo') return 'impactWater';
    if (kind === 'laser' || kind === 'plasma' || kind === 'ion' || kind === 'pulse' || kind === 'railgun') return 'impactEnergy';
    if (kind === 'crystal' || kind === 'shard') return 'impactCrystal';
    if (kind === 'acid') return 'impactAcid';
    if (kind === 'artillery' || kind === 'bomb' || kind === 'meteor' || kind === 'rocket' || kind === 'missile' || kind === 'cannon') return 'impactHeavy';
    return 'impactMetal';
  }

  private projectileTrailInterval(kind: ProjectileState['kind']): number {
    if (kind === 'bullet' || kind === 'shell' || kind === 'tracer' || kind === 'flak') return Infinity;
    if (kind === 'laser' || kind === 'railgun') return 0.09;
    return 0.055;
  }

  private projectilePulseAmount(kind: ProjectileState['kind']): number {
    if (kind === 'pulse' || kind === 'plasma' || kind === 'acid') return 0.14;
    if (kind === 'meteor' || kind === 'crystal' || kind === 'shard') return 0.08;
    return 0;
  }

  /** Renders the simulation terrain as a real auto-tiled battlefield.
   * Tile indices are derived from the exact same land/water grid used by A*,
   * so a visible shoreline is always a real movement boundary.
   *
   * Land isn't just a random pick per tile — that reads as static, not ground.
   * Instead a smooth value-noise field assigns each tile a position on a
   * grass -> dirt -> rock "elevation" gradient, and tiles near a band edge
   * get a canvas-composited blend of both textures (base + alpha overlay).
   * Because the noise changes gradually tile-to-tile, the quantized alpha
   * steps line up into a soft gradient a few tiles wide instead of a hard
   * edge — the same trick as a dithered gradient at tile resolution. */
  private drawTerrain(): void {
    const map = this.controller.sim.state.map;
    const tileset = TERRAIN_TILESETS[map.tileset as TerrainTilesetId];
    if (!tileset) {
      this.drawTerrainGeneratedFallback();
      return;
    }

    const atlasKey = `terrain-runtime-${tileset.id}`;
    const isLand = (col: number, row: number): boolean =>
      col >= 0 && row >= 0 && col < map.terrainCols && row < map.terrainRows && map.terrain[row * map.terrainCols + col] === 'land';

    const choose = <T,>(col: number, row: number, salt: number, choices: T[]): T => {
      let hash = Math.imul(col + 17, 0x45d9f3b) ^ Math.imul(row + 31, 0x119de1f3) ^ salt;
      hash ^= hash >>> 16;
      return choices[(hash >>> 0) % Math.max(1, choices.length)];
    };

    // Atlas cells are registered lazily: a plain source tile, or a two-layer
    // blend composited once and reused by every tile that needs that exact pair.
    const atlasIndexByKey = new Map<string, number>();
    const drawOps: Array<(ctx: CanvasRenderingContext2D, x: number) => void> = [];
    const sourceImage = (id: string) => this.textures.get(terrainTileTextureKey(tileset.id, id)).getSourceImage() as CanvasImageSource;
    const registerPlain = (id: string): number => {
      const existing = atlasIndexByKey.get(id);
      if (existing !== undefined) return existing;
      const index = drawOps.length;
      drawOps.push((ctx, x) => ctx.drawImage(sourceImage(id), x, 0, TILE_SIZE, TILE_SIZE));
      atlasIndexByKey.set(id, index);
      return index;
    };
    const registerBlend = (base: string, overlay: string, alpha: number): number => {
      const key = `${base}>${overlay}@${alpha}`;
      const existing = atlasIndexByKey.get(key);
      if (existing !== undefined) return existing;
      const index = drawOps.length;
      drawOps.push((ctx, x) => {
        ctx.drawImage(sourceImage(base), x, 0, TILE_SIZE, TILE_SIZE);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.drawImage(sourceImage(overlay), x, 0, TILE_SIZE, TILE_SIZE);
        ctx.restore();
      });
      atlasIndexByKey.set(key, index);
      return index;
    };

    const hashLattice = (x: number, y: number, seed: number): number => {
      let h = Math.imul(x | 0, 0x27d4eb2f) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
      h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
      h ^= h >>> 13;
      h = Math.imul(h, 0xc2b2ae35);
      h ^= h >>> 16;
      return (h >>> 0) / 4294967295;
    };
    const smooth01 = (t: number): number => {
      const c = t < 0 ? 0 : t > 1 ? 1 : t;
      return c * c * (3 - 2 * c);
    };
    const valueNoise = (x: number, y: number, seed: number): number => {
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const tx = smooth01(x - x0);
      const ty = smooth01(y - y0);
      const n00 = hashLattice(x0, y0, seed);
      const n10 = hashLattice(x0 + 1, y0, seed);
      const n01 = hashLattice(x0, y0 + 1, seed);
      const n11 = hashLattice(x0 + 1, y0 + 1, seed);
      const nx0 = n00 + (n10 - n00) * tx;
      const nx1 = n01 + (n11 - n01) * tx;
      return nx0 + (nx1 - nx0) * ty;
    };
    // Coarse octave shapes broad regions; a finer octave breaks up their edges
    // so borders read as organic coastline rather than a smooth ellipse.
    const biomeNoise = (col: number, row: number): number =>
      valueNoise(col / 9, row / 9, 0x71a5) * 0.75 + valueNoise(col / 3.2, row / 3.2, 0xf00d) * 0.25;

    const grassIds = tileset.land.filter((id) => id.startsWith('verdant'));
    const dirtId = tileset.land.find((id) => id.startsWith('earth'));
    const rockId = tileset.land.find((id) => id.startsWith('slate'));
    const canBlendBiomes = grassIds.length > 0 && !!dirtId && !!rockId;

    const GRASS_DIRT = 0.55;
    const DIRT_ROCK = 0.8;
    const BLEND = 0.07;
    const STEPS = 8;
    const quantize = (t: number): number => Math.round(smooth01(t) * STEPS) / STEPS;

    const landTileIndex = (col: number, row: number): number => {
      if (!canBlendBiomes) return registerPlain(choose(col, row, 0x71a5, tileset.land));
      // Grass variant switches per noise-cell block, not per tile, so a single
      // patch of ground reads as one field instead of a fine-grained speckle.
      const grass = choose(Math.floor(col / 4), Math.floor(row / 4), 0xa11ce, grassIds);
      const n = biomeNoise(col, row);
      if (n < GRASS_DIRT - BLEND) return registerPlain(grass);
      if (n < GRASS_DIRT + BLEND) {
        const alpha = quantize((n - (GRASS_DIRT - BLEND)) / (2 * BLEND));
        if (alpha <= 0) return registerPlain(grass);
        if (alpha >= 1) return registerPlain(dirtId!);
        return registerBlend(grass, dirtId!, alpha);
      }
      if (n < DIRT_ROCK - BLEND) return registerPlain(dirtId!);
      if (n < DIRT_ROCK + BLEND) {
        const alpha = quantize((n - (DIRT_ROCK - BLEND)) / (2 * BLEND));
        if (alpha <= 0) return registerPlain(dirtId!);
        if (alpha >= 1) return registerPlain(rockId!);
        return registerBlend(dirtId!, rockId!, alpha);
      }
      return registerPlain(rockId!);
    };

    const tileIndexGrid = new Int32Array(map.terrainCols * map.terrainRows);
    for (let row = 0; row < map.terrainRows; row += 1) {
      for (let col = 0; col < map.terrainCols; col += 1) {
        const cell = row * map.terrainCols + col;
        if (isLand(col, row)) {
          tileIndexGrid[cell] = landTileIndex(col, row);
          continue;
        }
        const mask = (isLand(col, row - 1) ? 1 : 0)
          | (isLand(col + 1, row) ? 2 : 0)
          | (isLand(col, row + 1) ? 4 : 0)
          | (isLand(col - 1, row) ? 8 : 0);
        tileIndexGrid[cell] = mask === 0
          ? registerPlain(choose(col, row, 0xb10e, tileset.water))
          : registerPlain(tileset.shore[mask]);
      }
    }

    if (!this.textures.exists(atlasKey)) {
      const canvas = this.textures.createCanvas(atlasKey, TILE_SIZE * drawOps.length, TILE_SIZE);
      const context = canvas?.getContext();
      if (!canvas || !context) {
        this.drawTerrainGeneratedFallback();
        return;
      }
      drawOps.forEach((draw, index) => draw(context, index * TILE_SIZE));
      canvas.refresh();
    }

    const tilemap = this.make.tilemap({ width: map.terrainCols, height: map.terrainRows, tileWidth: TILE_SIZE, tileHeight: TILE_SIZE });
    const phaserTileset = tilemap.addTilesetImage(atlasKey, atlasKey, TILE_SIZE, TILE_SIZE, 0, 0);
    if (!phaserTileset) return;
    const layer = tilemap.createBlankLayer('terrain', phaserTileset, 0, 0);
    if (!layer) return;
    layer.setDepth(-20);

    for (let row = 0; row < map.terrainRows; row += 1) {
      for (let col = 0; col < map.terrainCols; col += 1) {
        layer.putTileAt(tileIndexGrid[row * map.terrainCols + col], col, row);
      }
    }
  }

  /** Emergency fallback for a third-party map that names a tileset which
   * was not packaged with the build. Gameplay remains visible instead of
   * crashing, while valid map packs use the individual PNG library above. */
  private drawTerrainGeneratedFallback(): void {
    const map = this.controller.sim.state.map;
    const tilesetKey = 'terrain-tileset';
    const LAND_VARIANTS = 4;
    const WATER_VARIANTS = 4;
    const SHORE_START = LAND_VARIANTS + WATER_VARIANTS;
    const TILE_COUNT = SHORE_START + 16;

    const variantAt = (col: number, row: number, salt: number, variants: number): number => {
      let hash = Math.imul(col + 17, 0x45d9f3b) ^ Math.imul(row + 31, 0x119de1f3) ^ salt;
      hash ^= hash >>> 16;
      return Math.abs(hash) % variants;
    };

    const neighborMask = (col: number, row: number): number => {
      const isLand = (x: number, y: number): boolean => {
        if (x < 0 || y < 0 || x >= map.terrainCols || y >= map.terrainRows) return false;
        return map.terrain[y * map.terrainCols + x] === 'land';
      };
      return (isLand(col, row - 1) ? 1 : 0)
        | (isLand(col + 1, row) ? 2 : 0)
        | (isLand(col, row + 1) ? 4 : 0)
        | (isLand(col - 1, row) ? 8 : 0);
    };

    if (!this.textures.exists(tilesetKey)) {
      const canvas = this.textures.createCanvas(tilesetKey, TILE_SIZE * TILE_COUNT, TILE_SIZE);
      const ctx = canvas?.getContext();
      if (canvas && ctx) {
        const seeded = (seed: number): (() => number) => {
          let state = seed >>> 0;
          return () => {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
            return state / 0x100000000;
          };
        };

        const drawLand = (index: number, variation: number): void => {
          const x = index * TILE_SIZE;
          const gradient = ctx.createLinearGradient(x, 0, x + TILE_SIZE, TILE_SIZE);
          gradient.addColorStop(0, variation % 2 === 0 ? '#34452a' : '#304126');
          gradient.addColorStop(1, variation < 2 ? '#25371f' : '#293b22');
          ctx.fillStyle = gradient;
          ctx.fillRect(x, 0, TILE_SIZE, TILE_SIZE);

          const random = seeded(variation * 811 + 97);
          for (let detail = 0; detail < 34; detail += 1) {
            const px = x + random() * TILE_SIZE;
            const py = random() * TILE_SIZE;
            const size = 0.7 + random() * 1.7;
            ctx.fillStyle = random() > 0.28 ? 'rgba(126, 151, 80, 0.18)' : 'rgba(18, 26, 15, 0.28)';
            ctx.fillRect(px, py, size, size);
          }
          ctx.strokeStyle = 'rgba(126, 161, 87, 0.20)';
          ctx.lineWidth = 1;
          for (let blade = 0; blade < 7; blade += 1) {
            const px = x + 5 + random() * (TILE_SIZE - 10);
            const py = 5 + random() * (TILE_SIZE - 10);
            ctx.beginPath();
            ctx.moveTo(px, py + 2);
            ctx.lineTo(px + (random() - 0.5) * 2, py - 2);
            ctx.stroke();
          }
          ctx.strokeStyle = 'rgba(8, 12, 7, 0.12)';
          ctx.strokeRect(x + 0.5, 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
        };

        const drawWater = (index: number, variation: number): void => {
          const x = index * TILE_SIZE;
          const gradient = ctx.createLinearGradient(x, 0, x, TILE_SIZE);
          gradient.addColorStop(0, variation % 2 === 0 ? '#173c54' : '#16384f');
          gradient.addColorStop(1, variation < 2 ? '#0d263b' : '#102c42');
          ctx.fillStyle = gradient;
          ctx.fillRect(x, 0, TILE_SIZE, TILE_SIZE);
          const offset = variation * 5;
          ctx.lineWidth = 1.5;
          for (let wave = 0; wave < 4; wave += 1) {
            const y = 9 + wave * 15 + ((offset + wave * 3) % 6);
            const start = x + 5 + ((offset + wave * 11) % 10);
            ctx.strokeStyle = wave % 2 === 0 ? 'rgba(113, 203, 226, 0.22)' : 'rgba(71, 147, 183, 0.18)';
            ctx.beginPath();
            ctx.moveTo(start, y);
            ctx.bezierCurveTo(start + 7, y - 2, start + 12, y + 2, start + 20, y);
            ctx.bezierCurveTo(start + 27, y - 2, start + 33, y + 2, start + 41, y);
            ctx.stroke();
          }
          ctx.strokeStyle = 'rgba(5, 16, 25, 0.16)';
          ctx.strokeRect(x + 0.5, 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
        };

        for (let variant = 0; variant < LAND_VARIANTS; variant += 1) drawLand(variant, variant);
        for (let variant = 0; variant < WATER_VARIANTS; variant += 1) drawWater(LAND_VARIANTS + variant, variant);

        // Each shoreline tile is a water tile plus the land-facing edges in
        // its NESW bit mask. This covers all straight edges, bends, channels,
        // peninsulas and single-water-cell cases without sprite-sheet seams.
        for (let mask = 0; mask < 16; mask += 1) {
          const index = SHORE_START + mask;
          const x = index * TILE_SIZE;
          drawWater(index, mask % WATER_VARIANTS);
          ctx.fillStyle = '#35472a';
          if (mask & 1) ctx.fillRect(x, 0, TILE_SIZE, 12);
          if (mask & 2) ctx.fillRect(x + TILE_SIZE - 12, 0, 12, TILE_SIZE);
          if (mask & 4) ctx.fillRect(x, TILE_SIZE - 12, TILE_SIZE, 12);
          if (mask & 8) ctx.fillRect(x, 0, 12, TILE_SIZE);
          ctx.fillStyle = 'rgba(175, 159, 101, 0.78)';
          if (mask & 1) ctx.fillRect(x, 12, TILE_SIZE, 5);
          if (mask & 2) ctx.fillRect(x + TILE_SIZE - 17, 0, 5, TILE_SIZE);
          if (mask & 4) ctx.fillRect(x, TILE_SIZE - 17, TILE_SIZE, 5);
          if (mask & 8) ctx.fillRect(x + 12, 0, 5, TILE_SIZE);
          ctx.strokeStyle = 'rgba(181, 229, 228, 0.34)';
          ctx.lineWidth = 1;
          if (mask & 1) { ctx.beginPath(); ctx.moveTo(x, 18); ctx.lineTo(x + TILE_SIZE, 18); ctx.stroke(); }
          if (mask & 2) { ctx.beginPath(); ctx.moveTo(x + TILE_SIZE - 18, 0); ctx.lineTo(x + TILE_SIZE - 18, TILE_SIZE); ctx.stroke(); }
          if (mask & 4) { ctx.beginPath(); ctx.moveTo(x, TILE_SIZE - 18); ctx.lineTo(x + TILE_SIZE, TILE_SIZE - 18); ctx.stroke(); }
          if (mask & 8) { ctx.beginPath(); ctx.moveTo(x + 18, 0); ctx.lineTo(x + 18, TILE_SIZE); ctx.stroke(); }
        }
        canvas.refresh();
      }
    }

    const tilemap = this.make.tilemap({ width: map.terrainCols, height: map.terrainRows, tileWidth: TILE_SIZE, tileHeight: TILE_SIZE });
    const tileset = tilemap.addTilesetImage(tilesetKey, tilesetKey, TILE_SIZE, TILE_SIZE, 0, 0);
    if (!tileset) return;
    const layer = tilemap.createBlankLayer('terrain', tileset, 0, 0);
    if (!layer) return;
    layer.setDepth(-20);
    for (let row = 0; row < map.terrainRows; row += 1) {
      for (let col = 0; col < map.terrainCols; col += 1) {
        const terrain = map.terrain[row * map.terrainCols + col];
        const tileIndex = terrain === 'land'
          ? variantAt(col, row, 0x71a5, LAND_VARIANTS)
          : (() => {
              const mask = neighborMask(col, row);
              return mask === 0
                ? LAND_VARIANTS + variantAt(col, row, 0xb10e, WATER_VARIANTS)
                : SHORE_START + mask;
            })();
        layer.putTileAt(tileIndex, col, row);
      }
    }
  }

  private drawMapDecorations(): void {
    const { width, height, resourceNodes } = this.controller.sim.state.map;

    const border = this.add.graphics();
    border.lineStyle(2, 0x27303c, 1);
    border.strokeRect(1, 1, width - 2, height - 2);
    border.lineStyle(1, 0x27303c, 0.6);
    border.lineBetween(width / 2, 0, width / 2, height);

    for (const node of resourceNodes) {
      const g = this.add.container(node.position.x, node.position.y);
      const glow = this.add.ellipse(0, 10, 76, 48, 0x22d3ee, 0.14).setStrokeStyle(1, 0x67e8f9, 0.32);
      const sprite = this.add.image(0, 0, 'resource-crystal-deposit').setDisplaySize(82, 82);
      const label = this.add
        .text(0, 43, `${node.remaining} crystals`, {
          fontSize: '10px',
          color: '#a5f3fc',
          stroke: '#020617',
          strokeThickness: 3,
        })
        .setOrigin(0.5, 0);
      g.add([glow, sprite, label]);
      g.setName(`node:${node.id}`);
      this.events.on(Phaser.Scenes.Events.UPDATE, () => {
        const current = this.controller.sim.state.map.resourceNodes.find((n) => n.id === node.id);
        if (current) {
          const ratio = Phaser.Math.Clamp(current.remaining / Math.max(1, current.maxAmount), 0, 1);
          const depletionScale = 0.62 + Math.sqrt(ratio) * 0.38;
          const shimmer = ratio > 0
            ? Math.sin(this.time.now * 0.0011 + node.position.x * 0.013 + node.position.y * 0.007) * 0.025
            : 0;
          // Deposits stay firmly planted. Depletion changes their physical size;
          // the only ambient motion is a restrained, slow light shimmer.
          sprite.setDisplaySize(82 * depletionScale, 82 * depletionScale);
          sprite.setAlpha(Phaser.Math.Clamp(0.42 + ratio * 0.58 + shimmer, 0, 1));
          glow
            .setScale(0.8 + ratio * 0.2)
            .setAlpha(Phaser.Math.Clamp(0.1 + ratio * 0.28 + shimmer, 0, 0.4));
          label.setText(current.remaining > 0 ? `${current.remaining} crystals` : 'DEPLETED');
          label.setColor(current.remaining > 0 ? '#a5f3fc' : '#64748b');
          if (current.remaining <= 0 && !this.depletedNodeIds.has(current.id)) {
            this.depletedNodeIds.add(current.id);
            if (this.isPositionVisibleToViewer(current.position.x, current.position.y)) {
              this.playWorldSound('resourceDepleted', current.position.x, current.position.y, 0.8);
            }
          }
        }
      });
    }
  }

  private syncEntities(
    list: (UnitState | BuildingState)[],
    visuals: Map<string, EntityVisual>,
    isBuilding: boolean,
  ): void {
    const seen = new Set<string>();

    for (const entity of list) {
      seen.add(entity.id);
      let visual = visuals.get(entity.id);
      if (!visual) {
        visual = this.createVisual();
        visuals.set(entity.id, visual);
        if (this.initialEntitySyncComplete && entity.owner === this.viewSide) {
          const readyCue: GameSoundCue = entity.kind === 'unit'
            ? entity.race === 'ironclad'
              ? 'ironcladReady'
              : entity.race === 'aether'
                ? 'aetherReady'
                : 'nullforgeReady'
            : 'constructionStart';
          this.playWorldSound(readyCue, entity.position.x, entity.position.y);
        }
      }
      this.drawEntity(visual, entity, isBuilding);
    }

    for (const [id, visual] of visuals) {
      if (!seen.has(id)) {
        this.spawnExplosion(visual.container.x, visual.container.y, isBuilding ? 110 : 58, visual.deathSoundCue);
        if (visual.deathTextureKey && this.textures.exists(visual.deathTextureKey)) {
          visual.sprite.setTexture(visual.deathTextureKey).setAlpha(1);
          visual.blendSprite.setVisible(false);
          visual.shadow.setVisible(false);
          visual.label.setVisible(false);
          visual.hpBarBg.setVisible(false);
          visual.hpBarFill.setVisible(false);
          visual.progressBarBg.setVisible(false);
          visual.progressBarFill.setVisible(false);
          visual.progressLabel.setVisible(false);
          visual.constructionHalo.setVisible(false);
          visual.constructionScan.setVisible(false);
          this.tweens.add({
            targets: visual.container,
            alpha: 0,
            duration: isBuilding ? 1000 : 650,
            delay: isBuilding ? 300 : 120,
            onComplete: () => visual.container.destroy(),
          });
        } else {
          visual.container.destroy();
        }
        visuals.delete(id);
        if (!isBuilding) {
          this.unitMotion.delete(id);
          this.unitAudioState.delete(id);
        } else {
          this.buildingAudioState.delete(id);
        }
      }
    }
  }

  private spawnExplosion(x: number, y: number, size: number, soundCue?: GameSoundCue, effectColor = 0xff8a1f): void {
    if (this.isPositionVisibleToViewer(x, y)) {
      this.playWorldSound(
        soundCue ?? (size >= 90 ? 'explosionLarge' : 'explosionSmall'),
        x,
        y,
        Phaser.Math.Clamp(size / 90, 0.55, 1.15),
      );
    }
    const core = this.add.circle(x, y, size * 0.12, 0xfff4c2, 1).setDepth(35);
    this.tweens.add({ targets: core, scale: 3.4, alpha: 0, duration: 260, ease: 'Cubic.Out', onComplete: () => core.destroy() });
    for (let i = 0; i < 7; i += 1) {
      const angle = (i / 7) * Math.PI * 2 + Math.random() * 0.35;
      const spark = this.add.circle(x, y, Math.max(1.5, size * 0.025), i % 2 ? effectColor : 0x67e8f9, 0.95).setDepth(36);
      this.tweens.add({
        targets: spark,
        x: x + Math.cos(angle) * size * (0.3 + Math.random() * 0.35),
        y: y + Math.sin(angle) * size * (0.3 + Math.random() * 0.35),
        alpha: 0,
        scale: 0.25,
        duration: 280 + Math.random() * 180,
        ease: 'Quad.Out',
        onComplete: () => spark.destroy(),
      });
    }
  }

  private spawnMuzzleFlash(x: number, y: number, color: number, size: number): void {
    const flash = this.add.circle(x, y, size, color, 0.85).setDepth(34);
    this.tweens.add({ targets: flash, scale: 2.2, alpha: 0, duration: 100, ease: 'Quad.Out', onComplete: () => flash.destroy() });
  }

  private spawnProjectileTrail(x: number, y: number, color: number, kind: ProjectileState['kind']): void {
    const smoky = kind === 'rocket' || kind === 'missile' || kind === 'bomb' || kind === 'artillery' || kind === 'meteor';
    const watery = kind === 'torpedo';
    const radius = kind === 'meteor' || kind === 'artillery' ? 4.2 : kind === 'bomb' || kind === 'plasma' ? 3.4 : 2.4;
    const trail = this.add.circle(
      x,
      y,
      radius,
      smoky ? (kind === 'meteor' ? 0x86efac : 0x64748b) : watery ? 0xbae6fd : color,
      smoky ? 0.32 : 0.42,
    ).setDepth(28);
    this.tweens.add({
      targets: trail,
      x: x + Phaser.Math.FloatBetween(-3, 3),
      y: y + Phaser.Math.FloatBetween(-3, 3),
      scale: smoky ? 2.1 : 0.25,
      alpha: 0,
      duration: smoky ? 360 : 190,
      ease: 'Quad.Out',
      onComplete: () => trail.destroy(),
    });
  }

  private createVisual(): EntityVisual {
    const container = this.add.container(0, 0);
    const shadow = this.add.ellipse(0, 6, 34, 16, 0x020617, 0.28);
    const sprite = this.add.sprite(0, 0, '__WHITE');
    const blendSprite = this.add.sprite(0, 0, '__WHITE');
    const label = this.add.text(0, 0, '', { fontSize: '10px', color: '#e5e7eb' }).setOrigin(0.5, 0);
    const hpBarBg = this.add.rectangle(0, 0, 26, 5, 0x030712, 0.92).setOrigin(0.5).setStrokeStyle(1, 0xcbd5e1, 0.38);
    const hpBarFill = this.add.rectangle(0, 0, 24, 3, 0x22c55e, 1).setOrigin(0, 0.5);
    const progressBarBg = this.add.rectangle(0, 0, 26, 6, 0x030712, 0.94).setOrigin(0.5).setStrokeStyle(1, 0xcbd5e1, 0.45);
    const progressBarFill = this.add.rectangle(0, 0, 24, 4, 0x60a5fa, 1).setOrigin(0, 0.5);
    const progressLabel = this.add.text(0, 0, '', {
      fontSize: '7px',
      color: '#f8fafc',
      stroke: '#020617',
      strokeThickness: 2,
    }).setOrigin(0.5, 1);
    const constructionHalo = this.add.ellipse(0, 0, 48, 48, 0x22d3ee, 0.1).setStrokeStyle(1, 0x67e8f9, 0.55).setVisible(false);
    const constructionScan = this.add.rectangle(0, 0, 48, 2, 0x67e8f9, 0.9).setVisible(false);
    container.add([shadow, constructionHalo, sprite, blendSprite, constructionScan, hpBarBg, hpBarFill, progressBarBg, progressBarFill, progressLabel, label]);
    return { container, shadow, sprite, blendSprite, label, hpBarBg, hpBarFill, progressBarBg, progressBarFill, progressLabel, constructionHalo, constructionScan, lastHp: Infinity, hitUntil: 0, phase: Math.random(), deathTextureKey: null, deathSoundCue: 'explosionSmall' };
  }

  private drawEntity(visual: EntityVisual, entity: UnitState | BuildingState, isBuilding: boolean): void {
    const { container, shadow, sprite, blendSprite, label, hpBarBg, hpBarFill, progressBarBg, progressBarFill, progressLabel, constructionHalo, constructionScan } = visual;

    // A unit riding aboard a transport is fully hidden — its position just
    // tracks the transport's (see Simulation.stepCargoPositions), it isn't
    // actually standing there. Own-unit visibility below would otherwise
    // show it as a duplicate sprite stacked on the transport.
    if (entity.kind === 'unit' && entity.loadedInto) {
      container.setVisible(false);
      return;
    }
    container.setPosition(entity.position.x, entity.position.y);

    // True fog of war: an enemy unit outside your current vision is fully
    // hidden — hiding live army movement is the whole point. A scouted enemy
    // building instead stays shown, dimmed, as a "last seen" structure (it
    // can't move, so a stale position is still useful — same as WC3/SC).
    const currentlyVisible = this.isVisibleToViewer(entity);
    if (
      currentlyVisible &&
      entity.owner !== this.viewSide &&
      !this.announcedEnemyEntityIds.has(entity.id)
    ) {
      this.announcedEnemyEntityIds.add(entity.id);
      if (this.initialEntitySyncComplete) {
        this.playWorldSound('enemySpotted', entity.position.x, entity.position.y, entity.kind === 'building' ? 0.9 : 0.72);
      }
    }
    let remembered = false;
    if (isBuilding && entity.owner !== this.viewSide) {
      if (currentlyVisible) this.seenEnemyBuildingIds.add(entity.id);
      remembered = !currentlyVisible && this.seenEnemyBuildingIds.has(entity.id);
    }
    const visible = currentlyVisible || remembered;
    container.setVisible(visible);
    if (!visible) return;
    container.setAlpha(remembered ? 0.45 : 1);
    visual.deathSoundCue = entity.kind === 'building'
      ? 'buildingCollapse'
      : entity.movementDomain === 'air'
        ? 'airCrash'
        : entity.movementDomain === 'sea'
          ? 'shipSinking'
          : 'explosionSmall';

    const ownerTint = ownerTintFromColor(this.controller.sim.state.players[entity.owner].color);

    const displaySize = entityDisplaySize(entity);
    const renderSize = entity.kind === 'building' ? entityRenderSize(entity) : displaySize;
    let hpBarY = -14;

    if (visual.lastHp !== Infinity && entity.hp < visual.lastHp) {
      visual.hitUntil = this.time.now + 120;
      if (currentlyVisible) this.playWorldSound('impact', entity.position.x, entity.position.y, entity.kind === 'building' ? 0.8 : 0.55);
    }
    visual.lastHp = entity.hp;
    sprite.clearTint().setTint(ownerTint).setVisible(true).setAlpha(1).setPosition(0, 0).setRotation(0);
    blendSprite.clearTint().setTint(ownerTint).setVisible(true).setAlpha(0).setPosition(0, 0).setRotation(0);

    if (isBuilding) {
      shadow.setVisible(false);
      const b = entity as BuildingState;
      this.updateBuildingAudio(b);
      const race = b.race;
      const animation = RACES[race].buildingAnimations;
      const animationState: BuildingAnimationState = b.underConstruction
        ? 'production'
        : b.hp / b.maxHp < 0.35
          ? 'damaged'
        : b.researchQueue.length > 0
          ? 'research'
          : b.productionQueue.length > 0
            ? 'production'
            : 'idle';
      const blend = this.frameBlend(animation[animationState] as string[], animation.fps, visual.phase);
      sprite.setTexture(frameTextureKey(race, 'building', b.raceBuildingId, blend.current));
      blendSprite.setTexture(frameTextureKey(race, 'building', b.raceBuildingId, blend.next));
      visual.deathTextureKey = frameTextureKey(race, 'building', b.raceBuildingId, 'destroyed');
      sprite.setDisplaySize(renderSize, renderSize);
      blendSprite.setDisplaySize(renderSize, renderSize);
      sprite.setAlpha(1 - blend.mix);
      blendSprite.setAlpha(blend.mix);
      if (b.underConstruction) {
        const reveal = Phaser.Math.Clamp(b.constructionProgress, 0.02, 1);
        cropFromBottom(sprite, reveal);
        cropFromBottom(blendSprite, reveal);
        constructionHalo.setVisible(true)
          .setDisplaySize(renderSize * 0.88, renderSize * 0.78)
          .setAlpha(0.08 + Math.sin(this.controller.sim.state.time * 5 + visual.phase) * 0.025);
        constructionScan.setVisible(true)
          .setDisplaySize(renderSize * 0.78, 2)
          .setPosition(0, renderSize * (0.38 - reveal * 0.76))
          .setAlpha(0.55 + Math.sin(this.controller.sim.state.time * 9) * 0.25);
      } else {
        sprite.setCrop();
        blendSprite.setCrop();
        constructionHalo.setVisible(false);
        constructionScan.setVisible(false);
      }
      hpBarY = -renderSize * 0.38 - 8;
      label.setText(buildingName(b.race, b.type));
      label.setPosition(0, renderSize * 0.38);

      // A construction site sits with no progress at all until its assigned
      // builder actually arrives (see Simulation.constructBuilding) — the
      // foundation is visible, but there's nothing to report yet, so the
      // progress bar (and, below, the HP bar) stay hidden until it ticks up.
      const showProgress = (b.underConstruction && b.constructionProgress > 0) || b.productionQueue.length > 0 || b.researchQueue.length > 0;
      progressBarBg.setVisible(showProgress);
      progressBarFill.setVisible(showProgress);
      progressLabel.setVisible(showProgress);
      if (showProgress) {
        const progress = b.underConstruction ? b.constructionProgress : b.researchQueue[0]?.progress ?? b.productionQueue[0]?.progress ?? 0;
        const progressColor = b.underConstruction ? 0x60a5fa : b.researchQueue.length > 0 ? 0x22d3ee : 0xa855f7;
        const progressWidth = Phaser.Math.Clamp(renderSize * 0.72, 48, 88);
        const progressY = hpBarY - 10;
        progressBarFill.setFillStyle(progressColor, 1);
        positionBar(progressBarBg, progressBarFill, 0, progressY, progressWidth, 6, progress);

        const percent = Math.round(Phaser.Math.Clamp(progress, 0, 1) * 100);
        const productionOrder = b.productionQueue[0];
        const action = b.underConstruction
          ? 'BUILD'
          : b.researchQueue.length > 0
            ? 'RESEARCH'
            : productionOrder
              ? RACES[b.race].units[productionOrder.raceUnitId]?.shortName.toUpperCase() ?? 'PRODUCE'
              : 'PRODUCE';
        progressLabel.setText(`${action} ${percent}%`).setPosition(0, progressY - 4);
      }
    } else {
      constructionHalo.setVisible(false);
      constructionScan.setVisible(false);
      const u = entity as UnitState;
      const race = u.race;
      const motion = this.unitVisualState(u);
      const definition = RACES[race].units[u.raceUnitId];
      const animation = RACES[race].animations[definition.animation];
      visual.deathTextureKey = frameTextureKey(race, 'unit', u.raceUnitId, 'destroyed');
      const poseConfig = UNIT_MOTION_CONFIG[u.type] ?? UNIT_MOTION_CONFIG.soldier;
      const poseState = motion.state === 'move' ? 'walk' : motion.state;
      const pose = resolveUnitPose(poseConfig, poseState, this.controller.sim.state.time, visual.phase, motion.fireProgress);
      const frames = animation[motion.state] as string[];
      const blend = this.frameBlend(frames, animation.fps, visual.phase, motion.state === 'fire' ? motion.fireProgress : undefined);
      sprite.setTexture(frameTextureKey(race, 'unit', u.raceUnitId, blend.current));
      blendSprite.setTexture(frameTextureKey(race, 'unit', u.raceUnitId, blend.next));
      sprite.setDisplaySize(displaySize * pose.scaleX, displaySize * pose.scaleY);
      blendSprite.setDisplaySize(displaySize * pose.scaleX, displaySize * pose.scaleY);
      sprite.setAlpha(1 - blend.mix).setPosition(pose.x, pose.y).setRotation(motion.direction + pose.rotationOffset);
      blendSprite.setVisible(true).setAlpha(blend.mix).setPosition(pose.x, pose.y).setRotation(motion.direction + pose.rotationOffset);
      const shadowWidth = displaySize * (u.movementDomain === 'air' ? 0.64 : 0.74);
      shadow.setVisible(true)
        .setDisplaySize(shadowWidth, displaySize * (u.movementDomain === 'air' ? 0.22 : 0.3))
        .setAlpha(u.movementDomain === 'air' ? 0.18 : 0.28)
        .setPosition(0, u.movementDomain === 'air' ? 5 : 4);
      hpBarY = -displaySize * 0.48 - 8;
      const capacity = this.controller.sim.getTransportCapacity(u.id);
      const cargoLabel = capacity > 0 ? ` (${this.controller.sim.getCargoLoad(u.id)}/${capacity})` : '';
      label.setText(unitShortName(u.race, u.type) + cargoLabel);
      label.setPosition(0, displaySize * 0.48);
      progressBarBg.setVisible(false);
      progressBarFill.setVisible(false);
      progressLabel.setVisible(false);
    }

    if (this.time.now < visual.hitUntil) {
      sprite.setTintFill(0xff7a7a);
      blendSprite.setTintFill(0xff7a7a);
    }

    const hpRatio = Phaser.Math.Clamp(entity.hp / entity.maxHp, 0, 1);
    const hpWidth = Phaser.Math.Clamp(renderSize * (isBuilding ? 0.72 : 0.72), isBuilding ? 48 : 32, isBuilding ? 88 : 58);
    const pendingConstruction = entity.kind === 'building' && entity.underConstruction && entity.constructionProgress <= 0;
    hpBarFill.setFillStyle(hpRatio > 0.5 ? 0x22c55e : hpRatio > 0.25 ? 0xf59e0b : 0xef4444, 1);
    hpBarBg.setVisible(!remembered && !pendingConstruction);
    hpBarFill.setVisible(!remembered && !pendingConstruction && hpRatio > 0);
    if (remembered) {
      progressBarBg.setVisible(false);
      progressBarFill.setVisible(false);
      progressLabel.setVisible(false);
    } else {
      positionBar(hpBarBg, hpBarFill, 0, hpBarY, hpWidth, isBuilding ? 6 : 5, hpRatio);
    }
  }

  private frameBlend(
    frames: string[],
    fps: number,
    phase: number,
    progress?: number,
  ): { current: string; next: string; mix: number } {
    if (frames.length === 0) return { current: 'idle-a', next: 'idle-a', mix: 0 };
    if (frames.length === 1) return { current: frames[0], next: frames[0], mix: 0 };
    const position = progress === undefined
      ? (this.controller.sim.state.time + phase) * fps
      : Phaser.Math.Clamp(progress, 0, 1) * (frames.length - 1);
    const currentIndex = Math.min(frames.length - 1, Math.floor(position) % frames.length);
    const nextIndex = progress === undefined ? (currentIndex + 1) % frames.length : Math.min(frames.length - 1, currentIndex + 1);
    const linearMix = position - Math.floor(position);
    const mix = linearMix * linearMix * (3 - 2 * linearMix);
    return { current: frames[currentIndex], next: frames[nextIndex], mix };
  }

  private unitVisualState(unit: UnitState): { state: UnitAnimationState; direction: number; fireProgress: number } {
    const previous = this.unitMotion.get(unit.id) ?? { x: unit.position.x, y: unit.position.y, direction: 0 };
    const dx = unit.position.x - previous.x;
    const dy = unit.position.y - previous.y;
    const moving = dx * dx + dy * dy > 0.04;
    let direction = previous.direction;
    if (moving) direction = resolveUnitFacingAngle(dx, dy);
    const fireWindow = Math.min(0.24, unit.attackCooldown * 0.32);
    const timeSinceShot = Math.max(0, unit.attackCooldown - unit.attackTimer);
    const justFired = unit.attackCooldown > 0 && timeSinceShot < fireWindow;
    const builderWorking = unit.type === 'builder' && !moving && (unit.gatherState === 'gathering' || unit.order.type === 'build');
    const supportWorking = unit.type === 'support' && this.controller.sim.state.units.some(
      (ally) =>
        ally.owner === unit.owner &&
        ally.id !== unit.id &&
        ally.hp > 0 &&
        ally.hp < ally.maxHp &&
        Phaser.Math.Distance.Between(ally.position.x, ally.position.y, unit.position.x, unit.position.y) <= 150,
    );
    this.updateUnitAudio(unit, supportWorking);
    if (justFired) {
      const shot = this.controller.sim.state.projectiles.find((p) => p.sourceId === unit.id);
      const target = shot
        ? this.controller.sim.state.units.find((u) => u.id === shot.targetId) ?? this.controller.sim.state.buildings.find((b) => b.id === shot.targetId)
        : undefined;
      if (target) {
        const targetFacing = resolveUnitFacingAngle(target.position.x - unit.position.x, target.position.y - unit.position.y);
        // A unit that just fired and is now backing away from that target
        // (kiting, or fleeing at low health — both order it via moveTo, not
        // just 'retreat') should face the way it's actually moving, not
        // freeze facing the target it's fleeing — otherwise it visually
        // walks backward: the walk cycle plays as if striding forward while
        // the sprite as a whole slides the opposite way on screen. Facing
        // the target is only kept while stationary, approaching, or
        // strafing (angle to movement within 90°) — a unit that's actually
        // retreating (angle > 90°, moving away) keeps its movement-based facing.
        const facingAwayFromTarget = moving && Math.abs(Phaser.Math.Angle.Wrap(direction - targetFacing)) > Math.PI / 2;
        if (!facingAwayFromTarget) direction = targetFacing;
      }
    }
    this.unitMotion.set(unit.id, { x: unit.position.x, y: unit.position.y, direction });

    const working = builderWorking || supportWorking;
    const state: UnitAnimationState = justFired || working ? 'fire' : moving ? 'move' : 'idle';
    const fireProgress = justFired ? timeSinceShot / fireWindow : working ? (this.controller.sim.state.time * 2.5) % 1 : 0;
    return { state, direction, fireProgress };
  }

  private updateUnitAudio(unit: UnitState, supportWorking: boolean): void {
    const next: UnitAudioState = {
      gatherState: unit.gatherState,
      carriedResources: unit.carriedResources,
      supportWorking,
      healthRatio: unit.hp / Math.max(1, unit.maxHp),
      orderType: unit.order.type,
      cargoCount: unit.cargo.length,
      skillCooldowns: Object.fromEntries(unit.skills.map((skill) => [skill.id, skill.cooldownRemaining])),
    };
    const previous = this.unitAudioState.get(unit.id);
    this.unitAudioState.set(unit.id, next);
    if (!previous || unit.owner !== this.viewSide) return;
    if (!this.isPositionOnScreen(unit.position.x, unit.position.y)) return;

    const options = { pan: this.audioPan(unit.position.x), gain: 0.72 };
    if (next.gatherState === 'gathering' && previous.gatherState !== 'gathering') {
      gameAudio.play('resourceGather', options);
    }
    if (previous.carriedResources > 0 && next.carriedResources === 0) {
      gameAudio.play('resourceDeposit', options);
    }
    if (next.supportWorking && !previous.supportWorking) {
      gameAudio.play(unit.race === 'nullforge' ? 'repair' : 'heal', options);
    }
    if (previous.healthRatio > 0.25 && next.healthRatio <= 0.25) {
      gameAudio.play('unitCritical', { ...options, gain: 0.78 });
    }
    if (next.cargoCount > previous.cargoCount) gameAudio.play('cargoLoad', options);
    if (next.cargoCount < previous.cargoCount) gameAudio.play('cargoUnload', options);

    if (next.orderType !== previous.orderType) {
      const orderCue: Partial<Record<UnitState['order']['type'], GameSoundCue>> = {
        moveTo: 'orderMove',
        attackMove: 'orderAttack',
        attackTarget: 'orderAttack',
        defend: 'orderDefend',
        retreat: 'orderRetreat',
        scout: 'orderScout',
      };
      const cue = orderCue[next.orderType];
      if (cue) gameAudio.play(cue, { ...options, gain: 0.58 });
    }

    for (const skill of unit.skills) {
      const previousCooldown = previous.skillCooldowns[skill.id] ?? 0;
      if (skill.cooldownRemaining <= previousCooldown + 0.2) continue;
      const definition = RACES[unit.race].units[unit.raceUnitId]?.skills?.find((candidate) => candidate.id === skill.id);
      if (!definition) continue;
      const healCue = unit.race === 'nullforge' ? 'repair' : 'heal';
      // The 6 race-exclusive effects reuse whichever existing cue is closest
      // in feel rather than needing their own synthesized sound (see
      // GameAudio.ts's per-cue case statement) — a real new sound is a
      // follow-up, not required for the ability itself to work.
      const abilityCue: Record<typeof definition.effect, GameSoundCue> = {
        repairPulse: healCue,
        speedBoost: 'abilitySpeed',
        weaponBoost: 'abilityWeapon',
        fortify: 'abilityFortify',
        slowPulse: 'abilitySlow',
        shieldBarrier: 'abilityFortify',
        stunSlam: 'abilitySlow',
        phaseCloak: 'abilitySpeed',
        lifeDrain: healCue,
        overclockSurge: 'abilityWeapon',
        chainOverload: 'abilityWeapon',
      };
      gameAudio.play(abilityCue[definition.effect], { ...options, gain: 0.82 });
    }
  }

  private updatePlacementGhost(): void {
    if (!this.placementGhost) return;
    const store = useAppStore.getState();
    const pointer = this.input.activePointer;
    if (!store.pendingCoordinateInsert || !pointer) {
      this.placementGhost.setVisible(false);
      return;
    }
    const world = { x: pointer.worldX, y: pointer.worldY };
    this.placementGhost.setVisible(true);
    this.placementGhost.setPosition(world.x, world.y);
    this.placementGhost.setFillStyle(0xfacc15, 0.35);
  }

  private updateBuildingAudio(building: BuildingState): void {
    const next: BuildingAudioState = {
      underConstruction: building.underConstruction,
      productionHead: building.productionQueue[0]?.id ?? null,
      researchHead: building.researchQueue[0]?.id ?? null,
      lastDamagedAt: building.lastDamagedAt,
      healthRatio: building.hp / Math.max(1, building.maxHp),
    };
    const previous = this.buildingAudioState.get(building.id);
    this.buildingAudioState.set(building.id, next);
    if (!previous || building.owner !== this.viewSide) return;
    if (!this.isPositionOnScreen(building.position.x, building.position.y)) return;

    const options = { pan: this.audioPan(building.position.x) };
    if (previous.underConstruction && !next.underConstruction) gameAudio.play('constructionComplete', options);
    if (next.productionHead && next.productionHead !== previous.productionHead) gameAudio.play('productionStart', options);
    if (next.researchHead && next.researchHead !== previous.researchHead) gameAudio.play('researchStart', options);
    if (previous.researchHead && !next.researchHead) gameAudio.play('researchComplete', options);
    if (previous.healthRatio >= 0.35 && next.healthRatio < 0.35) {
      gameAudio.play('structureCritical', { ...options, gain: building.type === 'commandCenter' ? 1.15 : 0.85 });
    }
    if (
      building.type === 'commandCenter' &&
      next.lastDamagedAt !== null &&
      next.lastDamagedAt !== previous.lastDamagedAt
    ) {
      gameAudio.play('alert', options);
    }
  }

  private audioPan(worldX: number): number {
    const view = this.cameras.main.worldView;
    return Phaser.Math.Clamp((worldX - view.centerX) / Math.max(1, view.width * 0.5), -1, 1);
  }

  /** World audio is intentionally camera-local. Fog visibility alone is not
   * enough: battles, workers, and production outside the current viewport
   * must not leak through as omniscient map-wide sound. */
  private isPositionOnScreen(x: number, y: number): boolean {
    return this.cameras.main.worldView.contains(x, y);
  }

  private playWorldSound(cue: GameSoundCue, x: number, y: number, gain = 1): void {
    if (!this.isPositionOnScreen(x, y)) return;
    const view = this.cameras.main.worldView;
    const normalizedX = (x - view.centerX) / Math.max(1, view.width * 0.5);
    const normalizedY = (y - view.centerY) / Math.max(1, view.height * 0.5);
    const edgeDistance = Phaser.Math.Clamp(Math.sqrt(normalizedX ** 2 + normalizedY ** 2), 0, 1);
    gameAudio.play(cue, { pan: this.audioPan(x), gain: gain * (1 - edgeDistance * 0.32) });
  }

  private pushHud(): void {
    const sim = this.controller.sim;
    const playerValues = <T,>(read: (owner: PlayerId) => T) => Object.fromEntries(
      PLAYER_ID_LIST.map((owner) => [owner, read(owner)]),
    ) as Record<PlayerId, T>;
    const hud: HudSnapshot = {
      matchPhase: this.controller.phase,
      resources: playerValues((owner) => sim.getResources(owner)),
      unitCounts: playerValues((owner) => sim.getUnits(owner).length),
      armyStrength: playerValues((owner) => sim.getArmyStrength(owner)),
      matchResult: sim.state.matchResult,
      stats: playerValues((owner) => sim.getStats(owner)),
      activePlayers: [...sim.state.activePlayers],
      activityLog: this.controller.activityLog,
      matchDuration: sim.getGameTime(),
      completedResearch: playerValues((owner) => sim.state.players[owner].completedResearch),
      players: playerValues((owner) => ({
        name: sim.state.players[owner].name,
        color: sim.state.players[owner].color,
        team: sim.state.players[owner].team,
      })),
    };
    const store = useAppStore.getState();
    store.setHud(hud);

    if (sim.state.matchResult && this.announcedMatchResult === null) {
      const { winners } = sim.state.matchResult;
      this.announcedMatchResult = winners[0] ?? 'draw';
      gameAudio.play(winners.length === 0 ? 'draw' : winners.includes(this.viewSide) ? 'victory' : 'defeat');
    }

    if (store.selectedEntityIds.length > 0) {
      const stillSelected: string[] = [];
      const snapshots = [];
      for (const id of store.selectedEntityIds) {
        const entity = sim.state.units.find((u) => u.id === id) ?? sim.state.buildings.find((b) => b.id === id);
        if (entity && this.isVisibleToViewer(entity)) {
          stillSelected.push(id);
          snapshots.push({ ...entity });
        }
      }
      if (stillSelected.length !== store.selectedEntityIds.length) store.setSelectedEntities(stillSelected);
      store.setSelectedEntitySnapshots(snapshots);
    }
  }
}

function positionBar(
  bg: Phaser.GameObjects.Rectangle,
  fill: Phaser.GameObjects.Rectangle,
  x: number,
  y: number,
  width: number,
  height: number,
  ratio: number,
): void {
  const clamped = Phaser.Math.Clamp(ratio, 0, 1);
  const innerWidth = Math.max(1, width - 2);
  const fillWidth = innerWidth * clamped;
  bg.setPosition(x, y).setDisplaySize(width, height);
  fill
    .setPosition(x - innerWidth / 2, y)
    .setDisplaySize(Math.max(0.01, fillWidth), Math.max(1, height - 2))
    .setVisible(clamped > 0);
}

/** Reveal a full-size building from its foundation upward. Unlike scaling,
 * this keeps the structure's footprint and proportions stable throughout
 * construction while the animated build frames play behind the scan line. */
function cropFromBottom(sprite: Phaser.GameObjects.Sprite, ratio: number): void {
  const width = sprite.frame.realWidth;
  const height = sprite.frame.realHeight;
  const visibleHeight = Math.max(1, Math.round(height * Phaser.Math.Clamp(ratio, 0, 1)));
  sprite.setCrop(0, height - visibleHeight, width, visibleHeight);
}

function entityDisplaySize(entity: UnitState | BuildingState): number {
  return entity.kind === 'unit'
    ? RACES[entity.race].units[entity.raceUnitId].size
    : RACES[entity.race].buildings[entity.raceBuildingId].size;
}

function entityRenderSize(entity: UnitState | BuildingState): number {
  const size = entityDisplaySize(entity);
  return entity.kind === 'building' ? size * BUILDING_RENDER_SCALE : size;
}

function entityMarkerRadius(entity: UnitState | BuildingState): number {
  const size = entityDisplaySize(entity);
  return entity.kind === 'building' ? size * 0.46 : size * 0.35;
}
