import { describe, expect, it } from 'vitest';
import { PROJECTILE_KIND_LIST } from '../types/game';
import { BALLISTIC_PROJECTILES, PROJECTILE_SPEED, PROJECTILE_SPLASH_RADIUS } from './constants';
import { RACES } from './races';

describe('projectile catalog', () => {
  it('gives every projectile a positive travel speed', () => {
    expect(Object.keys(PROJECTILE_SPEED).sort()).toEqual([...PROJECTILE_KIND_LIST].sort());
    for (const kind of PROJECTILE_KIND_LIST) expect(PROJECTILE_SPEED[kind]).toBeGreaterThan(0);
  });

  it('keeps every race-manifest weapon inside the supported catalog', () => {
    for (const race of Object.values(RACES)) {
      for (const unit of Object.values(race.units)) {
        if (unit.projectile) expect(PROJECTILE_KIND_LIST).toContain(unit.projectile);
      }
      for (const building of Object.values(race.buildings)) {
        if (building.projectile) expect(PROJECTILE_KIND_LIST).toContain(building.projectile);
      }
    }
  });

  it('gives every non-homing ballistic projectile a splash radius', () => {
    for (const kind of BALLISTIC_PROJECTILES) expect(PROJECTILE_SPLASH_RADIUS[kind]).toBeGreaterThan(0);
  });

  it('uses all ten new projectile families in race loadouts', () => {
    const equipped = new Set(
      Object.values(RACES).flatMap((race) => [
        ...Object.values(race.units).map((unit) => unit.projectile),
        ...Object.values(race.buildings).map((building) => building.projectile),
      ]),
    );
    for (const kind of ['tracer', 'cannon', 'missile', 'flak', 'bomb', 'ion', 'pulse', 'shard', 'acid', 'meteor']) {
      expect(equipped).toContain(kind);
    }
  });
});
