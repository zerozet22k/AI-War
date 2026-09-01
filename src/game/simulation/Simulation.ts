import type {
  ArmorType,
  BuildingState,
  BuildingType,
  DamageType,
  Entity,
  MatchStats,
  PlayerId,
  ProjectileKind,
  ProjectileState,
  RaceId,
  ResearchType,
  SimState,
  UnitOrder,
  UnitState,
  UnitType,
  Vector2,
} from '../../types/game';
import { PLAYER_ID_LIST } from '../../types/game';
import {
  BALLISTIC_PROJECTILES,
  BUILDING_COSTS,
  BUILD_ARRIVAL_RADIUS,
  COMMAND_CENTER_UNDER_ATTACK_WINDOW,
  DAMAGE_MULTIPLIER,
  DEPOSIT_ARRIVAL_RADIUS,
  GATHER_ARRIVAL_RADIUS,
  GATHER_CARRY_AMOUNT,
  GATHER_CYCLE_TIME,
  PRODUCER_FOR_UNIT,
  PROJECTILE_SPEED,
  PROJECTILE_SPLASH_RADIUS,
  RESEARCH_COSTS,
  RESEARCH_DURATION,
  RESEARCH_PREREQUISITE,
  RESEARCH_PRODUCER,
  RESOURCE_GARRISON_RADIUS,
  STARTING_RESOURCES,
  UNIT_BUILD_TIME,
  UNIT_COSTS,
  UNIT_STATS,
  UNIT_RESEARCH_REQUIREMENT,
  UNIT_VOLUME_SIZE,
  TRANSPORT_CAPACITY,
  VOLUME_COST,
  VOLUME_SIZE_ORDINAL,
  BUILDING_BUILD_TIME,
  BUILDING_SIGHT,
  TILE_SIZE,
  SHORE_ADJACENCY_RADIUS,
  EXPLORATION_CELL_SIZE,
} from '../constants';
import { findTerrainPath, terrainTileKey } from './pathfinding';
import type { MapId } from '../maps';
import { buildingEntryForArchetype, DEFAULT_RACE_FOR_PLAYER, RACES, resolveRaceBuilding, resolveRaceUnit, unitEntryForArchetype } from '../races';
import { createBuilding, createUnit } from './entities';
import { generateMap, isWater, worldToTile } from './mapGen';
import { clamp, distance, moveToward, randomInRect } from '../../utils/math';
import { makeId } from '../../utils/id';

const MAX_PRODUCTION_QUEUE = 5;
const MIN_BUILD_SPACING = 70;

export function otherPlayer(owner: PlayerId): PlayerId {
  return owner === 'player' ? 'enemy' : 'player';
}

function emptyStats(): MatchStats {
  return { unitsCreated: 0, unitsLost: 0, buildingsConstructed: 0, resourcesGathered: 0 };
}

interface MovementPathCache {
  domain: UnitState['movementDomain'];
  targetTile: number;
  waypoints: Vector2[];
  waypointIndex: number;
  lastPosition: Vector2;
}

interface KnownEnemyBuilding {
  id: string;
  owner: PlayerId;
  buildingType: BuildingType;
  raceBuildingId: string;
  position: Vector2;
  lastSeenTime: number;
}

/**
 * Deterministic, framework-free RTS simulation. Owns all game state and is
 * driven by `step(dt)`. Phaser only reads from it for rendering; the AI rule
 * engine and the intervention system only call its command methods.
 */
export class Simulation {
  state: SimState;
  private detectionCache = Object.fromEntries(PLAYER_ID_LIST.map((owner) => [owner, false])) as Record<PlayerId, boolean>;
  private discoveredResourceNodes = Object.fromEntries(PLAYER_ID_LIST.map((owner) => [owner, new Set<string>()])) as Record<PlayerId, Set<string>>;
  private discoveredEnemyBases = Object.fromEntries(PLAYER_ID_LIST.map((owner) => [owner, new Set<PlayerId>()])) as Record<PlayerId, Set<PlayerId>>;
  /** Coarse per-player "have I ever seen this patch of map" memory, keyed by
   * `${col},${row}` in EXPLORATION_CELL_SIZE-sized cells — same "seen once,
   * remembered forever" rule as discoveredResourceNodes. Drives scouting
   * (see randomWaypointFor) toward cells nobody has looked at yet instead of
   * picking a uniformly random point every time, which on a mostly-water or
   * choke-pointed map tends to keep re-sampling the same nearby reachable
   * strip and never actually sweeps the map. */
  private exploredCells = Object.fromEntries(PLAYER_ID_LIST.map((owner) => [owner, new Set<string>()])) as Record<PlayerId, Set<string>>;
  /** Per-player "where did I last see enemy structures" memory — unlike
   * visibleEnemyBuildings()/buildingX() etc. (which only ever answer for
   * what's in CURRENT sight), this is remembered across a scout moving away,
   * getting killed, or losing vision for any other reason, same as real RTS
   * fog-of-war "ghost" markers. See updateEnemyIntel(). */
  private knownEnemyBuildings = Object.fromEntries(
    PLAYER_ID_LIST.map((owner) => [owner, new Map<string, KnownEnemyBuilding>()]),
  ) as Record<PlayerId, Map<string, KnownEnemyBuilding>>;
  private movementPaths = new Map<string, MovementPathCache>();
  private skillAutocastAccumulator = 0;

  /** `races` lets the menu/lobby's chosen races reach the match; anything
   * left unspecified (including every existing call site — tests, the
   * matchmaking-less local flow) falls back to DEFAULT_RACE_FOR_PLAYER, so
   * this stays backward compatible with `new Simulation()`. */
  constructor(
    races?: Partial<Record<PlayerId, RaceId>>,
    mapId?: MapId,
    activePlayers: PlayerId[] = ['player', 'enemy'],
    randomizeSpawns = false,
  ) {
    const map = generateMap(mapId, activePlayers, randomizeSpawns);
    const players = Object.fromEntries(PLAYER_ID_LIST.map((owner) => [owner, {
      id: owner,
      race: races?.[owner] ?? DEFAULT_RACE_FOR_PLAYER[owner],
      resources: STARTING_RESOURCES,
      completedResearch: [],
    }])) as unknown as SimState['players'];
    const stats = Object.fromEntries(PLAYER_ID_LIST.map((owner) => [owner, emptyStats()])) as SimState['stats'];
    this.state = {
      time: 0,
      map,
      players,
      units: [],
      buildings: [],
      projectiles: [],
      matchResult: null,
      stats,
      activePlayers: [...activePlayers],
    };

    for (const owner of activePlayers) {
      const base = map.bases[owner];
      const cc = createBuilding('commandCenter', owner, base, this.state.players[owner].race);
      this.state.buildings.push(cc);
      this.state.stats[owner].buildingsConstructed += 1;
      const builderSpot = this.startingWorkerPosition(base);
      this.spawnUnit('builder', owner, builderSpot);
    }
    this.updateResourceDiscovery();
    this.updateEnemyBaseDiscovery();
    this.updateExploration();
    this.updateEnemyIntel();
  }

  private startingWorkerPosition(base: Vector2): Vector2 {
    const offsets = [
      { x: 96, y: 0 }, { x: -96, y: 0 }, { x: 0, y: 96 }, { x: 0, y: -96 },
      { x: 96, y: 96 }, { x: -96, y: 96 }, { x: 96, y: -96 }, { x: -96, y: -96 },
    ];
    for (const offset of offsets) {
      const candidate = this.clampToMap({ x: base.x + offset.x, y: base.y + offset.y });
      if (!isWater(this.state.map, candidate)) return candidate;
    }
    return this.nearestTerrainPosition(base, false);
  }

  // ---------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------

  /** Keeps every unit fully inside the map rectangle — without this, a
   * script ordering a unit toward an out-of-range point (or chasing a
   * fleeing enemy near the edge) would walk it straight off the world. */
  private clampToMap(pos: Vector2): Vector2 {
    const margin = 16;
    return {
      x: clamp(pos.x, margin, this.state.map.width - margin),
      y: clamp(pos.y, margin, this.state.map.height - margin),
    };
  }

  step(dt: number): void {
    if (this.state.matchResult) return;
    this.state.time += dt;

    this.stepProduction(dt);
    this.stepResearch(dt);
    this.stepSkills(dt);
    this.stepBuilding(dt);
    this.stepAutoGatherAssignment();
    this.stepGathering(dt);
    this.stepSupportUnits(dt);
    this.stepMovementAndCombat(dt);
    this.stepCargoPositions();
    this.stepProjectiles(dt);
    this.stepScouting(dt);
    this.removeDead();
    this.updateDetection();
    this.updateResourceDiscovery();
    this.updateEnemyBaseDiscovery();
    this.updateExploration();
    this.updateEnemyIntel();
    this.checkWinCondition();
  }

  // ---------------------------------------------------------------------
  // Queries (used by AI conditions + UI)
  // ---------------------------------------------------------------------

  getResources(owner: PlayerId): number {
    return this.state.players[owner].resources;
  }

  getUnits(owner: PlayerId, type?: UnitType): UnitState[] {
    return this.state.units.filter((u) => u.owner === owner && (!type || u.type === type));
  }

  getBuildings(owner: PlayerId, type?: BuildingType): BuildingState[] {
    return this.state.buildings.filter((b) => b.owner === owner && (!type || b.type === type));
  }

  getCommandCenter(owner: PlayerId): BuildingState | undefined {
    return this.state.buildings.find((b) => b.owner === owner && b.type === 'commandCenter');
  }

  isEnemyDetected(owner: PlayerId): boolean {
    return this.detectionCache[owner];
  }

  isCommandCenterUnderAttack(owner: PlayerId): boolean {
    const cc = this.getCommandCenter(owner);
    if (!cc || cc.lastDamagedAt === null) return false;
    return this.state.time - cc.lastDamagedAt <= COMMAND_CENTER_UNDER_ATTACK_WINDOW;
  }

  getArmyStrength(owner: PlayerId): number {
    return this.getUnits(owner).reduce((sum, u) => sum + UNIT_STATS[u.type].power * (u.hp / u.maxHp), 0);
  }

  getGameTime(): number {
    return this.state.time;
  }

  getStats(owner: PlayerId): MatchStats {
    return this.state.stats[owner];
  }

  private skillDefinition(unit: UnitState, skillId: string) {
    return RACES[unit.race].units[unit.raceUnitId]?.skills?.find((skill) => skill.id === skillId);
  }

  private activeSkillDefinition(unit: UnitState, effect: 'speedBoost' | 'weaponBoost' | 'fortify') {
    const active = unit.skills.find((skill) => skill.activeRemaining > 0 && this.skillDefinition(unit, skill.id)?.effect === effect);
    return active ? this.skillDefinition(unit, active.id) : undefined;
  }

  private effectiveUnitSpeed(unit: UnitState): number {
    const skill = this.activeSkillDefinition(unit, 'speedBoost');
    const slowed = unit.slowUntil > this.state.time ? unit.slowMultiplier : 1;
    return unit.speed * (1 + (skill?.magnitude ?? 0)) * slowed;
  }

  private effectiveAttackRange(unit: UnitState): number {
    const skill = this.activeSkillDefinition(unit, 'weaponBoost');
    return unit.attackRange * (1 + (skill?.magnitude ?? 0) * 0.5);
  }

  private effectiveAttackDamage(unit: UnitState): number {
    const skill = this.activeSkillDefinition(unit, 'weaponBoost');
    return unit.attack * (1 + (skill?.magnitude ?? 0));
  }

  useUnitSkill(owner: PlayerId, unitId: string, skillId: string): boolean {
    const unit = this.ownedUnit(owner, unitId);
    const state = unit?.skills.find((skill) => skill.id === skillId);
    const definition = unit ? this.skillDefinition(unit, skillId) : undefined;
    if (!unit || !state || !definition || state.cooldownRemaining > 0 || unit.hp <= 0) return false;

    if (definition.effect === 'repairPulse') {
      const radius = definition.radius ?? 140;
      const supportBonus = this.state.players[owner].completedResearch.includes('supportSystems') ? 1.25 : 1;
      const allies: Entity[] = [...this.getUnits(owner), ...this.getBuildings(owner)];
      let repaired = false;
      for (const ally of allies) {
        if (ally.hp <= 0 || ally.hp >= ally.maxHp || distance(unit.position, ally.position) > radius) continue;
        ally.hp = Math.min(ally.maxHp, ally.hp + ally.maxHp * definition.magnitude * supportBonus);
        repaired = true;
      }
      if (!repaired) return false;
    } else if (definition.effect === 'slowPulse') {
      // An offensive AoE, unlike every other skill here — it hits nearby
      // enemy units instead of buffing this unit or its allies.
      const radius = definition.radius ?? 130;
      const enemyUnits = this.enemyEntities(owner).filter((e): e is UnitState => e.kind === 'unit' && e.hp > 0);
      let slowed = false;
      for (const enemy of enemyUnits) {
        if (distance(unit.position, enemy.position) > radius) continue;
        enemy.slowUntil = this.state.time + (definition.duration ?? 4);
        enemy.slowMultiplier = Math.max(0.15, 1 - definition.magnitude);
        slowed = true;
      }
      if (!slowed) return false;
    } else {
      state.activeRemaining = Math.max(0.1, definition.duration ?? 4);
    }

    const cooldownMultiplier = this.state.players[owner].completedResearch.includes('supportSystems') ? 0.8 : 1;
    state.cooldownRemaining = definition.cooldown * cooldownMultiplier;
    return true;
  }

  /** Creates a unit, adds it to the sim, and records it in that owner's stats. */
  private spawnUnit(type: UnitType, owner: PlayerId, position: Vector2, raceUnitId?: string): UnitState {
    const domain = UNIT_STATS[type].movementDomain;
    const spawnPosition = domain === 'sea' ? this.nearestTerrainPosition(position, true) : position;
    const unit = createUnit(type, owner, spawnPosition, this.state.players[owner].race, raceUnitId);
    for (const research of this.state.players[owner].completedResearch) this.applyResearchToUnit(unit, research);
    this.state.units.push(unit);
    this.state.stats[owner].unitsCreated += 1;
    return unit;
  }

  /** A unit riding aboard a transport (see loadUnit/unloadUnit) is excluded
   * everywhere entities are gathered for vision, detection, or targeting —
   * it neither sees nor can be seen/attacked until it disembarks. */
  private allEntities(owner: PlayerId): Entity[] {
    return [
      ...this.state.units.filter((u) => u.owner === owner && !u.loadedInto),
      ...this.state.buildings.filter((b) => b.owner === owner),
    ];
  }

  private enemyEntities(owner: PlayerId): Entity[] {
    return this.state.activePlayers.filter((candidate) => candidate !== owner)
      .flatMap((candidate) => this.allEntities(candidate).filter((e) => e.kind !== 'building' || this.isBuildingVisibleTo(owner, e)));
  }

  /** A freshly-queued foundation (underConstruction with no real progress
   * yet — its builder hasn't arrived and started working) doesn't exist as
   * far as anyone but its owner is concerned: invisible and untargetable no
   * matter how good the viewer's vision of that spot is, exactly like a
   * building nobody has scouted yet. The instant its builder is on site and
   * progress actually starts, it becomes a normal half-built structure —
   * visible (subject to the usual sight-range fog) and destroyable like any
   * other building mid-construction. */
  isBuildingVisibleTo(viewer: PlayerId, building: BuildingState): boolean {
    if (building.owner === viewer) return true;
    if (building.underConstruction && building.constructionProgress <= 0) return false;
    return this.isVisibleTo(viewer, building.position);
  }

  opponentPlayers(owner: PlayerId): PlayerId[] {
    return this.state.activePlayers.filter((candidate) => candidate !== owner);
  }

  primaryOpponent(owner: PlayerId): PlayerId | undefined {
    return this.state.activePlayers.find((candidate) => candidate !== owner && this.getCommandCenter(candidate))
      ?? this.state.activePlayers.find((candidate) => candidate !== owner);
  }

  getNearestEnemyEntity(owner: PlayerId, from: Vector2): Entity | undefined {
    const enemies = this.enemyEntities(owner);
    let best: Entity | undefined;
    let bestDist = Infinity;
    for (const e of enemies) {
      const d = distance(from, e.position);
      if (d < bestDist) {
        bestDist = d;
        best = e;
      }
    }
    return best;
  }

  /** Same as getNearestEnemyEntity, but restricted to entities `owner` can
   * currently see — used for anything that represents a script/AI *deciding*
   * where to strike, as opposed to a unit already locally engaged in combat. */
  getNearestVisibleEnemyEntity(owner: PlayerId, from: Vector2): Entity | undefined {
    const enemies = this.enemyEntities(owner).filter((e) => this.isVisibleTo(owner, e.position));
    let best: Entity | undefined;
    let bestDist = Infinity;
    for (const e of enemies) {
      const d = distance(from, e.position);
      if (d < bestDist) {
        bestDist = d;
        best = e;
      }
    }
    return best;
  }

  private getNearestAttackableEnemy(attacker: UnitState | BuildingState): Entity | undefined {
    const enemies = this.enemyEntities(attacker.owner);
    let best: Entity | undefined;
    let bestDist = Infinity;
    for (const enemy of enemies) {
      const domain = enemy.kind === 'unit' ? enemy.movementDomain : 'ground';
      if (attacker.kind === 'unit' && !attacker.targetDomains.includes(domain)) continue;
      const d = distance(attacker.position, enemy.position);
      if (d < bestDist) {
        bestDist = d;
        best = enemy;
      }
    }
    return best;
  }

  private getEntityById(id: string): Entity | undefined {
    return this.state.units.find((u) => u.id === id) ?? this.state.buildings.find((b) => b.id === id);
  }

  // ---------------------------------------------------------------------
  // Commands (used by AI actions, interventions, and direct player input)
  // ---------------------------------------------------------------------

  trainUnit(owner: PlayerId, unitType: UnitType): boolean {
    const entry = unitEntryForArchetype(this.state.players[owner].race, unitType);
    if (!entry) return false;
    return this.queueUnit(owner, entry.id, unitType);
  }

  trainRaceUnit(owner: PlayerId, identity: string, producerId?: string): boolean {
    const entry = resolveRaceUnit(this.state.players[owner].race, identity);
    if (!entry) return false;
    return this.queueUnit(owner, entry.id, entry.definition.archetype, producerId);
  }

  private queueUnit(owner: PlayerId, raceUnitId: string, unitType: UnitType, producerId?: string): boolean {
    const requirement = UNIT_RESEARCH_REQUIREMENT[unitType];
    if (requirement && !this.state.players[owner].completedResearch.includes(requirement)) return false;
    const producerType = PRODUCER_FOR_UNIT[unitType];
    const producer = producerId
      ? this.state.buildings.find(
          (b) => b.id === producerId && b.owner === owner && b.type === producerType && !b.underConstruction && b.hp > 0 && b.productionQueue.length < MAX_PRODUCTION_QUEUE,
        )
      : this.state.buildings.find(
          (b) => b.owner === owner && b.type === producerType && !b.underConstruction && b.hp > 0 && b.productionQueue.length < MAX_PRODUCTION_QUEUE,
        );
    if (!producer) return false;
    const cost = UNIT_COSTS[unitType];
    if (this.state.players[owner].resources < cost) return false;
    this.state.players[owner].resources -= cost;
    producer.productionQueue.push({
      id: makeId('prod'),
      unitType,
      raceUnitId,
      progress: 0,
      duration: UNIT_BUILD_TIME[unitType],
    });
    return true;
  }

  research(owner: PlayerId, researchType: ResearchType, producerId?: string): boolean {
    const player = this.state.players[owner];
    if (player.completedResearch.includes(researchType)) return false;
    const prerequisite = RESEARCH_PREREQUISITE[researchType];
    if (prerequisite && !player.completedResearch.includes(prerequisite)) return false;
    if (this.state.buildings.some((b) => b.owner === owner && b.researchQueue.some((r) => r.researchType === researchType))) return false;
    const producerType = RESEARCH_PRODUCER[researchType];
    const lab = producerId
      ? this.state.buildings.find(
          (b) => b.id === producerId && b.owner === owner && b.type === producerType && !b.underConstruction && b.hp > 0 && b.researchQueue.length === 0,
        )
      : this.state.buildings.find(
          (b) => b.owner === owner && b.type === producerType && !b.underConstruction && b.hp > 0 && b.researchQueue.length === 0,
        );
    if (!lab) return false;
    const cost = RESEARCH_COSTS[researchType];
    if (player.resources < cost) return false;
    player.resources -= cost;
    lab.researchQueue.push({ id: makeId('research'), researchType, progress: 0, duration: RESEARCH_DURATION[researchType] });
    return true;
  }

  /** If `position` is omitted, an automatic spot near the player's base is
   * chosen. Sends a free builder to walk there and do the work — construction
   * only progresses once that builder is on site (see stepBuilding()), so a
   * building with no builder left to finish it just sits half-built. */
  constructBuilding(owner: PlayerId, buildingType: BuildingType, position?: Vector2, raceBuildingId?: string): boolean {
    if (buildingType === 'commandCenter') return false; // not player-constructible
    const entry = raceBuildingId
      ? resolveRaceBuilding(this.state.players[owner].race, raceBuildingId)
      : buildingEntryForArchetype(this.state.players[owner].race, buildingType);
    if (!entry || entry.definition.archetype !== buildingType) return false;
    const cost = BUILDING_COSTS[buildingType];
    if (this.state.players[owner].resources < cost) return false;

    const spot = position ?? this.pickAutoBuildSpot(owner, buildingType);
    if (!spot || !this.isValidBuildPosition(spot, buildingType)) return false;

    const builder = this.getUnits(owner, 'builder').find((u) => u.order.type !== 'build');
    if (!builder) return false; // no builder available to go build it

    this.state.players[owner].resources -= cost;
    const building = createBuilding(buildingType, owner, spot, this.state.players[owner].race, { underConstruction: true }, entry.id);
    building.constructionProgress = 0;
    this.state.buildings.push(building);

    builder.order = { type: 'build', buildingId: building.id };
    builder.gatherState = null;
    builder.gatherTimer = 0;
    builder.scoutWaypoint = null;
    return true;
  }

  constructRaceBuilding(owner: PlayerId, identity: string, position?: Vector2): boolean {
    const entry = resolveRaceBuilding(this.state.players[owner].race, identity);
    if (!entry) return false;
    return this.constructBuilding(owner, entry.definition.archetype, position, entry.id);
  }

  /** Every building's foundation stands on dry land — nothing in this game
   * actually builds ON the water — but a shipyard additionally has to be
   * coastal (within SHORE_ADJACENCY_RADIUS of a water tile), since that's
   * where it launches ships onto. Every other type has no such requirement. */
  isValidBuildPosition(pos: Vector2, buildingType?: BuildingType): boolean {
    if (pos.x < 20 || pos.y < 20 || pos.x > this.state.map.width - 20 || pos.y > this.state.map.height - 20) {
      return false;
    }
    if (isWater(this.state.map, pos)) return false; // every current building type needs dry land
    if (buildingType === 'shipyard' && !this.isNearWater(pos, SHORE_ADJACENCY_RADIUS)) return false;
    for (const b of this.state.buildings) {
      if (distance(b.position, pos) < MIN_BUILD_SPACING) return false;
    }
    for (const n of this.state.map.resourceNodes) {
      if (distance(n.position, pos) < 50) return false;
    }
    return true;
  }

  private isNearWater(pos: Vector2, radius: number): boolean {
    const map = this.state.map;
    const tileRadius = Math.ceil(radius / TILE_SIZE);
    const center = worldToTile(pos, map.terrainCols, map.terrainRows);
    for (let dRow = -tileRadius; dRow <= tileRadius; dRow += 1) {
      for (let dCol = -tileRadius; dCol <= tileRadius; dCol += 1) {
        const col = center.col + dCol;
        const row = center.row + dRow;
        if (col < 0 || row < 0 || col >= map.terrainCols || row >= map.terrainRows) continue;
        const tilePos = { x: col * TILE_SIZE + TILE_SIZE / 2, y: row * TILE_SIZE + TILE_SIZE / 2 };
        if (distance(pos, tilePos) > radius) continue;
        if (isWater(map, tilePos)) return true;
      }
    }
    return false;
  }

  private pickAutoBuildSpot(owner: PlayerId, buildingType?: BuildingType): Vector2 | null {
    const base = this.state.map.bases[owner];
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 90 + Math.random() * 160;
      const spot = { x: base.x + Math.cos(angle) * radius, y: base.y + Math.sin(angle) * radius };
      if (this.isValidBuildPosition(spot, buildingType)) return spot;
    }
    if (buildingType === 'shipyard') return this.pickAutoShipyardSpot(owner);
    return null;
  }

  /** The generic random-ring search above rarely lands within shore range by
   * chance, so a shipyard gets its own search: scan outward from the base
   * for the nearest valid (dry, coastal, unobstructed) spot instead. */
  private pickAutoShipyardSpot(owner: PlayerId): Vector2 | null {
    const base = this.state.map.bases[owner];
    const map = this.state.map;
    const originTile = worldToTile(base, map.terrainCols, map.terrainRows);
    const maxTileRadius = Math.ceil((map.terrainCols + map.terrainRows) / 2);
    for (let tileRadius = 1; tileRadius <= maxTileRadius; tileRadius += 1) {
      for (let dRow = -tileRadius; dRow <= tileRadius; dRow += 1) {
        for (let dCol = -tileRadius; dCol <= tileRadius; dCol += 1) {
          if (Math.max(Math.abs(dRow), Math.abs(dCol)) !== tileRadius) continue; // only this ring
          const col = originTile.col + dCol;
          const row = originTile.row + dRow;
          if (col < 0 || row < 0 || col >= map.terrainCols || row >= map.terrainRows) continue;
          const spot = { x: col * TILE_SIZE + TILE_SIZE / 2, y: row * TILE_SIZE + TILE_SIZE / 2 };
          if (this.isValidBuildPosition(spot, 'shipyard')) return spot;
        }
      }
    }
    return null;
  }

  private nearestTerrainPosition(origin: Vector2, water: boolean): Vector2 {
    const map = this.state.map;
    let best = { ...origin };
    let bestDistance = Infinity;
    for (let row = 0; row < map.terrainRows; row += 1) {
      for (let col = 0; col < map.terrainCols; col += 1) {
        const position = { x: col * TILE_SIZE + TILE_SIZE / 2, y: row * TILE_SIZE + TILE_SIZE / 2 };
        if (isWater(map, position) !== water) continue;
        const d = distance(origin, position);
        if (d < bestDistance) {
          best = position;
          bestDistance = d;
        }
      }
    }
    return best;
  }

  private moveUnitToward(unit: UnitState, target: Vector2, amount: number): Vector2 {
    const destination = this.clampToMap(target);
    if (unit.movementDomain === 'air') return this.clampToMap(moveToward(unit.position, destination, amount));

    const targetTile = terrainTileKey(this.state.map, destination);
    let cached = this.movementPaths.get(unit.id);
    const displaced = cached ? distance(cached.lastPosition, unit.position) > TILE_SIZE * 2.5 : false;
    if (!cached || cached.domain !== unit.movementDomain || cached.targetTile !== targetTile || displaced) {
      cached = {
        domain: unit.movementDomain,
        targetTile,
        waypoints: findTerrainPath(this.state.map, unit.position, destination, unit.movementDomain),
        waypointIndex: 0,
        lastPosition: { ...unit.position },
      };
      this.movementPaths.set(unit.id, cached);
    }

    const arrival = Math.max(5, amount * 1.5);
    while (cached.waypointIndex < cached.waypoints.length && distance(unit.position, cached.waypoints[cached.waypointIndex]) <= arrival) {
      cached.waypointIndex += 1;
    }
    const waypoint = cached.waypoints[cached.waypointIndex];
    if (!waypoint) {
      cached.lastPosition = { ...unit.position };
      return unit.position;
    }

    const next = this.clampToMap(moveToward(unit.position, waypoint, amount));
    const needsWater = unit.movementDomain === 'sea';
    const currentIsValid = isWater(this.state.map, unit.position) === needsWater;
    if (currentIsValid && isWater(this.state.map, next) !== needsWater) {
      // A unit may begin just across a shoreline because of an old save or a
      // producer footprint. Let the next tick rebuild a recovery path rather
      // than allowing it to keep sliding through the wrong terrain.
      this.movementPaths.delete(unit.id);
      return unit.position;
    }
    cached.lastPosition = { ...next };
    return next;
  }

  /** Looks up one of `owner`'s own units by id — never returns a unit
   * belonging to the other player, even if a script somehow learned its id
   * (e.g. via an enemyUnitsNear() query), so a script can only ever command
   * its own side. */
  /** A loaded unit (see loadUnit) can't be individually commanded until it
   * disembarks — every orderUnit... and useUnitSkill method goes through
   * this single choke point, so that's enforced everywhere at once. */
  private ownedUnit(owner: PlayerId, unitId: string): UnitState | undefined {
    return this.state.units.find((u) => u.id === unitId && u.owner === owner && !u.loadedInto);
  }

  /** Single-unit move order, for scripts that found a specific unit via a
   * query and want to command it individually rather than in bulk. */
  orderUnitMoveTo(owner: PlayerId, unitId: string, position: Vector2): boolean {
    const unit = this.ownedUnit(owner, unitId);
    if (!unit) return false;
    unit.order = { type: 'moveTo', position: { ...position } };
    unit.gatherState = null;
    unit.gatherTimer = 0;
    unit.scoutWaypoint = null;
    return true;
  }

  /** Single-unit attack-move order (see orderUnitMoveTo). */
  orderUnitAttackMoveTo(owner: PlayerId, unitId: string, position: Vector2): boolean {
    const unit = this.ownedUnit(owner, unitId);
    if (!unit) return false;
    unit.order = { type: 'attackMove', position: { ...position } };
    unit.gatherState = null;
    unit.gatherTimer = 0;
    unit.scoutWaypoint = null;
    return true;
  }

  orderUnitAttackTarget(owner: PlayerId, unitId: string, targetId: string): boolean {
    const unit = this.ownedUnit(owner, unitId);
    const target = this.state.units.find((candidate) => candidate.id === targetId)
      ?? this.state.buildings.find((candidate) => candidate.id === targetId);
    if (!unit || !target || target.owner === owner || !this.isPositionVisibleTo(owner, target.position)) return false;
    unit.order = { type: 'attackTarget', targetId };
    unit.gatherState = null;
    unit.gatherTimer = 0;
    unit.scoutWaypoint = null;
    return true;
  }

  orderUnitDefendAt(owner: PlayerId, unitId: string, position: Vector2): boolean {
    const unit = this.ownedUnit(owner, unitId);
    if (!unit) return false;
    unit.order = { type: 'defend', position: { ...position } };
    unit.gatherState = null;
    unit.gatherTimer = 0;
    unit.scoutWaypoint = null;
    return true;
  }

  orderUnitRetreat(owner: PlayerId, unitId: string): boolean {
    const unit = this.ownedUnit(owner, unitId);
    if (!unit) return false;
    unit.order = { type: 'retreat' };
    unit.gatherState = null;
    unit.gatherTimer = 0;
    unit.scoutWaypoint = null;
    return true;
  }

  /** Sends any one specific owned unit out scouting — unlike orderScoutMap(),
   * which only ever grabs a dedicated Scout (or, lacking one, a single idle
   * unit it picks itself), this lets a script deliberately press a spare
   * soldier/tank/etc. into scouting duty, e.g. once its dedicated scout has
   * died or when map coverage is still low and there are units to spare. */
  orderUnitScout(owner: PlayerId, unitId: string): boolean {
    const unit = this.ownedUnit(owner, unitId);
    if (!unit || unit.type === 'builder') return false;
    // Already out scouting: leave its in-progress waypoint alone. A script
    // that calls this every tick to "make sure" a unit is scouting must not
    // reroll its target that often, or it never travels anywhere — see
    // orderScoutMap() below, which had exactly this bug.
    if (unit.order.type === 'scout' && unit.scoutWaypoint) return true;
    unit.order = { type: 'scout' };
    unit.gatherState = null;
    unit.gatherTimer = 0;
    unit.scoutWaypoint = this.randomWaypointFor(unit);
    return true;
  }

  orderUnitGather(owner: PlayerId, unitId: string, nodeId: string): boolean {
    const unit = this.ownedUnit(owner, unitId);
    const node = this.state.map.resourceNodes.find((candidate) => candidate.id === nodeId);
    if (!unit || unit.type !== 'builder' || !node || node.remaining <= 0) return false;
    if (!this.isResourceNodeDiscovered(owner, nodeId) || !this.isResourceNodeCovered(owner, nodeId)) return false;
    unit.order = { type: 'gather', nodeId };
    unit.gatherState = 'toNode';
    unit.gatherTimer = 0;
    unit.carriedResources = 0;
    unit.scoutWaypoint = null;
    return true;
  }

  orderUnitStop(owner: PlayerId, unitId: string): boolean {
    const unit = this.ownedUnit(owner, unitId);
    if (!unit) return false;
    unit.order = { type: 'idle' };
    unit.gatherState = null;
    unit.gatherTimer = 0;
    unit.carriedResources = 0;
    unit.scoutWaypoint = null;
    this.movementPaths.delete(unit.id);
    return true;
  }

  private static readonly BOARDING_RADIUS = 70;

  /** Loads `unitId` aboard `transportId` — both must be `owner`'s, the
   * passenger must be within boarding range and not already riding
   * something, the transport must actually have cargo capacity (see
   * TRANSPORT_CAPACITY) with enough room left for the passenger's size
   * class, and neither may already be carrying cargo of its own (no nested
   * transports). A loaded unit stops acting immediately — see ownedUnit()
   * and the loadedInto checks throughout the per-tick step*() methods. */
  loadUnit(owner: PlayerId, transportId: string, unitId: string): boolean {
    if (transportId === unitId) return false;
    const transport = this.ownedUnit(owner, transportId);
    const passenger = this.ownedUnit(owner, unitId);
    if (!transport || !passenger) return false;
    const capacity = TRANSPORT_CAPACITY[transport.type];
    if (!capacity) return false;
    if (passenger.cargo.length > 0) return false; // cargo can't itself carry cargo
    if (distance(transport.position, passenger.position) > Simulation.BOARDING_RADIUS) return false;
    const passengerVolume = UNIT_VOLUME_SIZE[passenger.type];
    if (VOLUME_SIZE_ORDINAL[passengerVolume] > VOLUME_SIZE_ORDINAL[capacity.tier]) return false;
    if (this.cargoLoad(transport) + VOLUME_COST[passengerVolume] > capacity.capacity) return false;

    passenger.loadedInto = transport.id;
    passenger.order = { type: 'idle' };
    passenger.gatherState = null;
    passenger.gatherTimer = 0;
    passenger.scoutWaypoint = null;
    this.movementPaths.delete(passenger.id);
    transport.cargo.push(passenger.id);
    return true;
  }

  /** Disembarks one unit, placing it at the transport's current position.
   * Works even though a loaded unit is invisible to ownedUnit() — this is
   * the one operation that's allowed to reach it directly. */
  unloadUnit(owner: PlayerId, unitId: string): boolean {
    const passenger = this.state.units.find((u) => u.id === unitId && u.owner === owner && u.loadedInto);
    if (!passenger) return false;
    const transport = this.state.units.find((u) => u.id === passenger.loadedInto);
    passenger.loadedInto = null;
    if (transport) {
      transport.cargo = transport.cargo.filter((id) => id !== passenger.id);
      passenger.position = { ...transport.position };
    }
    return true;
  }

  /** Disembarks everyone aboard a transport at once; returns how many. */
  unloadAllFrom(owner: PlayerId, transportId: string): number {
    const transport = this.state.units.find((u) => u.id === transportId && u.owner === owner);
    if (!transport) return 0;
    let count = 0;
    for (const passengerId of [...transport.cargo]) {
      if (this.unloadUnit(owner, passengerId)) count += 1;
    }
    return count;
  }

  private cargoLoad(transport: UnitState): number {
    return transport.cargo.reduce((sum, id) => {
      const passenger = this.state.units.find((u) => u.id === id);
      return sum + (passenger ? VOLUME_COST[UNIT_VOLUME_SIZE[passenger.type]] : 0);
    }, 0);
  }

  getCargoIds(transportId: string): string[] {
    return this.state.units.find((u) => u.id === transportId)?.cargo ?? [];
  }

  getCargoLoad(transportId: string): number {
    const transport = this.state.units.find((u) => u.id === transportId);
    return transport ? this.cargoLoad(transport) : 0;
  }

  getTransportCapacity(transportId: string): number {
    const transport = this.state.units.find((u) => u.id === transportId);
    return transport ? TRANSPORT_CAPACITY[transport.type]?.capacity ?? 0 : 0;
  }

  /** A loaded unit's position tracks its transport's every tick, so it's
   * somewhere sane the instant it disembarks (or if the transport is
   * destroyed — see removeDead(), which sinks cargo with it). */
  private stepCargoPositions(): void {
    for (const u of this.state.units) {
      if (!u.loadedInto) continue;
      const transport = this.state.units.find((candidate) => candidate.id === u.loadedInto);
      if (transport) u.position = { ...transport.position };
    }
  }

  setUnitsOrder(unitIds: string[], order: UnitOrder): void {
    const idSet = new Set(unitIds);
    for (const u of this.state.units) {
      if (idSet.has(u.id)) {
        u.order = order;
        if (order.type !== 'gather') {
          u.gatherState = null;
          u.gatherTimer = 0;
        }
        if (order.type !== 'scout') {
          u.scoutWaypoint = null;
        }
      }
    }
  }

  orderGatherResources(owner: PlayerId): void {
    const builders = this.getUnits(owner, 'builder').filter((u) => u.order.type === 'idle' || u.order.type === 'defend' || u.order.type === 'retreat');
    for (const b of builders) {
      const node = this.nearestNodeWithResources(owner, b.position);
      if (node) {
        b.order = { type: 'gather', nodeId: node.id };
        b.gatherState = 'toNode';
      }
    }
  }

  orderAttackNearestEnemy(owner: PlayerId): void {
    const attackers = this.getUnits(owner).filter((u) => u.type !== 'builder');
    const cc = this.getCommandCenter(owner);
    const from = cc ? cc.position : this.state.map.bases[owner];
    // Only ever moves toward an enemy this player can currently see — a script
    // has to actually scout before it can order a targeted attack, the same
    // constraint a human player would face against the fog of war.
    const target = this.getNearestVisibleEnemyEntity(owner, from);
    if (!target) return;
    for (const u of attackers) {
      u.order = { type: 'attackMove', position: { ...target.position } };
    }
  }

  /** Attack-moves toward an explicit point rather than the nearest enemy or
   * their Command Center — used by scripts that compute their own target. */
  orderAttackMoveTo(owner: PlayerId, position: Vector2): void {
    const attackers = this.getUnits(owner).filter((u) => u.type !== 'builder');
    for (const u of attackers) {
      u.order = { type: 'attackMove', position: { ...position } };
    }
  }

  orderAttackEnemyCommandCenter(owner: PlayerId): void {
    const opponent = this.primaryOpponent(owner);
    const enemyCC = opponent ? this.getCommandCenter(opponent) : undefined;
    // A precise beeline to the enemy base requires having actually scouted
    // it at least once (see updateEnemyBaseDiscovery) — otherwise this falls
    // back to attacking whatever enemy is currently visible.
    if (!enemyCC || !this.isEnemyBaseDiscovered(owner, opponent!)) {
      this.orderAttackNearestEnemy(owner);
      return;
    }
    const attackers = this.getUnits(owner).filter((u) => u.type !== 'builder');
    for (const u of attackers) {
      u.order = { type: 'attackMove', position: { ...enemyCC.position } };
    }
  }

  orderDefendCommandCenter(owner: PlayerId): void {
    const cc = this.getCommandCenter(owner);
    const point = cc ? cc.position : this.state.map.bases[owner];
    const defenders = this.getUnits(owner).filter((u) => u.type !== 'builder');
    for (const u of defenders) {
      u.order = { type: 'defend', position: { ...point } };
    }
  }

  orderRetreatToBase(owner: PlayerId): void {
    for (const u of this.getUnits(owner)) {
      if (u.type === 'builder') continue;
      u.order = { type: 'retreat' };
    }
  }

  orderScoutMap(owner: PlayerId): void {
    const scouts = this.getUnits(owner, 'scout');
    // With no dedicated Scout, borrow one idle unit rather than yanking a
    // soldier or tank off active combat duty to go wander the map instead.
    const pool = scouts.length > 0 ? scouts : this.getUnits(owner).filter((u) => u.type !== 'builder' && u.order.type === 'idle').slice(0, 1);
    for (const u of pool) {
      // A unit already out scouting keeps its in-progress waypoint — a
      // doctrine script calling scoutMap() every AI tick (as they all do,
      // at 20 ticks/second) used to reroll every scout's target that often,
      // so it never actually got anywhere: it just twitched toward whatever
      // random point won each instant. Only units not already mid-scout
      // (freshly idle, or pulled off scout duty and being sent back out)
      // get a new order + waypoint here.
      if (u.order.type === 'scout' && u.scoutWaypoint) continue;
      u.order = { type: 'scout' };
      u.scoutWaypoint = this.randomWaypointFor(u);
    }
  }

  rallyUnitsAt(owner: PlayerId, position: Vector2): void {
    for (const u of this.getUnits(owner)) {
      if (u.type === 'builder') continue;
      u.order = { type: 'moveTo', position: { ...position } };
    }
  }

  // ---------------------------------------------------------------------
  // Step phases
  // ---------------------------------------------------------------------

  private stepProduction(dt: number): void {
    for (const b of this.state.buildings) {
      if (b.underConstruction) continue;
      if (b.productionQueue.length === 0) continue;
      const order = b.productionQueue[0];
      order.progress = clamp(order.progress + dt / order.duration, 0, 1);
      if (order.progress >= 1) {
        b.productionQueue.shift();
        const spawnPos = { x: b.position.x + (Math.random() - 0.5) * 30, y: b.position.y + 50 + (Math.random() - 0.5) * 20 };
        this.spawnUnit(order.unitType, b.owner, spawnPos, order.raceUnitId);
      }
    }
  }

  /** Assigns enough available builders to bring a specific covered node up
   * to `targetMinerCount`. Returns how many new builders were assigned. */
  orderMineResourceNode(owner: PlayerId, nodeId: string, targetMinerCount: number): number {
    const node = this.state.map.resourceNodes.find((candidate) => candidate.id === nodeId);
    if (!node || node.remaining <= 0 || !this.isResourceNodeDiscovered(owner, nodeId) || !this.isResourceNodeCovered(owner, nodeId)) return 0;

    const target = Math.max(1, Math.min(12, Math.floor(targetMinerCount)));
    const alreadyAssigned = this.getUnits(owner, 'builder').filter(
      (builder) => builder.order.type === 'gather' && builder.order.nodeId === nodeId,
    ).length;
    let needed = Math.max(0, target - alreadyAssigned);
    if (needed === 0) return 0;

    const candidates = this.getUnits(owner, 'builder')
      .filter((builder) => builder.order.type !== 'build' && builder.order.type !== 'gather')
      .sort((a, b) => distance(a.position, node.position) - distance(b.position, node.position));
    let assigned = 0;
    for (const builder of candidates) {
      if (needed <= 0) break;
      builder.order = { type: 'gather', nodeId };
      builder.gatherState = 'toNode';
      builder.gatherTimer = 0;
      builder.carriedResources = 0;
      builder.scoutWaypoint = null;
      assigned += 1;
      needed -= 1;
    }
    return assigned;
  }

  /** Builds the race's Outpost at a valid dry-land position close enough to
   * activate a discovered deposit. Building directly on the node is invalid,
   * so this searches several rings around it for a proper expansion site. */
  constructMiningOutpost(owner: PlayerId, nodeId: string): boolean {
    const node = this.state.map.resourceNodes.find((candidate) => candidate.id === nodeId);
    if (!node || node.remaining <= 0 || !this.isResourceNodeDiscovered(owner, nodeId) || this.isResourceNodeCovered(owner, nodeId)) return false;

    const towardBase = Math.atan2(this.state.map.bases[owner].y - node.position.y, this.state.map.bases[owner].x - node.position.x);
    for (const radius of [88, 120, 160, 208]) {
      for (let step = 0; step < 12; step += 1) {
        const angle = towardBase + (step / 12) * Math.PI * 2;
        const spot = {
          x: node.position.x + Math.cos(angle) * radius,
          y: node.position.y + Math.sin(angle) * radius,
        };
        if (distance(spot, node.position) <= RESOURCE_GARRISON_RADIUS && this.isValidBuildPosition(spot)) {
          return this.constructBuilding(owner, 'outpost', spot);
        }
      }
    }
    return false;
  }

  private stepResearch(dt: number): void {
    for (const building of this.state.buildings) {
      if (building.underConstruction || building.researchQueue.length === 0) continue;
      const order = building.researchQueue[0];
      order.progress = clamp(order.progress + dt / order.duration, 0, 1);
      if (order.progress >= 1) {
        building.researchQueue.shift();
        if (!this.state.players[building.owner].completedResearch.includes(order.researchType)) {
          this.state.players[building.owner].completedResearch.push(order.researchType);
          for (const unit of this.getUnits(building.owner)) this.applyResearchToUnit(unit, order.researchType);
        }
      }
    }
  }

  private applyResearchToUnit(unit: UnitState, research: ResearchType): void {
    const addMaxHp = (factor: number) => {
      const previous = unit.maxHp;
      unit.maxHp = Math.round(unit.maxHp * factor);
      unit.hp = Math.min(unit.maxHp, unit.hp + unit.maxHp - previous);
    };
    if (research === 'fieldLogistics' && unit.type === 'builder') unit.speed = Math.round(unit.speed * 1.18);
    if (research === 'infantryTactics' && ['soldier', 'rocketeer', 'marksman', 'scout'].includes(unit.type)) {
      addMaxHp(1.1);
      unit.attack = Math.round(unit.attack * 1.1);
    }
    if (research === 'compositeArmor' && (unit.type === 'tank' || unit.type === 'artillery')) addMaxHp(1.15);
    if (research === 'advancedBallistics' && ['rocketeer', 'marksman', 'artillery'].includes(unit.type)) {
      unit.attack = Math.round(unit.attack * 1.12);
      unit.attackRange = Math.round(unit.attackRange * 1.1);
    }
    if (research === 'aerialEngineering' && (unit.type === 'aircraft' || unit.type === 'bomber')) {
      unit.attack = Math.round(unit.attack * 1.12);
      unit.speed = Math.round(unit.speed * 1.12);
    }
    if (research === 'navalEngineering' && unit.movementDomain === 'sea') {
      addMaxHp(1.12);
      unit.attack = Math.round(unit.attack * 1.12);
    }
  }

  private stepSkills(dt: number): void {
    for (const unit of this.state.units) {
      for (const skill of unit.skills) {
        skill.cooldownRemaining = Math.max(0, skill.cooldownRemaining - dt);
        skill.activeRemaining = Math.max(0, skill.activeRemaining - dt);
      }
    }

    this.skillAutocastAccumulator += dt;
    if (this.skillAutocastAccumulator < 0.2) return;
    this.skillAutocastAccumulator %= 0.2;
    for (const unit of this.state.units) {
      if (unit.loadedInto) continue;
      const ready = unit.skills.find((skill) => skill.cooldownRemaining <= 0);
      if (!ready) continue;
      const definition = this.skillDefinition(unit, ready.id);
      if (!definition) continue;
      if (definition.effect === 'repairPulse') {
        this.useUnitSkill(unit.owner, unit.id, ready.id);
        continue;
      }
      const isCombatOrder = unit.order.type === 'attackMove' || unit.order.type === 'attackTarget' || unit.order.type === 'defend';
      if (!isCombatOrder) continue;
      const enemy = this.getNearestAttackableEnemy(unit);
      if (enemy && distance(unit.position, enemy.position) <= unit.sight * 1.15) {
        this.useUnitSkill(unit.owner, unit.id, ready.id);
      }
    }
  }

  private stepSupportUnits(dt: number): void {
    // Aether biology knits itself back together even without a Mender. The
    // effect is deliberately modest in combat; dedicated support is faster.
    for (const unit of this.state.units) {
      if (unit.loadedInto) continue;
      if (unit.race === 'aether' && unit.hp > 0 && unit.hp < unit.maxHp) {
        unit.hp = Math.min(unit.maxHp, unit.hp + 2.5 * dt);
      }
    }

    for (const support of this.state.units) {
      if (support.hp <= 0 || support.loadedInto) continue;

      // Nullforge damage is mechanical: Assemblers make close repairs while
      // Repair Orbs service a wider area, including structures. They receive
      // no passive regeneration.
      if (support.race === 'nullforge' && (support.type === 'builder' || support.type === 'support')) {
        const range = support.type === 'support' ? 160 : 90;
        const rate = support.type === 'support' ? 11 : 5;
        const repairable: Entity[] = [...this.getUnits(support.owner), ...this.getBuildings(support.owner)];
        const target = repairable
          .filter((entity) => entity.id !== support.id && entity.hp > 0 && entity.hp < entity.maxHp && distance(entity.position, support.position) <= range)
          .sort((a, b) => distance(a.position, support.position) - distance(b.position, support.position))[0];
        if (target) target.hp = Math.min(target.maxHp, target.hp + rate * dt);
        continue;
      }

      if (support.type !== 'support') continue;
      const ally = this.state.units
        .filter((unit) => unit.owner === support.owner && unit.id !== support.id && unit.hp > 0 && unit.hp < unit.maxHp && distance(unit.position, support.position) <= 150)
        .sort((a, b) => distance(a.position, support.position) - distance(b.position, support.position))[0];
      if (ally) {
        const rate = support.race === 'aether' ? 12 : 8;
        ally.hp = Math.min(ally.maxHp, ally.hp + rate * dt);
      }
    }
  }

  /** Builders assigned to a `build` order walk to the site first; a
   * foundation only progresses toward completion while a builder is actually
   * standing there working it — no builder present, no progress. */
  private stepBuilding(dt: number): void {
    const onSiteBuildingIds = new Set<string>();
    for (const u of this.state.units) {
      if (u.loadedInto || u.type !== 'builder' || u.order.type !== 'build') continue;
      const order = u.order;
      const building = this.state.buildings.find((b) => b.id === order.buildingId);
      if (!building || !building.underConstruction) {
        u.order = { type: 'idle' };
        continue;
      }
      if (distance(u.position, building.position) > BUILD_ARRIVAL_RADIUS) {
        u.position = this.moveUnitToward(u, building.position, this.effectiveUnitSpeed(u) * dt);
        // Same freeze this fixes in stepGathering(): once moveUnitToward()'s
        // cached path is exhausted short of arrival, it just keeps returning
        // the same position forever. A foundation the assigned builder
        // genuinely can't reach would otherwise sit at 0% progress for the
        // rest of the match with no way to notice or recover.
        if (this.isPathExhausted(u.id, u.position, building.position)) {
          u.order = { type: 'idle' };
          this.movementPaths.delete(u.id);
        }
      } else {
        onSiteBuildingIds.add(building.id);
      }
    }

    for (const b of this.state.buildings) {
      if (!b.underConstruction || !onSiteBuildingIds.has(b.id)) continue;
      const duration = Math.max(0.1, BUILDING_BUILD_TIME[b.type]);
      b.constructionProgress = clamp(b.constructionProgress + dt / duration, 0, 1);
      b.hp = Math.round(b.maxHp * clamp(0.2 + 0.8 * b.constructionProgress, 0, 1));
      if (b.constructionProgress >= 1) {
        b.underConstruction = false;
        b.hp = b.maxHp;
        this.state.stats[b.owner].buildingsConstructed += 1;
        for (const u of this.state.units) {
          if (u.type === 'builder' && u.order.type === 'build' && u.order.buildingId === b.id) {
            u.order = { type: 'idle' };
          }
        }
      }
    }
  }

  private stepAutoGatherAssignment(): void {
    // Builders auto-gather from the nearest available node whenever idle,
    // exactly like the spec describes ("Builders automatically gather resources").
    for (const u of this.state.units) {
      if (u.loadedInto || u.type !== 'builder' || u.order.type !== 'idle') continue;
      const node = this.nearestNodeWithResources(u.owner, u.position);
      if (node) {
        u.order = { type: 'gather', nodeId: node.id };
        u.gatherState = 'toNode';
      }
    }
  }

  /** The nearest completed Command Center or Outpost belonging to `owner` —
   * where that owner's builders deposit resources, and what "garrisons" a
   * resource node (see nearestNodeWithResources). */
  private nearestDropoff(owner: PlayerId, from: Vector2): BuildingState | undefined {
    let best: BuildingState | undefined;
    let bestDist = Infinity;
    for (const b of this.state.buildings) {
      if (b.owner !== owner || b.underConstruction) continue;
      if (b.type !== 'commandCenter' && b.type !== 'outpost') continue;
      const d = distance(from, b.position);
      if (d < bestDist) {
        bestDist = d;
        best = b;
      }
    }
    return best;
  }

  /** Whether `owner` currently has a unit or building within its own sight
   * of `point` — the same rule updateDetection() uses for enemy detection,
   * reused here to gate resource-node discovery (see isResourceNodeDiscovered). */
  private isVisibleTo(owner: PlayerId, point: Vector2): boolean {
    for (const e of this.allEntities(owner)) {
      const sight = e.kind === 'unit' ? e.sight : BUILDING_SIGHT;
      if (distance(e.position, point) <= sight) return true;
    }
    return false;
  }

  isPositionVisibleTo(owner: PlayerId, point: Vector2): boolean {
    return this.isVisibleTo(owner, point);
  }

  /** Whether `owner` has ever scouted this resource node — once seen, a
   * node's id/position stays known forever (it can't move), same as a
   * scouted enemy building. Never currently-visible-only: a script that
   * queried resourceNodesNear() once can keep reading nodeX/nodeY/
   * nodeRemaining by that id even after moving on. */
  isResourceNodeDiscovered(owner: PlayerId, nodeId: string): boolean {
    return this.discoveredResourceNodes[owner].has(nodeId);
  }

  isResourceNodeCovered(owner: PlayerId, nodeId: string): boolean {
    const node = this.state.map.resourceNodes.find((candidate) => candidate.id === nodeId);
    if (!node) return false;
    const dropoff = this.nearestDropoff(owner, node.position);
    return !!dropoff && distance(dropoff.position, node.position) <= RESOURCE_GARRISON_RADIUS;
  }

  minersAtResourceNode(owner: PlayerId, nodeId: string): number {
    return this.getUnits(owner, 'builder').filter(
      (builder) => builder.order.type === 'gather' && builder.order.nodeId === nodeId,
    ).length;
  }

  private updateResourceDiscovery(): void {
    for (const owner of this.state.activePlayers) {
      const known = this.discoveredResourceNodes[owner];
      for (const n of this.state.map.resourceNodes) {
        if (!known.has(n.id) && this.isVisibleTo(owner, n.position)) known.add(n.id);
      }
    }
  }

  /** Same "seen once, known forever" rule as resource nodes: a player's base
   * location isn't handed to the opponent's script for free — attackEnemy
   * CommandCenter()/enemyBaseX()/enemyBaseY() only resolve to the real spot
   * once a scout has actually laid eyes on that command center. */
  private updateEnemyBaseDiscovery(): void {
    for (const owner of this.state.activePlayers) {
      const known = this.discoveredEnemyBases[owner];
      for (const enemy of this.opponentPlayers(owner)) {
        if (known.has(enemy)) continue;
        const enemyCC = this.getCommandCenter(enemy);
        if (enemyCC && this.isVisibleTo(owner, enemyCC.position)) known.add(enemy);
      }
    }
  }

  isEnemyBaseDiscovered(owner: PlayerId, enemy: PlayerId): boolean {
    return this.discoveredEnemyBases[owner].has(enemy);
  }

  private explorationCellKey(point: Vector2): string {
    return `${Math.floor(point.x / EXPLORATION_CELL_SIZE)},${Math.floor(point.y / EXPLORATION_CELL_SIZE)}`;
  }

  /** Marks every exploration cell within each of `owner`'s units'/buildings'
   * current sight as permanently seen — same accumulate-forever rule as
   * resource/enemy-base discovery above. Cheap: the grid is coarse (a few
   * hundred cells for a typical map) and only cells within a sight-radius
   * bounding box around each entity are visited. */
  private updateExploration(): void {
    for (const owner of this.state.activePlayers) {
      const known = this.exploredCells[owner];
      for (const e of this.allEntities(owner)) {
        const sight = e.kind === 'unit' ? e.sight : BUILDING_SIGHT;
        const minCol = Math.floor((e.position.x - sight) / EXPLORATION_CELL_SIZE);
        const maxCol = Math.floor((e.position.x + sight) / EXPLORATION_CELL_SIZE);
        const minRow = Math.floor((e.position.y - sight) / EXPLORATION_CELL_SIZE);
        const maxRow = Math.floor((e.position.y + sight) / EXPLORATION_CELL_SIZE);
        for (let col = minCol; col <= maxCol; col += 1) {
          for (let row = minRow; row <= maxRow; row += 1) {
            const key = `${col},${row}`;
            if (known.has(key)) continue;
            const cellCenter = { x: col * EXPLORATION_CELL_SIZE + EXPLORATION_CELL_SIZE / 2, y: row * EXPLORATION_CELL_SIZE + EXPLORATION_CELL_SIZE / 2 };
            if (distance(cellCenter, e.position) <= sight) known.add(key);
          }
        }
      }
    }
  }

  /** Fraction (0..1) of the map's exploration grid `owner` has ever seen —
   * lets a script gauge how much of the map is still unknown to it, e.g.
   * `if (mapExploredRatio() < 0.5) { ... send more scouts ... }`. */
  exploredMapRatio(owner: PlayerId): number {
    const cols = Math.max(1, Math.ceil(this.state.map.width / EXPLORATION_CELL_SIZE));
    const rows = Math.max(1, Math.ceil(this.state.map.height / EXPLORATION_CELL_SIZE));
    return this.exploredCells[owner].size / (cols * rows);
  }

  /** Refreshes each currently-visible enemy building into `owner`'s
   * knownEnemyBuildings memory, and prunes any remembered building whose
   * last-known spot is visible again but no longer holds that building —
   * i.e. "I'm looking right where I last saw it, and it's gone now",
   * confirmed-destroyed/relocated rather than merely out of sight. A
   * remembered building that's simply not currently being looked at is left
   * alone, same "seen once, known until disproven" rule as resource nodes
   * and the enemy base. */
  private updateEnemyIntel(): void {
    for (const owner of this.state.activePlayers) {
      const known = this.knownEnemyBuildings[owner];
      for (const enemy of this.opponentPlayers(owner)) {
        const liveIds = new Set<string>();
        for (const building of this.getBuildings(enemy)) {
          liveIds.add(building.id);
          if (!this.isBuildingVisibleTo(owner, building)) continue;
          known.set(building.id, {
            id: building.id,
            owner: enemy,
            buildingType: building.type,
            raceBuildingId: building.raceBuildingId,
            position: { ...building.position },
            lastSeenTime: this.state.time,
          });
        }
        for (const [id, entry] of known) {
          if (entry.owner !== enemy || liveIds.has(id)) continue;
          if (this.isVisibleTo(owner, entry.position)) known.delete(id);
        }
      }
    }
  }

  getKnownEnemyBuildings(owner: PlayerId): KnownEnemyBuilding[] {
    return Array.from(this.knownEnemyBuildings[owner].values());
  }

  /** Only a node with one of `owner`'s Command Centers or Outposts within
   * RESOURCE_GARRISON_RADIUS is gatherable — like Warcraft 3's gold mines,
   * a resource sitting off in open ground needs an Outpost built near it
   * first (see stepBuilding/constructBuilding for how that gets built). */
  private nearestNodeWithResources(owner: PlayerId, from: Vector2) {
    let best: (typeof this.state.map.resourceNodes)[number] | undefined;
    let bestDist = Infinity;
    for (const n of this.state.map.resourceNodes) {
      if (n.remaining <= 0) continue;
      const dropoff = this.nearestDropoff(owner, n.position);
      if (!dropoff || distance(dropoff.position, n.position) > RESOURCE_GARRISON_RADIUS) continue;
      const d = distance(from, n.position);
      if (d < bestDist) {
        bestDist = d;
        best = n;
      }
    }
    return best;
  }

  /** True once a builder's cached path toward `target` has run every
   * waypoint pathfinding gave it but still isn't within arrival range — i.e.
   * the ground route genuinely can't get there (an island node across open
   * water, say), not just "still traveling". moveUnitToward() freezes a unit
   * in that state forever with no retry, since its cache only invalidates on
   * a changed destination or a large positional jump — neither of which
   * happens to a unit that has stopped moving. This is what actually detects
   * it, so a stuck gatherer can be redirected to a reachable node instead. */
  private isPathExhausted(unitId: string, unitPosition: Vector2, target: Vector2): boolean {
    const cached = this.movementPaths.get(unitId);
    if (!cached) return false;
    if (cached.waypointIndex < cached.waypoints.length) return false;
    return distance(unitPosition, target) > GATHER_ARRIVAL_RADIUS;
  }

  private stepGathering(dt: number): void {
    for (const u of this.state.units) {
      if (u.loadedInto || u.type !== 'builder' || u.order.type !== 'gather') continue;
      const nodeId = u.order.type === 'gather' ? u.order.nodeId : null;
      const targetNode = nodeId ? this.state.map.resourceNodes.find((n) => n.id === nodeId) : undefined;

      // A builder carrying the final load must still return it even though
      // that gathering cycle reduced the node to zero.
      if (!targetNode || (targetNode.remaining <= 0 && u.gatherState !== 'toBase')) {
        const replacement = this.nearestNodeWithResources(u.owner, u.position);
        if (replacement) {
          u.order = { type: 'gather', nodeId: replacement.id };
          u.gatherState = 'toNode';
        } else {
          u.order = { type: 'idle' };
          u.gatherState = null;
        }
        continue;
      }

      const dropoff = this.nearestDropoff(u.owner, u.position);
      const depositPoint = dropoff ? dropoff.position : this.state.map.bases[u.owner];

      if (u.gatherState === 'toNode' || u.gatherState === null) {
        u.position = this.moveUnitToward(u, targetNode.position, this.effectiveUnitSpeed(u) * dt);
        if (distance(u.position, targetNode.position) <= GATHER_ARRIVAL_RADIUS) {
          u.gatherState = 'gathering';
          u.gatherTimer = GATHER_CYCLE_TIME;
        } else if (this.isPathExhausted(u.id, u.position, targetNode.position)) {
          // Deliberately goes idle rather than auto-picking another node here:
          // re-running nearestNodeWithResources() by pure distance can hand
          // the unit right back to the same unreachable node it just left (or
          // ping-pong between two mutually-nearest ones, each tick recomputing
          // a fresh path toward whichever the other rejected). Idle is a
          // state the doctrines' own idle-worker handling already watches for
          // and can act on with better judgment than raw distance.
          u.order = { type: 'idle' };
          u.gatherState = null;
          this.movementPaths.delete(u.id);
        }
      } else if (u.gatherState === 'gathering') {
        u.gatherTimer -= dt;
        if (u.gatherTimer <= 0) {
          const taken = Math.min(GATHER_CARRY_AMOUNT, targetNode.remaining);
          targetNode.remaining -= taken;
          u.carriedResources = taken;
          u.gatherState = 'toBase';
        }
      } else if (u.gatherState === 'toBase') {
        u.position = this.moveUnitToward(u, depositPoint, this.effectiveUnitSpeed(u) * dt);
        if (distance(u.position, depositPoint) <= DEPOSIT_ARRIVAL_RADIUS) {
          const deposited = u.carriedResources;
          this.state.players[u.owner].resources += deposited;
          this.state.stats[u.owner].resourcesGathered += deposited;
          u.carriedResources = 0;
          const next = this.nearestNodeWithResources(u.owner, u.position);
          if (next) {
            u.order = { type: 'gather', nodeId: next.id };
            u.gatherState = 'toNode';
          } else {
            u.order = { type: 'idle' };
            u.gatherState = null;
          }
        }
      }
    }
  }

  private stepMovementAndCombat(dt: number): void {
    const allUnits = this.state.units;

    for (const u of allUnits) {
      if (u.hp <= 0) continue; // already dead this tick, cleaned up at end of step()
      if (u.loadedInto) continue; // aboard a transport — inert until it disembarks
      if (u.type === 'builder') continue; // builders never fight, movement handled by gather/manual orders
      if (u.order.type === 'gather') continue;
      if (u.attackTimer > 0) u.attackTimer = Math.max(0, u.attackTimer - dt);

      if (u.order.type === 'attackTarget') {
        const target = this.getEntityById(u.order.targetId);
        const targetDomain = target?.kind === 'unit' ? target.movementDomain : 'ground';
        if (!target || target.hp <= 0 || target.owner === u.owner || !u.targetDomains.includes(targetDomain)) {
          u.order = { type: 'idle' };
          continue;
        }
        if (distance(u.position, target.position) <= this.effectiveAttackRange(u)) {
          this.attackTick(u, target, dt);
        } else {
          u.position = this.moveUnitToward(u, target.position, this.effectiveUnitSpeed(u) * dt);
        }
        continue;
      }

      // Auto target acquisition
      const lockedEnemy = u.autoTargetId ? this.getEntityById(u.autoTargetId) : undefined;
      const lockedDomain = lockedEnemy?.kind === 'unit' ? lockedEnemy.movementDomain : 'ground';
      const validLock = lockedEnemy && lockedEnemy.hp > 0 && lockedEnemy.owner !== u.owner
        && u.targetDomains.includes(lockedDomain) && distance(u.position, lockedEnemy.position) <= u.sight * 1.35;
      const nearestEnemy = u.attack > 0 && u.order.type !== 'scout'
        ? (validLock ? lockedEnemy : this.getNearestAttackableEnemy(u))
        : undefined;
      u.autoTargetId = nearestEnemy?.id ?? null;
      const engageableOrder = u.order.type === 'attackMove' || u.order.type === 'defend' || u.order.type === 'idle';

      if (nearestEnemy && engageableOrder) {
        const d = distance(u.position, nearestEnemy.position);
        const leashPoint = u.order.type === 'defend' ? u.order.position : null;
        const withinLeash = leashPoint ? distance(u.position, leashPoint) < 260 : true;

        if (d <= this.effectiveAttackRange(u) && (u.order.type !== 'defend' || withinLeash)) {
          this.attackTick(u, nearestEnemy, dt);
          continue;
        }
        if (u.order.type === 'attackMove' && d <= u.sight) {
          u.position = this.moveUnitToward(u, nearestEnemy.position, this.effectiveUnitSpeed(u) * dt);
          continue;
        }
        if (u.order.type === 'defend' && withinLeash && d <= u.sight) {
          u.position = this.moveUnitToward(u, nearestEnemy.position, this.effectiveUnitSpeed(u) * dt);
          continue;
        }
        if (u.order.type === 'idle' && d <= this.effectiveAttackRange(u)) {
          this.attackTick(u, nearestEnemy, dt);
          continue;
        }
      }

      // Plain movement orders
      if (u.order.type === 'moveTo' || u.order.type === 'attackMove') {
        u.position = this.moveUnitToward(u, u.order.position, this.effectiveUnitSpeed(u) * dt);
      } else if (u.order.type === 'defend') {
        u.position = this.moveUnitToward(u, u.order.position, this.effectiveUnitSpeed(u) * dt);
      } else if (u.order.type === 'retreat') {
        const base = this.state.map.bases[u.owner];
        u.position = this.moveUnitToward(u, base, this.effectiveUnitSpeed(u) * dt);
        if (distance(u.position, base) <= DEPOSIT_ARRIVAL_RADIUS) {
          u.order = { type: 'idle' };
        }
      }

    }

    // Turrets and any other attack-capable buildings auto-engage.
    for (const b of this.state.buildings) {
      if (!b.attack || b.underConstruction || b.hp <= 0) continue;
      if (b.attackTimer && b.attackTimer > 0) {
        b.attackTimer = Math.max(0, b.attackTimer - dt);
      }
      const target = this.getNearestAttackableEnemy(b);
      if (target && b.attackRange && distance(b.position, target.position) <= b.attackRange) {
        this.attackTick(b, target, dt);
      }
    }
  }

  private attackTick(attacker: UnitState | BuildingState, target: Entity, _dt: number): void {
    if ((attacker.attackTimer ?? 0) > 0) return;
    const cooldown = attacker.attackCooldown ?? 1;
    attacker.attackTimer = cooldown;
    const projectileKind: ProjectileKind = attacker.kind === 'unit'
      ? RACES[attacker.race].units[attacker.raceUnitId]?.projectile ?? UNIT_STATS[attacker.type].projectileKind
      : RACES[attacker.race].buildings[attacker.raceBuildingId]?.projectile ?? 'shell';
    const isBallistic = BALLISTIC_PROJECTILES.has(projectileKind);
    this.state.projectiles.push({
      id: makeId('projectile'),
      kind: projectileKind,
      owner: attacker.owner,
      sourceId: attacker.id,
      position: { ...attacker.position },
      targetId: target.id,
      damage: attacker.kind === 'unit' ? this.effectiveAttackDamage(attacker) : attacker.attack ?? 0,
      damageTypes: attacker.damageTypes ?? ['normal'],
      speed: PROJECTILE_SPEED[projectileKind],
      remainingRange: attacker.kind === 'unit' ? this.effectiveAttackRange(attacker) : attacker.attackRange ?? 0,
      // Heavy ordnance is ballistic, not homing — it commits to the target's
      // position at fire time, so a target that moves can dodge the blast.
      impactPoint: isBallistic ? { ...target.position } : undefined,
      splashRadius: PROJECTILE_SPLASH_RADIUS[projectileKind],
    });
  }

  /** Every live unit and building regardless of owner — used by ballistic
   * splash damage, which can hit anyone (the firer's own side is
   * excluded by the owner check at the call site, not here). */
  private allLiveEntities(): Entity[] {
    return [...this.state.units, ...this.state.buildings].filter((e) => e.hp > 0);
  }

  /** Splits `amount` evenly across `types` and applies each share's own
   * attack-vs-armor multiplier against `armorType` (see DAMAGE_MULTIPLIER)
   * — almost always one type, so almost always just `amount * multiplier`,
   * but a mixed-type attack (e.g. part-piercing, part-explosive) gets each
   * portion weighed correctly instead of picking one type to represent the
   * whole hit. */
  private applyDamageMultiplier(amount: number, types: DamageType[], armorType: ArmorType): number {
    if (types.length === 0) return amount;
    const share = amount / types.length;
    return types.reduce((total, type) => total + share * DAMAGE_MULTIPLIER[type][armorType], 0);
  }

  private dealDamage(target: Entity, projectile: ProjectileState): void {
    let damage = this.applyDamageMultiplier(projectile.damage, projectile.damageTypes, target.armorType);
    if (target.kind === 'unit') {
      const fortify = this.activeSkillDefinition(target, 'fortify');
      if (fortify) damage *= Math.max(0.1, 1 - fortify.magnitude);
    }
    target.hp -= damage;
    if (target.kind === 'building') target.lastDamagedAt = this.state.time;
  }

  private explodeBallisticProjectile(projectile: ProjectileState): void {
    const impact = projectile.impactPoint;
    if (!impact) return;
    const radius = projectile.splashRadius ?? 0;
    for (const entity of this.allLiveEntities()) {
      if (entity.owner === projectile.owner) continue;
      if (entity.kind === 'unit' && entity.movementDomain === 'air') continue;
      if (entity.kind === 'building' && !this.isBuildingVisibleTo(projectile.owner, entity)) continue;
      if (distance(entity.position, impact) > radius) continue;
      this.dealDamage(entity, projectile);
    }
  }

  private stepProjectiles(dt: number): void {
    const active: ProjectileState[] = [];

    for (const projectile of this.state.projectiles) {
      if (projectile.impactPoint) {
        const distToImpact = distance(projectile.position, projectile.impactPoint);
        const travel = Math.min(projectile.speed * dt, projectile.remainingRange);
        if (distToImpact <= travel || projectile.remainingRange <= travel) {
          this.explodeBallisticProjectile(projectile);
          continue;
        }
        projectile.position = moveToward(projectile.position, projectile.impactPoint, travel);
        projectile.remainingRange -= travel;
        if (projectile.remainingRange > 0) active.push(projectile);
        continue;
      }

      const target = this.getEntityById(projectile.targetId);
      if (!target || target.hp <= 0 || target.owner === projectile.owner) continue;

      const targetRadius = target.kind === 'building' ? 12 : 6;
      const targetDistance = distance(projectile.position, target.position);
      const travel = Math.min(projectile.speed * dt, projectile.remainingRange);

      if (targetDistance <= travel + targetRadius) {
        this.dealDamage(target, projectile);
        continue;
      }

      if (travel <= 0) continue;
      projectile.position = moveToward(projectile.position, target.position, travel);
      projectile.remainingRange -= travel;
      if (projectile.remainingRange > 0) active.push(projectile);
    }

    this.state.projectiles = active;
  }

  private stepScouting(dt: number): void {
    for (const u of this.state.units) {
      if (u.loadedInto || u.order.type !== 'scout') continue;
      if (!u.scoutWaypoint) {
        u.scoutWaypoint = this.randomWaypointFor(u);
      }
      u.position = this.moveUnitToward(u, u.scoutWaypoint, this.effectiveUnitSpeed(u) * dt);
      // A waypoint across a channel a ground scout can't actually cross (or
      // any other genuinely unreachable pick) used to leave the scout stuck
      // motionless at the water's edge forever, since nothing ever picked a
      // new waypoint until it got "close enough" — which it never did. Same
      // exhausted-path recovery as stepGathering/stepBuilding, just rerolling
      // immediately instead of going idle: a scout with nowhere useful to go
      // should try somewhere else, not stop.
      if (distance(u.position, u.scoutWaypoint) < 20 || this.isPathExhausted(u.id, u.position, u.scoutWaypoint)) {
        u.scoutWaypoint = this.randomWaypointFor(u);
        this.movementPaths.delete(u.id);
      }
    }
  }

  /** Picks a handful of candidate waypoints and prefers whichever one lands
   * in an exploration cell `unit`'s owner hasn't seen yet (see
   * updateExploration/exploredMapRatio) — a plain uniform-random pick tends
   * to keep re-sampling the same nearby reachable strip on a mostly-water or
   * choke-pointed map (nearestTerrainPosition collapses many random points
   * onto whatever land/water is closest to them), which reads as scouts
   * wandering aimlessly near home instead of actually sweeping the map. Once
   * everything nearby is already explored, all candidates tie and it falls
   * back to picking among them like before. */
  private randomWaypointFor(unit: UnitState): Vector2 {
    const CANDIDATES = 6;
    const known = this.exploredCells[unit.owner];
    let best: Vector2 | null = null;
    let bestIsUnexplored = false;
    let bestDistance = Infinity;
    for (let i = 0; i < CANDIDATES; i += 1) {
      const random = randomInRect(this.state.map.width, this.state.map.height);
      const candidate = unit.movementDomain === 'air' ? random : this.nearestTerrainPosition(random, unit.movementDomain === 'sea');
      const unexplored = !known.has(this.explorationCellKey(candidate));
      const d = distance(unit.position, candidate);
      // An unexplored candidate always wins over an explored one; among two
      // candidates that agree on that, prefer the closer one so scouts sweep
      // outward instead of ping-ponging across the whole map every pick.
      if (best === null || (unexplored && !bestIsUnexplored) || (unexplored === bestIsUnexplored && d < bestDistance)) {
        best = candidate;
        bestIsUnexplored = unexplored;
        bestDistance = d;
      }
    }
    return best!;
  }

  private removeDead(): void {
    // A destroyed transport takes its cargo down with it — a loaded unit is
    // otherwise untouched by combat (see stepCombat/stepMovement skipping
    // loadedInto units), so without this it would survive as an orphaned
    // passenger of a transport id that no longer exists.
    const sunkCargo = new Set<string>();
    for (const u of this.state.units) {
      if (u.hp <= 0) for (const cargoId of u.cargo) sunkCargo.add(cargoId);
    }
    for (const u of this.state.units) {
      if (sunkCargo.has(u.id)) u.hp = 0;
    }
    for (const u of this.state.units) {
      if (u.hp <= 0) this.state.stats[u.owner].unitsLost += 1;
    }
    this.state.units = this.state.units.filter((u) => u.hp > 0);
    this.state.buildings = this.state.buildings.filter((b) => b.hp > 0);
    const living = new Set(this.state.units.map((unit) => unit.id));
    for (const unitId of this.movementPaths.keys()) {
      if (!living.has(unitId)) this.movementPaths.delete(unitId);
    }
  }

  private updateDetection(): void {
    for (const owner of this.state.activePlayers) {
      const mine = this.allEntities(owner);
      const theirs = this.enemyEntities(owner);
      let detected = false;
      outer: for (const m of mine) {
        const sight = m.kind === 'unit' ? m.sight : BUILDING_SIGHT;
        for (const t of theirs) {
          if (distance(m.position, t.position) <= sight) {
            detected = true;
            break outer;
          }
        }
      }
      this.detectionCache[owner] = detected;
    }
  }

  private checkWinCondition(): void {
    if (this.state.matchResult) return;
    // StarCraft-style elimination: losing the command center is a severe
    // economic setback, but a player remains alive while any structure is
    // still standing. Units alone cannot prevent elimination.
    const survivors = this.state.activePlayers.filter((owner) => this.getBuildings(owner).length > 0);
    if (survivors.length > 1) return;
    this.state.matchResult = survivors.length === 1
      ? { winner: survivors[0], reason: `${survivors[0]} is the last command network standing` }
      : { winner: null, reason: 'Every command network was destroyed' };
  }
}
