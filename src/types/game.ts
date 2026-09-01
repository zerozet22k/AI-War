// Core domain types shared by the simulation, AI, and UI layers.

export const PLAYER_ID_LIST = ['player', 'enemy', 'player3', 'player4'] as const;
export type PlayerId = (typeof PLAYER_ID_LIST)[number];

export const RACE_ID_LIST = ['ironclad', 'aether', 'nullforge'] as const;
export type RaceId = (typeof RACE_ID_LIST)[number];

export type MovementDomain = 'ground' | 'air' | 'sea';

// Cargo size class — how much room a unit takes up aboard a transport, and
// (for a transport itself) the largest size class it's built to carry. See
// UNIT_VOLUME_SIZE / TRANSPORT_CAPACITY in constants.ts.
export const VOLUME_SIZE_LIST = ['small', 'medium', 'large'] as const;
export type VolumeSize = (typeof VOLUME_SIZE_LIST)[number];

export interface Vector2 {
  x: number;
  y: number;
}

// The master roster — adding a unit/building type starts here. Everything
// that must cover every type (stats, costs, sprite/display labels, the
// script API's validator lists) is a `Record<UnitType, X>` or
// `Record<BuildingType, X>` derived from these, so TypeScript's own
// exhaustiveness checking fails the build at every spot still needing an
// entry — a missing spot is a compile error, not a silent gap.
export const UNIT_TYPE_LIST = [
  'builder', 'soldier', 'rocketeer', 'marksman', 'scout', 'tank', 'artillery', 'aircraft',
  'support', 'bomber', 'frigate', 'dreadnought', 'submarine',
] as const;
export type UnitType = (typeof UNIT_TYPE_LIST)[number];

export const BUILDING_TYPE_LIST = ['commandCenter', 'barracks', 'factory', 'turret', 'outpost', 'shipyard', 'researchLab'] as const;
export type BuildingType = (typeof BUILDING_TYPE_LIST)[number];

export const RESEARCH_TYPE_LIST = [
  'fieldLogistics', 'infantryTactics', 'compositeArmor', 'advancedBallistics',
  'aerialEngineering', 'navalEngineering', 'supportSystems',
] as const;
export type ResearchType = (typeof RESEARCH_TYPE_LIST)[number];

export type UnitSkillEffect = 'repairPulse' | 'speedBoost' | 'weaponBoost' | 'fortify' | 'slowPulse';

export interface UnitSkillState {
  id: string;
  cooldownRemaining: number;
  activeRemaining: number;
}

// StarCraft/Warcraft-3-style attack-vs-armor matrix: what actually makes two
// units with different types feel different isn't their raw numbers, it's
// which targets they're good or bad against. DAMAGE_MULTIPLIER in
// constants.ts is the full Record<DamageType, Record<ArmorType, number>> —
// this is just the two type lists.
export const DAMAGE_TYPE_LIST = ['normal', 'piercing', 'explosive'] as const;
export type DamageType = (typeof DAMAGE_TYPE_LIST)[number];

export const ARMOR_TYPE_LIST = ['light', 'medium', 'armored'] as const;
export type ArmorType = (typeof ARMOR_TYPE_LIST)[number];

export type GatherState = 'toNode' | 'gathering' | 'toBase';

export type UnitOrder =
  | { type: 'idle' }
  | { type: 'gather'; nodeId: string }
  | { type: 'moveTo'; position: Vector2 }
  | { type: 'attackMove'; position: Vector2 }
  | { type: 'attackTarget'; targetId: string }
  | { type: 'build'; buildingId: string }
  | { type: 'defend'; position: Vector2 }
  | { type: 'retreat' }
  | { type: 'scout' };

export interface UnitState {
  id: string;
  kind: 'unit';
  type: UnitType;
  /** Race-local roster id (for example "shaper" or "fabricator"). */
  raceUnitId: string;
  owner: PlayerId;
  race: RaceId;
  position: Vector2;
  hp: number;
  maxHp: number;
  attack: number;
  attackRange: number;
  attackCooldown: number;
  attackTimer: number;
  speed: number;
  sight: number;
  movementDomain: MovementDomain;
  targetDomains: MovementDomain[];
  /** What kind(s) of damage this unit's attack deals (irrelevant if attack
   * is 0) — almost always one entry, but some attacks are a mix (e.g. a
   * unit that's part-explosive, part-piercing). When there's more than
   * one, `attack` splits evenly across them; see splitDamageByType() in
   * Simulation.ts. */
  damageTypes: DamageType[];
  /** What kind of armor this unit has — determines how much damage it
   * actually takes from a given DamageType, via DAMAGE_MULTIPLIER. */
  armorType: ArmorType;
  order: UnitOrder;
  gatherState: GatherState | null;
  gatherTimer: number;
  /** Crystals currently carried from a completed gathering cycle. */
  carriedResources: number;
  scoutWaypoint: Vector2 | null;
  /** Sticky combat acquisition prevents oscillation between equally close targets. */
  autoTargetId: string | null;
  /** Race-authored active abilities and their authoritative timers. */
  skills: UnitSkillState[];
  /** Ids of units currently riding aboard this one — only ever non-empty for
   * a unit type with cargo capacity (see TRANSPORT_CAPACITY in constants.ts).
   * A loaded unit is not removed from state.units (it keeps its HP and
   * memory), just excluded from movement/combat/rendering until unloaded. */
  cargo: string[];
  /** Id of the transport this unit is currently riding aboard, or null if
   * it's acting freely on the battlefield. */
  loadedInto: string | null;
  /** A 'slowPulse' skill applies this as a speed multiplier (<1) to
   * whichever enemy unit it hit, until this game-time timestamp. */
  slowUntil: number;
  slowMultiplier: number;
}

export interface ProductionOrder {
  id: string;
  unitType: UnitType;
  raceUnitId: string;
  progress: number; // 0..1
  duration: number;
}

export interface ResearchOrder {
  id: string;
  researchType: ResearchType;
  progress: number;
  duration: number;
}

export interface BuildingState {
  id: string;
  kind: 'building';
  type: BuildingType;
  /** Race-local structure id (for example "heartspire" or "citadel"). */
  raceBuildingId: string;
  owner: PlayerId;
  race: RaceId;
  position: Vector2;
  hp: number;
  maxHp: number;
  underConstruction: boolean;
  constructionProgress: number; // 0..1, 1 = complete
  productionQueue: ProductionOrder[];
  researchQueue: ResearchOrder[];
  attack?: number;
  attackRange?: number;
  attackCooldown?: number;
  attackTimer?: number;
  damageTypes?: DamageType[];
  armorType: ArmorType;
  lastDamagedAt: number | null;
}

export type Entity = UnitState | BuildingState;

export const PROJECTILE_KIND_LIST = [
  'bullet', 'tracer', 'shell', 'cannon', 'rocket', 'missile', 'flak',
  'artillery', 'bomb', 'torpedo', 'laser', 'plasma', 'ion', 'pulse',
  'railgun', 'crystal', 'shard', 'acid', 'meteor',
] as const;
export type ProjectileKind = (typeof PROJECTILE_KIND_LIST)[number];

export interface ProjectileState {
  id: string;
  kind: ProjectileKind;
  owner: PlayerId;
  sourceId: string;
  position: Vector2;
  targetId: string;
  damage: number;
  damageTypes: DamageType[];
  speed: number;
  remainingRange: number;
  /** Ballistic ordnance only: the fixed point it was aimed at when fired.
   * Unlike direct-fire projectiles, bombs, meteors, and artillery do not
   * home, so mobile targets can dodge them after launch. */
  impactPoint?: Vector2;
  /** Ballistic ordnance only: every enemy entity in this radius is hit. */
  splashRadius?: number;
}

export interface ResourceNodeState {
  id: string;
  position: Vector2;
  remaining: number;
  maxAmount: number;
}

export interface PlayerState {
  id: PlayerId;
  race: RaceId;
  resources: number;
  completedResearch: ResearchType[];
}

export interface MatchResult {
  winner: PlayerId | null;
  reason: string;
}

export interface MatchStats {
  unitsCreated: number;
  unitsLost: number;
  buildingsConstructed: number;
  resourcesGathered: number;
}

// Terrain is simulation data, not decoration: ground units path over land,
// sea units path through connected water, and air units ignore the grid.
export const TERRAIN_TYPE_LIST = ['land', 'water'] as const;
export type TerrainType = (typeof TERRAIN_TYPE_LIST)[number];

export interface MapState {
  id: string;
  name: string;
  tileset: string;
  landTiles: string[];
  waterTiles: string[];
  width: number;
  height: number;
  resourceNodes: ResourceNodeState[];
  bases: Record<PlayerId, Vector2>;
  /** Row-major grid, length === terrainCols * terrainRows. Index a cell with
   * terrain[row * terrainCols + col]; see worldToTile()/tileAt() in mapGen.ts. */
  terrain: TerrainType[];
  terrainCols: number;
  terrainRows: number;
}

export interface SimState {
  time: number; // elapsed *active* simulation seconds (does not advance while paused)
  map: MapState;
  players: Record<PlayerId, PlayerState>;
  units: UnitState[];
  buildings: BuildingState[];
  projectiles: ProjectileState[];
  matchResult: MatchResult | null;
  stats: Record<PlayerId, MatchStats>;
  /** Only these slots participate in this match. Local battles default to
   * two players; multiplayer rooms may activate three or four. */
  activePlayers: PlayerId[];
}
