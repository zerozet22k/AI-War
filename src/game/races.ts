import type { BuildingType, PlayerId, ProjectileKind, RaceId, UnitSkillEffect, UnitType } from '../types/game';
import ironcladManifest from '../assets/races/ironclad/ironclad.race.json';
import aetherManifest from '../assets/races/aether/aether.race.json';
import nullforgeManifest from '../assets/races/nullforge/nullforge.race.json';

export type UnitAnimationClass = 'foot' | 'ground' | 'air' | 'naval' | 'support';
export type UnitAnimationState = 'idle' | 'move' | 'fire' | 'death';
export type BuildingAnimationState = 'idle' | 'production' | 'research' | 'damaged' | 'destroyed';
export interface AnimationDefinition<TState extends string> {
  fps: number;
  [state: string]: number | string[];
}

export interface RaceUnitDefinition {
  name: string;
  shortName: string;
  class: string;
  archetype: UnitType;
  size: number;
  asset: string;
  /** Optional high-detail source model retained beside its generated frame
   * sequence. The frame generator resolves this name inside asset/. */
  model?: string;
  /** Optional cinematic info-card art, relative to the race asset directory. */
  portrait?: string;
  animation: UnitAnimationClass;
  /** Race-specific weapon visual/audio; falls back to the archetype default. */
  projectile?: ProjectileKind;
  skills?: RaceUnitSkillDefinition[];
}

export interface RaceUnitSkillDefinition {
  id: string;
  name: string;
  description: string;
  effect: UnitSkillEffect;
  cooldown: number;
  duration?: number;
  magnitude: number;
  radius?: number;
}

export interface RaceBuildingDefinition {
  name: string;
  class: string;
  archetype: BuildingType;
  size: number;
  asset: string;
  projectile?: ProjectileKind;
}

export interface RaceConfig {
  id: RaceId;
  name: string;
  tagline: string;
  emblem: string;
  portrait: string;
  colors: { primary: number; dark: number; accent: number; projectile: number };
  modifiers: { hp: number; speed: number; sight: number; buildingHp: number };
  units: Record<string, RaceUnitDefinition>;
  buildings: Record<string, RaceBuildingDefinition>;
  animations: Record<UnitAnimationClass, AnimationDefinition<UnitAnimationState>>;
  buildingAnimations: AnimationDefinition<BuildingAnimationState>;
}

export const DEFAULT_RACE_FOR_PLAYER: Record<PlayerId, RaceId> = {
  player: 'ironclad',
  enemy: 'aether',
  player3: 'nullforge',
  player4: 'ironclad',
};

/** Packaged faction definitions. Art mapping, names, display size and
 * animation behavior live beside each faction's assets in *.race.json. */
export const RACES: Record<RaceId, RaceConfig> = {
  ironclad: ironcladManifest as RaceConfig,
  aether: aetherManifest as RaceConfig,
  nullforge: nullforgeManifest as RaceConfig,
};

export interface RaceUnitEntry {
  id: string;
  definition: RaceUnitDefinition;
}

export interface RaceBuildingEntry {
  id: string;
  definition: RaceBuildingDefinition;
}

export function unitEntryForArchetype(race: RaceId, archetype: UnitType): RaceUnitEntry | null {
  const entry = Object.entries(RACES[race].units).find(([, unit]) => unit.archetype === archetype);
  return entry ? { id: entry[0], definition: entry[1] } : null;
}

export function buildingEntryForArchetype(race: RaceId, archetype: BuildingType): RaceBuildingEntry | null {
  const entry = Object.entries(RACES[race].buildings).find(([, building]) => building.archetype === archetype);
  return entry ? { id: entry[0], definition: entry[1] } : null;
}

export function unitDefinition(race: RaceId, archetype: UnitType): RaceUnitDefinition {
  const entry = unitEntryForArchetype(race, archetype);
  if (!entry) throw new Error(`${RACES[race].name} has no unit for archetype "${archetype}"`);
  return entry.definition;
}

export function buildingDefinition(race: RaceId, archetype: BuildingType): RaceBuildingDefinition {
  const entry = buildingEntryForArchetype(race, archetype);
  if (!entry) throw new Error(`${RACES[race].name} has no building for archetype "${archetype}"`);
  return entry.definition;
}

function normalizedIdentity(value: string): string {
  return value.replace(/[\s_-]/g, '').toLowerCase();
}

export function resolveRaceUnitArchetype(race: RaceId, identity: string): UnitType | null {
  return resolveRaceUnit(race, identity)?.definition.archetype ?? null;
}

export function resolveRaceUnit(race: RaceId, identity: string): RaceUnitEntry | null {
  const wanted = normalizedIdentity(identity);
  const entry = Object.entries(RACES[race].units).find(
    ([id, unit]) =>
      normalizedIdentity(id) === wanted ||
      normalizedIdentity(unit.name) === wanted ||
      normalizedIdentity(unit.shortName) === wanted ||
      normalizedIdentity(unit.class) === wanted ||
      normalizedIdentity(unit.archetype) === wanted,
  );
  return entry ? { id: entry[0], definition: entry[1] } : null;
}

export function resolveRaceBuildingArchetype(race: RaceId, identity: string): BuildingType | null {
  return resolveRaceBuilding(race, identity)?.definition.archetype ?? null;
}

export function resolveRaceBuilding(race: RaceId, identity: string): RaceBuildingEntry | null {
  const wanted = normalizedIdentity(identity);
  const entry = Object.entries(RACES[race].buildings).find(
    ([id, building]) =>
      normalizedIdentity(id) === wanted ||
      normalizedIdentity(building.name) === wanted ||
      normalizedIdentity(building.class) === wanted ||
      normalizedIdentity(building.archetype) === wanted,
  );
  return entry ? { id: entry[0], definition: entry[1] } : null;
}

export function unitName(race: RaceId, type: UnitType): string {
  return unitDefinition(race, type).name;
}

export function unitShortName(race: RaceId, type: UnitType): string {
  return unitDefinition(race, type).shortName;
}

export function buildingName(race: RaceId, type: BuildingType): string {
  return buildingDefinition(race, type).name;
}
