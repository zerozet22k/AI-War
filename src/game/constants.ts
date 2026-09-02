import type { ArmorType, BuildingType, DamageType, ProjectileKind, ResearchType, UnitType, VolumeSize } from '../types/game';

export const MAP_WIDTH = 4800;
export const MAP_HEIGHT = 4800;
export const VIEW_WIDTH = 1600;
export const VIEW_HEIGHT = 900;

/** World-units per terrain tile — both the generated grid (mapGen.ts) and
 * its rendering (MainScene.ts) key off this. */
export const TILE_SIZE = 64;

export const STARTING_RESOURCES = 200;

export const UNIT_BUILD_TIME: Record<UnitType, number> = {
  builder: 6,
  soldier: 8,
  rocketeer: 11,
  marksman: 10,
  scout: 5,
  tank: 14,
  artillery: 18,
  aircraft: 16,
  support: 12,
  bomber: 21,
  frigate: 17,
  dreadnought: 30,
  submarine: 23,
};

export const BUILDING_BUILD_TIME: Record<BuildingType, number> = {
  commandCenter: 0,
  barracks: 12,
  factory: 18,
  turret: 10,
  outpost: 14,
  shipyard: 20,
  researchLab: 17,
};

/** Cargo size class per unit type — how much room it takes up aboard a
 * transport. Infantry/utility units are small; tanks/artillery/support are
 * medium; every combat vehicle/ship/aircraft is large. */
export const UNIT_VOLUME_SIZE: Record<UnitType, VolumeSize> = {
  builder: 'small',
  soldier: 'small',
  rocketeer: 'small',
  marksman: 'small',
  scout: 'small',
  tank: 'medium',
  artillery: 'medium',
  support: 'medium',
  aircraft: 'large',
  bomber: 'large',
  frigate: 'large',
  dreadnought: 'large',
  submarine: 'large',
};

/** How much cargo capacity one unit of a given size occupies. */
export const VOLUME_COST: Record<VolumeSize, number> = {
  small: 1,
  medium: 2,
  large: 4,
};

/** Which unit types can carry cargo, capped by both a maximum passenger size
 * (a small-only transport can't take a tank no matter how much room is
 * left) and a total capacity spent via VOLUME_COST. Only naval and air
 * unit types are transports for now — no dedicated transport unit exists
 * yet, so the existing hulls double up as WC3-style tiered cargo carriers:
 * frigate/aircraft (small only) -> submarine/bomber (up to medium) ->
 * dreadnought (up to large). */
export const TRANSPORT_CAPACITY: Partial<Record<UnitType, { tier: VolumeSize; capacity: number }>> = {
  frigate: { tier: 'small', capacity: 4 },
  submarine: { tier: 'medium', capacity: 6 },
  dreadnought: { tier: 'large', capacity: 10 },
  aircraft: { tier: 'small', capacity: 3 },
  bomber: { tier: 'medium', capacity: 5 },
};

export const VOLUME_SIZE_ORDINAL: Record<VolumeSize, number> = { small: 0, medium: 1, large: 2 };

/** StarCraft/Warcraft-3-style attack-vs-armor matrix — how much of a hit's
 * damage actually lands depends on the pairing of the attacker's
 * damage type(s) and the target's armor type, not just raw numbers.
 * "normal" damage is the flat, no-surprises baseline; piercing (bullets)
 * shreds light armor but glances off armored targets; explosive
 * (artillery) is the reverse, so a tank is genuinely a bad matchup for a
 * soldier and a genuinely good one against another tank or a building. */
export const DAMAGE_MULTIPLIER: Record<DamageType, Record<ArmorType, number>> = {
  normal: { light: 1.0, medium: 1.0, armored: 1.0 },
  piercing: { light: 1.5, medium: 1.0, armored: 0.6 },
  explosive: { light: 0.6, medium: 1.0, armored: 1.6 },
};

/** World-units travelled per second. Shells are slower and heavier-looking;
 * bullets are fast but still visible for several render frames at normal
 * engagement distances. Artillery is slower still (a heavy, arcing shot)
 * and doesn't home in on its target — see ProjectileState.impactPoint. */
export const PROJECTILE_SPEED: Record<ProjectileKind, number> = {
  bullet: 420,
  tracer: 600,
  shell: 300,
  cannon: 335,
  rocket: 250,
  missile: 315,
  flak: 540,
  artillery: 220,
  bomb: 175,
  torpedo: 190,
  laser: 980,
  plasma: 285,
  ion: 680,
  pulse: 760,
  railgun: 1200,
  crystal: 460,
  shard: 510,
  acid: 245,
  meteor: 205,
};

/** Artillery deals damage to every enemy entity within this radius of its
 * impact point, not just whatever it was originally aimed at. */
export const ARTILLERY_SPLASH_RADIUS = 70;

/** Projectile behavior is separate from its artwork. Direct-fire shots home
 * on their live target; these heavy kinds commit to a point and splash when
 * they arrive, making fast units capable of dodging them. */
export const BALLISTIC_PROJECTILES: ReadonlySet<ProjectileKind> = new Set([
  'artillery',
  'bomb',
  'meteor',
]);

export const PROJECTILE_SPLASH_RADIUS: Partial<Record<ProjectileKind, number>> = {
  artillery: ARTILLERY_SPLASH_RADIUS,
  bomb: 92,
  meteor: 78,
};

/** Which building trains which units. */
export const PRODUCER_FOR_UNIT: Record<UnitType, BuildingType> = {
  builder: 'commandCenter',
  soldier: 'barracks',
  rocketeer: 'barracks',
  marksman: 'barracks',
  scout: 'barracks',
  tank: 'factory',
  artillery: 'factory',
  aircraft: 'factory',
  support: 'barracks',
  bomber: 'factory',
  frigate: 'shipyard',
  dreadnought: 'shipyard',
  submarine: 'shipyard',
};

export const UNITS_PRODUCED_BY: Record<BuildingType, UnitType[]> = {
  commandCenter: ['builder'],
  barracks: ['soldier', 'rocketeer', 'marksman', 'scout', 'support'],
  factory: ['tank', 'artillery', 'aircraft', 'bomber'],
  turret: [],
  outpost: [],
  shipyard: ['frigate', 'dreadnought', 'submarine'],
  researchLab: [],
};

export const RESEARCH_DURATION: Record<ResearchType, number> = {
  fieldLogistics: 18,
  infantryTactics: 21,
  compositeArmor: 24,
  advancedBallistics: 24,
  aerialEngineering: 27,
  navalEngineering: 30,
  supportSystems: 22,
};

export const RESEARCH_PRODUCER: Record<ResearchType, BuildingType> = {
  fieldLogistics: 'commandCenter',
  infantryTactics: 'barracks',
  compositeArmor: 'factory',
  advancedBallistics: 'researchLab',
  aerialEngineering: 'researchLab',
  navalEngineering: 'shipyard',
  supportSystems: 'researchLab',
};

export const RESEARCH_NAME: Record<ResearchType, string> = {
  fieldLogistics: 'Field Logistics',
  infantryTactics: 'Infantry Tactics',
  compositeArmor: 'Composite Armor',
  advancedBallistics: 'Advanced Ballistics',
  aerialEngineering: 'Aerial Engineering',
  navalEngineering: 'Naval Engineering',
  supportSystems: 'Support Systems',
};

export const RESEARCH_DESCRIPTION: Record<ResearchType, string> = {
  fieldLogistics: 'Builders move 18% faster between structures and crystal deposits.',
  infantryTactics: 'Infantry gain 10% maximum health and weapon damage.',
  compositeArmor: 'Tanks and artillery gain 15% maximum health.',
  advancedBallistics: 'Rocket, marksman, and artillery weapons gain 12% damage and 10% range.',
  aerialEngineering: 'Aircraft gain 12% speed and weapon damage.',
  navalEngineering: 'Naval units gain 12% maximum health and weapon damage.',
  supportSystems: 'Unit skills recharge 20% faster and repair pulses restore more health.',
};

// WC3-style tiering: a research with a prerequisite can't even be attempted
// until the prior one is done — the tree only has one real chain so far
// (the roster's still small), but every research already flows through this
// same check, so a deeper tree is just more entries here, not new plumbing.
export const RESEARCH_PREREQUISITE: Partial<Record<ResearchType, ResearchType>> = {
  aerialEngineering: 'advancedBallistics',
  supportSystems: 'aerialEngineering',
};

export const RESEARCH_BY_BUILDING: Record<BuildingType, ResearchType[]> = {
  commandCenter: ['fieldLogistics'],
  barracks: ['infantryTactics'],
  factory: ['compositeArmor'],
  turret: [],
  outpost: [],
  shipyard: ['navalEngineering'],
  researchLab: ['advancedBallistics', 'aerialEngineering', 'supportSystems'],
};

export const UNIT_RESEARCH_REQUIREMENT: Partial<Record<UnitType, ResearchType>> = {
  artillery: 'advancedBallistics',
  bomber: 'aerialEngineering',
  dreadnought: 'navalEngineering',
  submarine: 'navalEngineering',
};

export const GATHER_CARRY_AMOUNT = 10;
export const GATHER_CYCLE_TIME = 2; // seconds spent standing at the node per trip
export const RESOURCE_NODE_AMOUNT = 14400;
export const RESOURCE_NODE_RADIUS = 18;

/** A resource node can only be gathered once a friendly Command Center or
 * Outpost stands within this range of it — like Warcraft 3's gold mines,
 * you have to build near a deposit before it's usable. The two nodes next
 * to each starting base are close enough for the Command Center to cover
 * them immediately; everything further out needs an Outpost. */
export const RESOURCE_GARRISON_RADIUS = 320;

/** How close a shipyard's (dry-land) foundation must be to a water tile —
 * a shipyard launches ships onto the adjacent water, so it needs to actually
 * be coastal, not just "somewhere on land" like every other building. */
export const SHORE_ADJACENCY_RADIUS = 110;

export const BUILD_ARRIVAL_RADIUS = 24;
export const GATHER_ARRIVAL_RADIUS = RESOURCE_NODE_RADIUS + 4;
export const DEPOSIT_ARRIVAL_RADIUS = 50;

/** AI scripts/rules react at 4 Hz. This is fast enough for combat decisions
 * without coupling expensive strategy evaluation to the 60 Hz simulation. */
export const AI_TICK_INTERVAL = 0.05;
export const CYCLE_DURATION = 60; // seconds of simulation before a command phase
export const COMMAND_PHASE_DURATION = 10; // seconds to choose an intervention
export const FOCUS_OVERRIDE_DURATION = 30; // seconds a "focus" style intervention overrides the AI

export const COMMAND_CENTER_UNDER_ATTACK_WINDOW = 5; // seconds a hit is considered "recent"
export const BUILDING_SIGHT = 240;

/** Grid cell size (world units) for the per-player "have I ever seen this
 * area" exploration memory that biases scout waypoint selection. Coarser
 * than a typical unit's sight radius so one sighting covers a small
 * neighborhood of cells, not just its own. */
export const EXPLORATION_CELL_SIZE = 320;

/** The fixed simulation timestep — used by the client's render-loop
 * accumulator (MainScene.ts) and, identically, by the multiplayer server's
 * own tick loop (server/room.ts), so a networked match steps at the same
 * rate a local one does. */
export const FIXED_DT = 1 / 60;
/** How often (seconds) MainScene pushes a HUD snapshot into the Zustand
 * store, and the multiplayer server broadcasts a state snapshot to clients —
 * decoupled from FIXED_DT so simulation accuracy doesn't depend on network/UI
 * update frequency. */
export const SNAPSHOT_INTERVAL = 0.1;

/** Simple starting positions, mirrored across the map centre for symmetry. */
export const BASE_OFFSET_FROM_EDGE = 240;
