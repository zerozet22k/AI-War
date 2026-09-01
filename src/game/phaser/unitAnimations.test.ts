import { describe, expect, it } from 'vitest';
import { UNIT_TYPE_LIST } from '../../types/game';
import { resolveUnitFacingAngle, resolveUnitFrame, UNIT_ANIM_CONFIG, type UnitAnimConfig } from './unitAnimations';

const config: UnitAnimConfig = { idleRow: 0, walkRows: [1, 2], fireRow: 3, walkFps: 2 };

describe('resolveUnitFrame', () => {
  it('resolves idle to the idle row, offset by direction', () => {
    expect(resolveUnitFrame(config, 0, 'idle', 0)).toBe(0);
    expect(resolveUnitFrame(config, 5, 'idle', 123)).toBe(5); // idle ignores time
  });

  it('resolves fire to the fire row, offset by direction', () => {
    expect(resolveUnitFrame(config, 3, 'fire', 0)).toBe(3 * 8 + 3);
  });

  it('alternates through walkRows over simulation time, at walkFps', () => {
    // walkFps: 2 -> a full walkRows cycle (length 2) every 1 simulated second.
    expect(resolveUnitFrame(config, 2, 'walk', 0)).toBe(1 * 8 + 2); // step 0 -> walkRows[0]
    expect(resolveUnitFrame(config, 2, 'walk', 0.4)).toBe(1 * 8 + 2); // still step 0
    expect(resolveUnitFrame(config, 2, 'walk', 0.6)).toBe(2 * 8 + 2); // step 1 -> walkRows[1]
    expect(resolveUnitFrame(config, 2, 'walk', 1.0)).toBe(1 * 8 + 2); // wraps back to step 0
  });

  it('supports a walk cycle with more than two poses', () => {
    const threePose: UnitAnimConfig = { idleRow: 0, walkRows: [1, 2, 3], fireRow: 4, walkFps: 3 };
    expect(resolveUnitFrame(threePose, 0, 'walk', 0)).toBe(1 * 8 + 0);
    expect(resolveUnitFrame(threePose, 0, 'walk', 1 / 3)).toBe(2 * 8 + 0);
    expect(resolveUnitFrame(threePose, 0, 'walk', 2 / 3)).toBe(3 * 8 + 0);
    expect(resolveUnitFrame(threePose, 0, 'walk', 1)).toBe(1 * 8 + 0); // wraps
  });

  it('has a config entry for every unit type — enforced by Record<UnitType, ...>, checked here too', () => {
    expect(Object.keys(UNIT_ANIM_CONFIG).sort()).toEqual([...UNIT_TYPE_LIST].sort());
  });
});

describe('resolveUnitFacingAngle', () => {
  it('keeps down-authored sprites unrotated when aiming downward', () => {
    expect(resolveUnitFacingAngle(0, 1)).toBeCloseTo(0);
  });

  it('rotates a down-authored sprite toward the right', () => {
    expect(resolveUnitFacingAngle(1, 0)).toBeCloseTo(-Math.PI / 2);
  });
});
