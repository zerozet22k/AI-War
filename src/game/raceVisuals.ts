import type { Entity, RaceId } from '../types/game';
import { RACES } from './races';

const EMBLEM_URLS = import.meta.glob('../assets/races/*/emblem.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const RACE_PORTRAIT_URLS = import.meta.glob('../assets/races/*/portrait.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const UNIT_PORTRAIT_URLS = import.meta.glob('../assets/races/*/portraits/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const ENTITY_PREVIEW_URLS = import.meta.glob('../assets/races/*/sprites/*/*/idle-a.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

function hexColor(value: number): string {
  return `#${(value >>> 0).toString(16).padStart(6, '0')}`;
}

/** CSS custom properties carrying a race's palette, meant to be spread onto
 * a container's inline style so descendant CSS can pick them up via
 * `var(--race-accent, <fallback>)` and still render sensibly outside a
 * themed container (menus, lobby chrome not tied to a specific race). */
export function raceThemeStyle(raceId: RaceId): Record<string, string> {
  const { primary, dark, accent } = RACES[raceId].colors;
  return {
    '--race-primary': hexColor(primary),
    '--race-dark': hexColor(dark),
    '--race-accent': hexColor(accent),
  };
}

export function raceEmblemUrl(raceId: RaceId): string {
  return EMBLEM_URLS[`../assets/races/${raceId}/${RACES[raceId].emblem}`] ?? '';
}

export function racePortraitUrl(raceId: RaceId): string {
  return RACE_PORTRAIT_URLS[`../assets/races/${raceId}/${RACES[raceId].portrait}`] ?? '';
}

export function entityPortraitUrl(entity: Entity): string {
  if (entity.kind === 'unit') {
    const definition = RACES[entity.race].units[entity.raceUnitId];
    if (definition.portrait) {
      const key = `../assets/races/${entity.race}/${definition.portrait}`;
      const cinematicPortrait = UNIT_PORTRAIT_URLS[key] ?? RACE_PORTRAIT_URLS[key];
      if (cinematicPortrait) return cinematicPortrait;
    }

    // Until a race pack supplies cinematic art for this exact unit, show that
    // unit's own sprite instead of reusing one generic face for the whole race.
    return ENTITY_PREVIEW_URLS[`../assets/races/${entity.race}/${definition.asset}/idle-a.png`] ?? racePortraitUrl(entity.race);
  }

  const definition = RACES[entity.race].buildings[entity.raceBuildingId];
  return ENTITY_PREVIEW_URLS[`../assets/races/${entity.race}/${definition.asset}/idle-a.png`] ?? '';
}
