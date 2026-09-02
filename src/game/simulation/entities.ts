import type { BuildingState, BuildingType, PlayerId, RaceId, UnitState, UnitType, Vector2 } from '../../types/game';
import { buildingEntryForArchetype, DEFAULT_RACE_FOR_PLAYER, RACES, unitEntryForArchetype } from '../races';
import { makeId } from '../../utils/id';

export function createUnit(
  type: UnitType,
  owner: PlayerId,
  position: Vector2,
  raceId: RaceId = DEFAULT_RACE_FOR_PLAYER[owner],
  raceUnitId?: string,
): UnitState {
  const race = RACES[raceId];
  const raceUnitIdResolved = raceUnitId ?? unitEntryForArchetype(raceId, type)?.id ?? type;
  const definition = race.units[raceUnitIdResolved];
  const skillDefinitions = definition?.skills ?? [];
  return {
    id: makeId('unit'),
    kind: 'unit',
    type,
    raceUnitId: raceUnitIdResolved,
    owner,
    race: raceId,
    position: { ...position },
    hp: definition.hp,
    maxHp: definition.hp,
    attack: definition.attack,
    attackRange: definition.range,
    attackCooldown: definition.cooldown,
    attackTimer: 0,
    speed: definition.speed,
    sight: definition.sight,
    damageTypes: definition.damageTypes,
    armorType: definition.armorType,
    movementDomain: definition.movementDomain,
    targetDomains: [...definition.targetDomains],
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
    power: definition.power,
    stunnedUntil: 0,
    shieldRemaining: 0,
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
  const race = RACES[raceId];
  const raceBuildingIdResolved = raceBuildingId ?? buildingEntryForArchetype(raceId, type)?.id ?? type;
  const definition = race.buildings[raceBuildingIdResolved];
  const maxHp = definition.hp;
  const underConstruction = opts.underConstruction ?? false;
  return {
    id: makeId('bld'),
    kind: 'building',
    type,
    raceBuildingId: raceBuildingIdResolved,
    owner,
    race: raceId,
    position: { ...position },
    hp: underConstruction ? Math.max(1, Math.round(maxHp * 0.2)) : maxHp,
    maxHp,
    underConstruction,
    constructionProgress: underConstruction ? 0 : 1,
    productionQueue: [],
    researchQueue: [],
    attack: definition.attack,
    attackRange: definition.range,
    attackCooldown: definition.cooldown,
    attackTimer: 0,
    damageTypes: definition.damageTypes,
    armorType: definition.armorType,
    lastDamagedAt: null,
  };
}
