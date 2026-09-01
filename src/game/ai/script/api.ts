import {
  BUILDING_TYPE_LIST,
  RESEARCH_TYPE_LIST,
  type BuildingState,
  type BuildingType,
  type PlayerId,
  type RaceId,
  type ResearchType,
  type ResourceNodeState,
  type UnitState,
  type UnitType,
  type Vector2,
} from '../../../types/game';
import type { ActionType } from '../../../types/rules';
import type { Simulation } from '../../simulation/Simulation';
import { distance } from '../../../utils/math';
import { ACTION_LOG_LABEL } from '../ruleMeta';
import type { HostFn, Value } from './interpreter';
import { RACES, resolveRaceBuildingArchetype, resolveRaceUnitArchetype } from '../../races';
import { TILE_SIZE } from '../../constants';
import { loadMatchHistory, summarizeMatchHistory } from '../matchMemory';

// Everything constructible except the Command Center, which the map starts
// you with and isn't something you build again — a hand-picked subset of
// BUILDING_TYPE_LIST rather than derived, since "constructible" is a design
// choice, not inherent to a building existing.
const CONSTRUCTIBLE_BUILDING_TYPES: BuildingType[] = BUILDING_TYPE_LIST.filter((t) => t !== 'commandCenter');

function requireNumber(v: Value, argName: string): number {
  if (typeof v !== 'number') {
    throw new Error(`Expected a number for ${argName}, got ${typeof v} (${JSON.stringify(v)})`);
  }
  return v;
}

function requireString(v: Value, argName: string): string {
  if (typeof v !== 'string') {
    throw new Error(`Expected a string for ${argName}, got ${typeof v} (${JSON.stringify(v)})`);
  }
  return v;
}

function requireIdList(v: Value, argName = 'id list'): string[] {
  if (!Array.isArray(v)) throw new Error(`Expected a list for ${argName}, got ${typeof v} (${JSON.stringify(v)})`);
  return v.map((id, index) => requireString(id, `${argName}[${index}]`));
}

function requireUnitType(v: Value, race: RaceId): UnitType {
  const s = requireString(v, 'unit type');
  const type = resolveRaceUnitArchetype(race, s);
  if (!type) throw new Error(`Unknown ${RACES[race].name} unit "${s}" — use a roster id, name, class, or archetype.`);
  return type;
}

function requireBuildingType(v: Value, race: RaceId): BuildingType {
  const s = requireString(v, 'building type');
  const type = resolveRaceBuildingArchetype(race, s);
  if (!type) throw new Error(`Unknown ${RACES[race].name} building "${s}" — use a roster id, name, class, or archetype.`);
  return type;
}

function requireConstructibleBuildingIdentity(v: Value, race: RaceId): string {
  const identity = requireString(v, 'building type');
  const t = requireBuildingType(v, race);
  if (!CONSTRUCTIBLE_BUILDING_TYPES.includes(t)) {
    throw new Error(`"${t}" can't be constructed — expected one of: ${CONSTRUCTIBLE_BUILDING_TYPES.join(', ')}`);
  }
  return identity;
}

function requireResearchType(v: Value): ResearchType {
  const s = requireString(v, 'research type');
  if (!(RESEARCH_TYPE_LIST as readonly string[]).includes(s)) {
    throw new Error(`Unknown research type "${s}" — expected one of: ${RESEARCH_TYPE_LIST.join(', ')}`);
  }
  return s as ResearchType;
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export interface ScriptApiOptions {
  sim: Simulation;
  owner: PlayerId;
  /** Optional scheduler hook for hosts that intentionally want action
   * pacing. The competitive ScriptEngine does not throttle actions: the
   * simulation's costs, queues, build times, and game cooldowns are the
   * authoritative limits. */
  runAction?: (key: string, run: () => boolean) => boolean;
  /** Called with the gerund-style label whenever an action call actually fires. */
  onAction: (label: string) => void;
  /** Called with the message whenever the script calls log(...). */
  onLog: (message: string) => void;
}

/**
 * Builds the fixed table of functions a script may call. This is the entire
 * surface a script can reach — the same safe, typed vocabulary the visual
 * rule builder's conditions/actions use (see conditions.ts / actions.ts),
 * just exposed as callable functions instead of a JSON rule shape. No path
 * from a script ever reaches anything outside this table.
 */
export function buildScriptApi(opts: ScriptApiOptions): Record<string, HostFn> {
  const { sim, owner, runAction = (_key, run) => run(), onAction, onLog } = opts;
  const race = sim.state.players[owner].race;

  // One API table is built for one script pass. Keep that pass's read-heavy
  // queries indexed: user scripts commonly loop over the same units/nodes and
  // then call several per-entity getters, which used to rescan state each time.
  let ownUnitsCache: UnitState[] | undefined;
  let ownBuildingsCache: BuildingState[] | undefined;
  let visibleEnemyUnitsCache: UnitState[] | undefined;
  let visibleEnemyBuildingsCache: BuildingState[] | undefined;
  let unitByIdCache: Map<string, UnitState> | undefined;
  let buildingByIdCache: Map<string, BuildingState> | undefined;
  let knownNodesCache: ResourceNodeState[] | undefined;
  let knownNodeIdsCache: Set<string> | undefined;
  let knownEnemyBuildingsCache: ReturnType<Simulation['getKnownEnemyBuildings']> | undefined;
  let matchHistorySummaryCache: ReturnType<typeof summarizeMatchHistory> | undefined;
  const nodeById = new Map(sim.state.map.resourceNodes.map((node) => [node.id, node]));

  const ownUnits = () => (ownUnitsCache ??= sim.getUnits(owner));
  const ownBuildings = () => (ownBuildingsCache ??= sim.getBuildings(owner));
  // Cross-match memory — persisted in the browser (see matchMemory.ts), keyed
  // by race the same way saved strategies are. Read fresh from storage once
  // per script pass rather than held across passes, so a match that just
  // finished shows up in the very next one.
  const matchHistory = () => (matchHistorySummaryCache ??= summarizeMatchHistory(loadMatchHistory(race)));

  function knownNodes(): ResourceNodeState[] {
    if (!knownNodesCache) {
      knownNodesCache = sim.state.map.resourceNodes.filter((node) => sim.isResourceNodeDiscovered(owner, node.id));
      knownNodeIdsCache = new Set(knownNodesCache.map((node) => node.id));
    }
    return knownNodesCache;
  }

  function invalidateEntityCaches(): void {
    ownUnitsCache = undefined;
    ownBuildingsCache = undefined;
    visibleEnemyUnitsCache = undefined;
    visibleEnemyBuildingsCache = undefined;
    unitByIdCache = undefined;
    buildingByIdCache = undefined;
  }

  function findUnitById(id: string) {
    unitByIdCache ??= new Map(sim.state.units.map((unit) => [unit.id, unit]));
    const unit = unitByIdCache.get(id);
    return unit && (unit.owner === owner || sim.isPositionVisibleTo(owner, unit.position)) ? unit : undefined;
  }

  function findBuildingById(id: string) {
    buildingByIdCache ??= new Map(sim.state.buildings.map((building) => [building.id, building]));
    const building = buildingByIdCache.get(id);
    return building && sim.isBuildingVisibleTo(owner, building) ? building : undefined;
  }

  function findNodeById(id: string) {
    return nodeById.get(id);
  }

  function knownEnemyBuildings() {
    return (knownEnemyBuildingsCache ??= sim.getKnownEnemyBuildings(owner));
  }

  function findKnownEnemyBuildingById(id: string) {
    return knownEnemyBuildings().find((building) => building.id === id);
  }

  function findKnownNodeById(id: string) {
    knownNodes();
    return knownNodeIdsCache?.has(id) ? findNodeById(id) : undefined;
  }

  function action(type: ActionType, run: () => boolean, labelOverride?: string): boolean {
    const ok = runAction(type, run);
    if (ok) {
      invalidateEntityCaches();
      onAction(labelOverride ?? ACTION_LOG_LABEL[type]);
    }
    return ok;
  }

  /** Same as action(), but for the type-parameterized commands below
   * (train/construct) — the roster of unit/building types is expected to
   * grow, so their log label is derived from the type name itself instead
   * of a fixed lookup table that would need a new entry per new type. */
  function genericAction(key: string, run: () => boolean, label: string): boolean {
    const ok = runAction(key, run);
    if (ok) {
      invalidateEntityCaches();
      onAction(label);
    }
    return ok;
  }

  function visibleEnemyUnits() {
    return (visibleEnemyUnitsCache ??= sim.opponentPlayers(owner).flatMap((opponent) => sim.getUnits(opponent))
      .filter((unit) => sim.isPositionVisibleTo(owner, unit.position)));
  }

  function visibleEnemyBuildings() {
    return (visibleEnemyBuildingsCache ??= sim.opponentPlayers(owner).flatMap((opponent) => sim.getBuildings(opponent))
      .filter((building) => sim.isBuildingVisibleTo(owner, building)));
  }

  // Only resolves to the real enemy base once it's actually been scouted
  // (see Simulation.isEnemyBaseDiscovered) — falls back to your own base so
  // a script that hasn't found the enemy yet gets a harmless, known point
  // rather than a free answer.
  const primaryEnemyBase = () => {
    const opponent = sim.primaryOpponent(owner);
    if (opponent && sim.isEnemyBaseDiscovered(owner, opponent)) return sim.state.map.bases[opponent];
    return sim.state.map.bases[owner];
  };

  function ownUnitsInList(value: Value) {
    const ids = new Set(requireIdList(value));
    return ownUnits().filter((unit) => ids.has(unit.id));
  }

  function nearestUnit(units: UnitState[], point: Vector2): UnitState | undefined {
    let nearest: UnitState | undefined;
    let nearestDistance = Infinity;
    for (const unit of units) {
      const unitDistance = distance(unit.position, point);
      if (unitDistance < nearestDistance) {
        nearest = unit;
        nearestDistance = unitDistance;
      }
    }
    return nearest;
  }

  return {
    // --- queries: numbers ---
    resources: () => sim.getResources(owner),
    gameTime: () => sim.getGameTime(),
    unitCount: (type: Value) => {
      const wanted = requireUnitType(type, race);
      return ownUnits().filter((unit) => unit.type === wanted).length;
    },
    units: () => ownUnits().length,
    armyStrength: () => sim.getArmyStrength(owner),
    buildingCount: (type: Value) => {
      const wanted = requireBuildingType(type, race);
      return ownBuildings().filter((building) => building.type === wanted).length;
    },
    resourcesGathered: () => sim.state.stats[owner].resourcesGathered,
    unitsCreated: () => sim.state.stats[owner].unitsCreated,
    unitsLost: () => sim.state.stats[owner].unitsLost,
    buildingsConstructed: () => sim.state.stats[owner].buildingsConstructed,
    mapWidth: () => sim.state.map.width,
    mapHeight: () => sim.state.map.height,

    // --- queries: booleans ---
    enemyDetected: () => sim.isEnemyDetected(owner),
    commandCenterUnderAttack: () => sim.isCommandCenterUnderAttack(owner),
    hasBuilding: (type: Value) => {
      const wanted = requireBuildingType(type, race);
      return ownBuildings().some((building) => building.type === wanted);
    },
    hasResearch: (type: Value) => sim.state.players[owner].completedResearch.includes(requireResearchType(type)),
    buildingNear: (type: Value, x: Value, y: Value, radius: Value) => {
      const point = { x: requireNumber(x, 'x'), y: requireNumber(y, 'y') };
      const r = requireNumber(radius, 'radius');
      const wanted = requireBuildingType(type, race);
      return ownBuildings().some((building) => building.type === wanted && distance(building.position, point) <= r);
    },
    isWaterAt: (x: Value, y: Value) => {
      const col = Math.max(0, Math.min(sim.state.map.terrainCols - 1, Math.floor(requireNumber(x, 'x') / TILE_SIZE)));
      const row = Math.max(0, Math.min(sim.state.map.terrainRows - 1, Math.floor(requireNumber(y, 'y') / TILE_SIZE)));
      return sim.state.map.terrain[row * sim.state.map.terrainCols + col] === 'water';
    },
    // True once a scout has actually laid eyes on the (primary) enemy's
    // Command Center — before that, enemyBaseX()/enemyBaseY() harmlessly
    // fall back to your own base rather than handing you a free answer, so
    // check this first if you need to tell "found it" apart from "haven't yet".
    enemyBaseFound: () => {
      const opponent = sim.primaryOpponent(owner);
      return opponent !== undefined && sim.isEnemyBaseDiscovered(owner, opponent);
    },
    // 0..1 — how much of the map this player has ever laid eyes on. Useful
    // for deciding whether to keep investing in scouting, e.g.
    // `if (mapExploredRatio() < 0.5) { ... }`.
    mapExploredRatio: () => sim.exploredMapRatio(owner),

    // --- queries: positions (numbers — no vector/object type, so x and y
    // are separate calls; combine with ordinary arithmetic, e.g.
    // constructAt("turret", baseX() + 100, baseY())) ---
    baseX: () => sim.state.map.bases[owner].x,
    baseY: () => sim.state.map.bases[owner].y,
    enemyBaseX: () => primaryEnemyBase().x,
    enemyBaseY: () => primaryEnemyBase().y,
    nearestEnemyX: () => (sim.getNearestVisibleEnemyEntity(owner, sim.state.map.bases[owner]) ?? { position: sim.state.map.bases[owner] }).position.x,
    nearestEnemyY: () => (sim.getNearestVisibleEnemyEntity(owner, sim.state.map.bases[owner]) ?? { position: sim.state.map.bases[owner] }).position.y,
    isValidBuildSpot: (x: Value, y: Value) => sim.isValidBuildPosition({ x: requireNumber(x, 'x'), y: requireNumber(y, 'y') }),

    // --- unit groups: these return a list of unit ids (Value[] of strings)
    // for a "for (id in ...) { ... }" loop to walk over. Combine with the
    // per-unit functions below to read/command individual units. ---
    myUnits: () => ownUnits().map((u) => u.id),
    myUnitsOfType: (type: Value) => {
      const wanted = requireUnitType(type, race);
      return ownUnits().filter((unit) => unit.type === wanted).map((unit) => unit.id);
    },
    myUnitsOfTypes: (...types: Value[]) => {
      const wanted = new Set(types.map((type) => requireUnitType(type, race)));
      return ownUnits().filter((unit) => wanted.has(unit.type)).map((unit) => unit.id);
    },
    combatUnits: () => ownUnits().filter((unit) => unit.type !== 'builder' && unit.attack > 0).map((unit) => unit.id),
    damagedUnits: (healthRatio: Value) => {
      const threshold = requireNumber(healthRatio, 'health ratio');
      return ownUnits().filter((unit) => unit.hp / Math.max(1, unit.maxHp) < threshold).map((unit) => unit.id);
    },
    unitsWithOrder: (order: Value) => {
      const wanted = requireString(order, 'order');
      return ownUnits().filter((unit) => unit.order.type === wanted).map((unit) => unit.id);
    },
    idleUnits: () =>
      ownUnits()
        .filter((u) => u.order.type === 'idle')
        .map((u) => u.id),
    unitsNear: (x: Value, y: Value, radius: Value) => {
      const point = { x: requireNumber(x, 'x'), y: requireNumber(y, 'y') };
      const r = requireNumber(radius, 'radius');
      return ownUnits()
        .filter((u) => distance(u.position, point) <= r)
        .map((u) => u.id);
    },
    enemyUnitsNear: (x: Value, y: Value, radius: Value) => {
      const point = { x: requireNumber(x, 'x'), y: requireNumber(y, 'y') };
      const r = requireNumber(radius, 'radius');
      return visibleEnemyUnits()
        .filter((u) => distance(u.position, point) <= r)
        .map((u) => u.id);
    },
    visibleEnemyUnits: () => visibleEnemyUnits().map((unit) => unit.id),
    visibleEnemyBuildings: () => visibleEnemyBuildings().map((building) => building.id),
    enemyBuildingsNear: (x: Value, y: Value, radius: Value) => {
      const point = { x: requireNumber(x, 'x'), y: requireNumber(y, 'y') };
      const r = requireNumber(radius, 'radius');
      return visibleEnemyBuildings().filter((building) => distance(building.position, point) <= r).map((building) => building.id);
    },
    // --- remembered enemy structures: unlike visibleEnemyBuildings() above
    // (current sight only), these stay known after you look away — same as
    // real RTS fog-of-war "last seen" markers. A remembered spot isn't
    // guaranteed to still hold that building (it may have been destroyed
    // while you weren't looking); it self-corrects the next time you look at
    // that spot again. Use knownEnemyBuildingX/Y/Type/Class(id) below to read
    // one, same id shape as visibleEnemyBuildings(). ---
    knownEnemyBuildings: () => knownEnemyBuildings().map((building) => building.id),
    knownEnemyBuildingX: (id: Value) => findKnownEnemyBuildingById(requireString(id, 'building id'))?.position.x ?? 0,
    knownEnemyBuildingY: (id: Value) => findKnownEnemyBuildingById(requireString(id, 'building id'))?.position.y ?? 0,
    knownEnemyBuildingType: (id: Value) => findKnownEnemyBuildingById(requireString(id, 'building id'))?.raceBuildingId ?? '',
    knownEnemyBuildingClass: (id: Value) => {
      const known = findKnownEnemyBuildingById(requireString(id, 'building id'));
      if (!known) return '';
      const enemyRace = sim.state.players[known.owner].race;
      return RACES[enemyRace].buildings[known.raceBuildingId]?.class ?? known.buildingType;
    },
    // Seconds since this memory was last refreshed — 0 if it's currently visible.
    knownEnemyBuildingAge: (id: Value) => {
      const known = findKnownEnemyBuildingById(requireString(id, 'building id'));
      return known ? Math.max(0, sim.getGameTime() - known.lastSeenTime) : 0;
    },
    // --- building groups: same shape as the unit-group queries above, so a
    // script can look for its own buildings the same way it looks for units
    // (e.g. checking whether it already has an Outpost near a resource node). ---
    myBuildings: () => ownBuildings().map((b) => b.id),
    myBuildingsOfType: (type: Value) => {
      const wanted = requireBuildingType(type, race);
      return ownBuildings().filter((building) => building.type === wanted).map((building) => building.id);
    },
    myBuildingsNear: (x: Value, y: Value, radius: Value) => {
      const point = { x: requireNumber(x, 'x'), y: requireNumber(y, 'y') };
      const r = requireNumber(radius, 'radius');
      return ownBuildings()
        .filter((b) => distance(b.position, point) <= r)
        .map((b) => b.id);
    },
    // --- resource-node groups: like enemy units, a node only shows up once
    // you've actually scouted it — see Simulation.isResourceNodeDiscovered.
    // Once you have an id (from this query), nodeX/Y/Remaining/Exists work
    // on it same as unitX/Y do for a unit id. ---
    resourceNodesNear: (x: Value, y: Value, radius: Value) => {
      const point = { x: requireNumber(x, 'x'), y: requireNumber(y, 'y') };
      const r = requireNumber(radius, 'radius');
      return knownNodes()
        .filter((n) => distance(n.position, point) <= r)
        .map((n) => n.id);
    },
    knownResourceNodes: () => knownNodes().map((n) => n.id),
    nearestKnownNode: (x: Value, y: Value) => {
      const point = { x: requireNumber(x, 'x'), y: requireNumber(y, 'y') };
      let nearest: ResourceNodeState | undefined;
      let nearestDistance = Infinity;
      for (const node of knownNodes()) {
        if (node.remaining <= 0) continue;
        const nodeDistance = distance(node.position, point);
        if (nodeDistance < nearestDistance) {
          nearest = node;
          nearestDistance = nodeDistance;
        }
      }
      return nearest?.id ?? '';
    },
    richestKnownNode: () => knownNodes().reduce<ResourceNodeState | undefined>(
      (richest, node) => node.remaining > 0 && (!richest || node.remaining > richest.remaining) ? node : richest,
      undefined,
    )?.id ?? '',
    count: (list: Value) => (Array.isArray(list) ? list.length : 0),
    totalAttack: (list: Value) => ownUnitsInList(list).reduce((sum, unit) => sum + unit.attack, 0),
    totalHealth: (list: Value) => ownUnitsInList(list).reduce((sum, unit) => sum + unit.hp, 0),
    closestUnitTo: (list: Value, x: Value, y: Value) => {
      const point = { x: requireNumber(x, 'x'), y: requireNumber(y, 'y') };
      const closest = nearestUnit(ownUnitsInList(list), point);
      return closest?.id ?? '';
    },
    weakestUnit: (list: Value) => {
      const weakest = ownUnitsInList(list).sort((a, b) => a.hp / Math.max(1, a.maxHp) - b.hp / Math.max(1, b.maxHp))[0];
      return weakest?.id ?? '';
    },
    nearestEnemyUnitTo: (x: Value, y: Value, radius: Value) => {
      const point = { x: requireNumber(x, 'x'), y: requireNumber(y, 'y') };
      const r = requireNumber(radius, 'radius');
      const nearest = nearestUnit(visibleEnemyUnits().filter((unit) => distance(unit.position, point) <= r), point);
      return nearest?.id ?? '';
    },

    // --- per-node info: read-only, works for any node id from resourceNodesNear ---
    nodeX: (id: Value) => findKnownNodeById(requireString(id, 'node id'))?.position.x ?? 0,
    nodeY: (id: Value) => findKnownNodeById(requireString(id, 'node id'))?.position.y ?? 0,
    nodeRemaining: (id: Value) => findKnownNodeById(requireString(id, 'node id'))?.remaining ?? 0,
    nodeExists: (id: Value) => findKnownNodeById(requireString(id, 'node id')) !== undefined,
    nodeCovered: (id: Value) => sim.isResourceNodeDiscovered(owner, requireString(id, 'node id')) && sim.isResourceNodeCovered(owner, requireString(id, 'node id')),
    minersAtNode: (id: Value) => sim.isResourceNodeDiscovered(owner, requireString(id, 'node id'))
      ? sim.minersAtResourceNode(owner, requireString(id, 'node id'))
      : 0,

    // --- per-building info: read-only, works for any building id from myBuildings*() ---
    buildingX: (id: Value) => findBuildingById(requireString(id, 'building id'))?.position.x ?? 0,
    buildingY: (id: Value) => findBuildingById(requireString(id, 'building id'))?.position.y ?? 0,
    buildingType: (id: Value) => findBuildingById(requireString(id, 'building id'))?.raceBuildingId ?? '',
    buildingClass: (id: Value) => {
      const building = findBuildingById(requireString(id, 'building id'));
      return building ? RACES[building.race].buildings[building.raceBuildingId]?.class ?? building.type : '';
    },
    buildingExists: (id: Value) => findBuildingById(requireString(id, 'building id')) !== undefined,
    buildingHp: (id: Value) => findBuildingById(requireString(id, 'building id'))?.hp ?? 0,
    buildingMaxHp: (id: Value) => findBuildingById(requireString(id, 'building id'))?.maxHp ?? 0,
    buildingProgress: (id: Value) => findBuildingById(requireString(id, 'building id'))?.constructionProgress ?? 0,
    buildingUnderConstruction: (id: Value) => findBuildingById(requireString(id, 'building id'))?.underConstruction ?? false,
    buildingHealthRatio: (id: Value) => {
      const building = findBuildingById(requireString(id, 'building id'));
      return building ? building.hp / Math.max(1, building.maxHp) : 0;
    },
    buildingQueueLength: (id: Value) => findBuildingById(requireString(id, 'building id'))?.productionQueue.length ?? 0,
    buildingProductionProgress: (id: Value) => findBuildingById(requireString(id, 'building id'))?.productionQueue[0]?.progress ?? 0,
    buildingResearchProgress: (id: Value) => findBuildingById(requireString(id, 'building id'))?.researchQueue[0]?.progress ?? 0,

    // --- per-unit info: read-only, works for any unit id you've legitimately
    // learned from a query above (including a scouted enemy's) ---
    unitX: (id: Value) => findUnitById(requireString(id, 'unit id'))?.position.x ?? 0,
    unitY: (id: Value) => findUnitById(requireString(id, 'unit id'))?.position.y ?? 0,
    unitHp: (id: Value) => findUnitById(requireString(id, 'unit id'))?.hp ?? 0,
    unitMaxHp: (id: Value) => findUnitById(requireString(id, 'unit id'))?.maxHp ?? 0,
    unitType: (id: Value) => findUnitById(requireString(id, 'unit id'))?.raceUnitId ?? '',
    unitClass: (id: Value) => {
      const unit = findUnitById(requireString(id, 'unit id'));
      return unit ? RACES[unit.race].units[unit.raceUnitId]?.class ?? unit.type : '';
    },
    unitExists: (id: Value) => findUnitById(requireString(id, 'unit id')) !== undefined,
    unitAttack: (id: Value) => findUnitById(requireString(id, 'unit id'))?.attack ?? 0,
    unitAttackRange: (id: Value) => findUnitById(requireString(id, 'unit id'))?.attackRange ?? 0,
    unitSpeed: (id: Value) => findUnitById(requireString(id, 'unit id'))?.speed ?? 0,
    unitSight: (id: Value) => findUnitById(requireString(id, 'unit id'))?.sight ?? 0,
    unitCargo: (id: Value) => findUnitById(requireString(id, 'unit id'))?.carriedResources ?? 0,
    unitHealthRatio: (id: Value) => {
      const unit = findUnitById(requireString(id, 'unit id'));
      return unit ? unit.hp / Math.max(1, unit.maxHp) : 0;
    },
    unitOrder: (id: Value) => findUnitById(requireString(id, 'unit id'))?.order.type ?? '',
    unitDomain: (id: Value) => findUnitById(requireString(id, 'unit id'))?.movementDomain ?? '',
    unitIsIdle: (id: Value) => findUnitById(requireString(id, 'unit id'))?.order.type === 'idle',
    unitIsGathering: (id: Value) => findUnitById(requireString(id, 'unit id'))?.order.type === 'gather',
    unitIsAboard: (id: Value) => !!findUnitById(requireString(id, 'unit id'))?.loadedInto,
    unitsAboard: (transportId: Value) => sim.getCargoIds(requireString(transportId, 'transport id')),
    cargoLoad: (transportId: Value) => sim.getCargoLoad(requireString(transportId, 'transport id')),
    cargoCapacity: (transportId: Value) => sim.getTransportCapacity(requireString(transportId, 'transport id')),
    unitSkills: (id: Value) => findUnitById(requireString(id, 'unit id'))?.skills.map((skill) => skill.id) ?? [],
    unitSkillReady: (id: Value, skillId: Value) => {
      const unit = findUnitById(requireString(id, 'unit id'));
      const wanted = requireString(skillId, 'skill id');
      return unit?.skills.some((skill) => skill.id === wanted && skill.cooldownRemaining <= 0) ?? false;
    },
    unitSkillCooldown: (id: Value, skillId: Value) => {
      const unit = findUnitById(requireString(id, 'unit id'));
      const wanted = requireString(skillId, 'skill id');
      return unit?.skills.find((skill) => skill.id === wanted)?.cooldownRemaining ?? 0;
    },

    // --- generic geometry: for range/distance checks against positions
    // returned by the queries above (baseX()/baseY(), unitX()/unitY(), etc.) ---
    distanceBetween: (x1: Value, y1: Value, x2: Value, y2: Value) =>
      distance(
        { x: requireNumber(x1, 'x1'), y: requireNumber(y1, 'y1') },
        { x: requireNumber(x2, 'x2'), y: requireNumber(y2, 'y2') },
      ),
    inRange: (x1: Value, y1: Value, x2: Value, y2: Value, radius: Value) =>
      distance(
        { x: requireNumber(x1, 'x1'), y: requireNumber(y1, 'y1') },
        { x: requireNumber(x2, 'x2'), y: requireNumber(y2, 'y2') },
      ) <= requireNumber(radius, 'radius'),
    min: (a: Value, b: Value) => Math.min(requireNumber(a, 'a'), requireNumber(b, 'b')),
    max: (a: Value, b: Value) => Math.max(requireNumber(a, 'a'), requireNumber(b, 'b')),
    abs: (value: Value) => Math.abs(requireNumber(value, 'value')),
    floor: (value: Value) => Math.floor(requireNumber(value, 'value')),
    ceil: (value: Value) => Math.ceil(requireNumber(value, 'value')),
    clamp: (value: Value, low: Value, high: Value) => Math.max(
      requireNumber(low, 'low'),
      Math.min(requireNumber(high, 'high'), requireNumber(value, 'value')),
    ),

    // --- per-unit commands: only ever affect a unit you own (checked inside
    // Simulation), so a scouted enemy id can be inspected but never commanded.
    // Not run through the action() wrapper — commanding many individual units
    // in one tick would otherwise flood the activity log. ---
    moveUnitTo: (id: Value, x: Value, y: Value) =>
      sim.orderUnitMoveTo(owner, requireString(id, 'unit id'), { x: requireNumber(x, 'x'), y: requireNumber(y, 'y') }),
    attackUnitTo: (id: Value, x: Value, y: Value) =>
      sim.orderUnitAttackMoveTo(owner, requireString(id, 'unit id'), { x: requireNumber(x, 'x'), y: requireNumber(y, 'y') }),
    gatherUnitAt: (id: Value, nodeId: Value) =>
      sim.orderUnitGather(owner, requireString(id, 'unit id'), requireString(nodeId, 'node id')),
    stopUnit: (id: Value) => sim.orderUnitStop(owner, requireString(id, 'unit id')),
    attackUnit: (id: Value, targetId: Value) =>
      sim.orderUnitAttackTarget(owner, requireString(id, 'unit id'), requireString(targetId, 'target id')),
    useUnitSkill: (id: Value, skillId: Value) =>
      sim.useUnitSkill(owner, requireString(id, 'unit id'), requireString(skillId, 'skill id')),
    defendUnitAt: (id: Value, x: Value, y: Value) =>
      sim.orderUnitDefendAt(owner, requireString(id, 'unit id'), { x: requireNumber(x, 'x'), y: requireNumber(y, 'y') }),
    retreatUnit: (id: Value) => sim.orderUnitRetreat(owner, requireString(id, 'unit id')),
    // Unlike scoutMap() (which only ever grabs a dedicated Scout, or one
    // idle unit if you have none), this sends any specific owned unit out
    // scouting — e.g. a spare combat unit while coverage is still low.
    scoutUnit: (id: Value) => sim.orderUnitScout(owner, requireString(id, 'unit id')),
    // --- cargo: a small set of naval/air unit types have hold capacity
    // (see TRANSPORT_CAPACITY) capped by both total volume and a maximum
    // passenger size — a small-only transport can't take a tank no matter
    // how much room is left. A loaded unit is inert (can't be commanded,
    // doesn't fight or get targeted) until unloadUnit brings it back. ---
    loadUnit: (transportId: Value, id: Value) =>
      sim.loadUnit(owner, requireString(transportId, 'transport id'), requireString(id, 'unit id')),
    unloadUnit: (id: Value) => sim.unloadUnit(owner, requireString(id, 'unit id')),
    unloadAllFrom: (transportId: Value) => sim.unloadAllFrom(owner, requireString(transportId, 'transport id')),
    moveUnitsTo: (list: Value, x: Value, y: Value) => {
      const position = { x: requireNumber(x, 'x'), y: requireNumber(y, 'y') };
      return requireIdList(list).filter((id) => sim.orderUnitMoveTo(owner, id, position)).length;
    },
    attackUnitsTo: (list: Value, x: Value, y: Value) => {
      const position = { x: requireNumber(x, 'x'), y: requireNumber(y, 'y') };
      return requireIdList(list).filter((id) => sim.orderUnitAttackMoveTo(owner, id, position)).length;
    },
    defendUnitsAt: (list: Value, x: Value, y: Value) => {
      const position = { x: requireNumber(x, 'x'), y: requireNumber(y, 'y') };
      return requireIdList(list).filter((id) => sim.orderUnitDefendAt(owner, id, position)).length;
    },
    retreatUnits: (list: Value) => requireIdList(list).filter((id) => sim.orderUnitRetreat(owner, id)).length,
    stopUnits: (list: Value) => requireIdList(list).filter((id) => sim.orderUnitStop(owner, id)).length,

    // --- actions: each returns true if it actually fired ---
    // train/construct are parameterized by type name rather than one
    // function per unit/building — the roster is expected to grow, and a
    // script written today should keep working once it does.
    // buildingId is optional: omit it and the first eligible producer (any
    // barracks/factory/shipyard etc. with room in its queue) is picked
    // automatically, same as before. Pass a specific id from myBuildingsOfType(...)
    // to target that exact building instead — e.g. to round-robin across
    // several producers yourself, or keep one producer's queue reserved.
    train: (type: Value, buildingId?: Value) => {
      const identity = requireString(type, 'unit type');
      requireUnitType(type, race);
      const producerId = buildingId === undefined ? undefined : requireString(buildingId, 'building id');
      return genericAction(`train:${identity}`, () => sim.trainRaceUnit(owner, identity, producerId), `Training ${titleCase(identity)}`);
    },
    construct: (type: Value) => {
      const identity = requireConstructibleBuildingIdentity(type, race);
      return genericAction(`construct:${identity}`, () => sim.constructRaceBuilding(owner, identity), `Constructing ${titleCase(identity)}`);
    },
    constructAt: (type: Value, x: Value, y: Value) => {
      const identity = requireConstructibleBuildingIdentity(type, race);
      const pos = { x: requireNumber(x, 'x'), y: requireNumber(y, 'y') };
      return genericAction(`construct:${identity}`, () => sim.constructRaceBuilding(owner, identity, pos), `Constructing ${titleCase(identity)}`);
    },
    // buildingId is optional, same as train() above: omit it to auto-pick the
    // first idle lab of the right type, or pass a specific id to target it.
    research: (type: Value, buildingId?: Value) => {
      const t = requireResearchType(type);
      const producerId = buildingId === undefined ? undefined : requireString(buildingId, 'building id');
      return genericAction(`research:${t}`, () => sim.research(owner, t, producerId), `Researching ${titleCase(t)}`);
    },
    gatherResources: () =>
      action('gather_resources', () => {
        sim.orderGatherResources(owner);
        return true;
      }),
    mineNode: (id: Value, minerCount: Value) => {
      const nodeId = requireString(id, 'node id');
      if (!sim.isResourceNodeDiscovered(owner, nodeId)) return false;
      return genericAction(
        `mine:${nodeId}`,
        () => sim.orderMineResourceNode(owner, nodeId, requireNumber(minerCount, 'miner count')) > 0,
        'Assigning Crystal Miners',
      );
    },
    expandToNode: (id: Value) => {
      const nodeId = requireString(id, 'node id');
      if (!sim.isResourceNodeDiscovered(owner, nodeId)) return false;
      return genericAction(`expand:${nodeId}`, () => sim.constructMiningOutpost(owner, nodeId), 'Constructing Mining Outpost');
    },
    defendCommandCenter: () =>
      action('defend_command_center', () => {
        sim.orderDefendCommandCenter(owner);
        return true;
      }),
    attackNearestEnemy: () =>
      action('attack_nearest_enemy', () => {
        sim.orderAttackNearestEnemy(owner);
        return true;
      }),
    attackEnemyCommandCenter: () =>
      action('attack_enemy_command_center', () => {
        sim.orderAttackEnemyCommandCenter(owner);
        return true;
      }),
    retreatToBase: () =>
      action('retreat_to_base', () => {
        sim.orderRetreatToBase(owner);
        return true;
      }),
    scoutMap: () =>
      action('scout_the_map', () => {
        sim.orderScoutMap(owner);
        return true;
      }),

    // --- actions: explicit-position siblings of the auto-placed calls above ---
    rallyAt: (x: Value, y: Value) =>
      action('rally_units', () => {
        sim.rallyUnitsAt(owner, { x: requireNumber(x, 'x'), y: requireNumber(y, 'y') });
        return true;
      }),
    attackAt: (x: Value, y: Value) =>
      action(
        'attack_nearest_enemy',
        () => {
          sim.orderAttackMoveTo(owner, { x: requireNumber(x, 'x'), y: requireNumber(y, 'y') });
          return true;
        },
        'Attacking Position',
      ),

    // --- cross-match memory: how this race has fared in past matches,
    // persisted locally across games (see game/ai/matchMemory.ts). Lets a
    // script adapt itself run to run without the player rewriting it —
    // e.g. `if (winRate() < 0.4) { requiredArmy = requiredArmy + 4; }`.
    matchesPlayed: () => matchHistory().matchesPlayed,
    matchesWon: () => matchHistory().matchesWon,
    matchesLost: () => matchHistory().matchesLost,
    winRate: () => matchHistory().winRate,
    lastMatchWon: () => matchHistory().lastOutcome === 'win',
    lastMatchDuration: () => matchHistory().lastDurationSeconds,
    averageMatchDuration: () => matchHistory().averageDurationSeconds,
    currentWinStreak: () => matchHistory().currentWinStreak,
    currentLossStreak: () => matchHistory().currentLossStreak,

    // --- debugging ---
    log: (msg: Value) => {
      onLog(String(msg));
      return true;
    },
  };
}
