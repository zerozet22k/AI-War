import type { BuildingState, BuildingType, PlayerId, RaceId, UnitState, UnitType, Vector2 } from '../../types/game';
import { BUILDING_STATS, UNIT_STATS } from '../constants';
import { buildingEntryForArchetype, DEFAULT_RACE_FOR_PLAYER, RACES, unitEntryForArchetype } from '../races';
import { makeId } from '../../utils/id';

export function createUnit(
  type: UnitType,
  owner: PlayerId,
  position: Vector2,
  raceId: RaceId = DEFAULT_RACE_FOR_PLAYER[owner],
  raceUnitId?: string,
): UnitState {
  const stats = UNIT_STATS[type];
  const race = RACES[raceId];
  const maxHp = Math.round(stats.hp * race.modifiers.hp);
  const raceUnitIdResolved = raceUnitId ?? unitEntryForArchetype(raceId, type)?.id ?? type;
  const skillDefinitions = race.units[raceUnitIdResolved]?.skills ?? [];
  return {
    id: makeId('unit'),
    kind: 'unit',
    type,
    raceUnitId: raceUnitIdResolved,
    owner,
    race: raceId,
    position: { ...position },
    hp: maxHp,
    maxHp,
    attack: stats.attack,
    attackRange: stats.range,
    attackCooldown: stats.cooldown,
    attackTimer: 0,
    speed: Math.round(stats.speed * race.modifiers.speed),
    sight: Math.round(stats.sight * race.modifiers.sight),
    damageTypes: stats.damageTypes,
    armorType: stats.armorType,
    movementDomain: stats.movementDomain,
    targetDomains: [...stats.targetDomains],
    order: { type: 'idle' },
    gatherState: null,
    gatherTimer: 0,
    carriedResources: 0,
    scoutWaypoint: null,
    autoTargetId: null,
    skills: skillDefinitions.map((skill) => ({ id: skill.id, cooldownRemaining: 0, activeRemaining: 0 })),
    cargo: [],
    loadedInto: null,
    slowUntil: 0,
    slowMultiplier: 1,
  };
}

export function createBuilding(
  type: BuildingType,
  owner: PlayerId,
  position: Vector2,
  raceId: RaceId = DEFAULT_RACE_FOR_PLAYER[owner],
  opts: { underConstruction?: boolean } = {},
  raceBuildingId?: string,
): BuildingState {
  const stats = BUILDING_STATS[type];
  const race = RACES[raceId];
  const maxHp = Math.round(stats.hp * race.modifiers.buildingHp);
  const underConstruction = opts.underConstruction ?? false;
  return {
    id: makeId('bld'),
    kind: 'building',
    type,
    raceBuildingId: raceBuildingId ?? buildingEntryForArchetype(raceId, type)?.id ?? type,
    owner,
    race: raceId,
    position: { ...position },
    hp: underConstruction ? Math.max(1, Math.round(maxHp * 0.2)) : maxHp,
    maxHp,
    underConstruction,
    constructionProgress: underConstruction ? 0 : 1,
    productionQueue: [],
    researchQueue: [],
    attack: stats.attack,
    attackRange: stats.range,
    attackCooldown: stats.cooldown,
    attackTimer: 0,
    damageTypes: stats.damageTypes,
    armorType: stats.armorType,
    lastDamagedAt: null,
  };
}
