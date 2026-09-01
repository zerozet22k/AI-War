import type { UnitType } from '../../types/game';

/**
 * Every current unit prefab sheet is an 8-direction grid: one column per
 * facing, one row per pose (idle / two walk-cycle poses / firing). A new
 * unit type just needs its own config entry here — it doesn't need the same
 * row order or the same number of walk-cycle frames as any other type.
 */
export interface UnitAnimConfig {
  /** Row holding the 8-direction idle pose. */
  idleRow: number;
  /** Rows making up the walk cycle, alternated in this order. Any length —
   * not fixed to exactly two poses. */
  walkRows: number[];
  /** Row holding the 8-direction firing pose. */
  fireRow: number;
  /** Walk-cycle steps per second of *simulation* time (not wall-clock) —
   * scaling with simTime, not a real-time clock, is deliberate: it keeps
   * footfall matched to actual movement speed at 2x/4x sim speed instead of
   * the legs animating at a fixed rate while the unit itself moves faster. */
  walkFps: number;
}

/** Columns per row — one per 8-direction facing, same across every current
 * unit sheet. If a future sheet ever needs a different column count, add it
 * to UnitAnimConfig instead of changing this shared constant. */
const COLS_PER_ROW = 8;

export const UNIT_ANIM_CONFIG: Record<UnitType, UnitAnimConfig> = {
  builder: { idleRow: 0, walkRows: [1, 2], fireRow: 3, walkFps: 6 },
  soldier: { idleRow: 0, walkRows: [1, 2], fireRow: 3, walkFps: 7 },
  rocketeer: { idleRow: 0, walkRows: [1, 2], fireRow: 3, walkFps: 5.5 },
  marksman: { idleRow: 0, walkRows: [1, 2], fireRow: 3, walkFps: 6.5 },
  scout: { idleRow: 0, walkRows: [1, 2], fireRow: 3, walkFps: 10 },
  tank: { idleRow: 0, walkRows: [1, 2], fireRow: 3, walkFps: 4.5 },
  artillery: { idleRow: 0, walkRows: [1, 2], fireRow: 3, walkFps: 3.5 },
  aircraft: { idleRow: 0, walkRows: [1, 2], fireRow: 3, walkFps: 8 },
  support: { idleRow: 0, walkRows: [1, 2], fireRow: 3, walkFps: 7.5 },
  bomber: { idleRow: 0, walkRows: [1, 2], fireRow: 3, walkFps: 5.8 },
  frigate: { idleRow: 0, walkRows: [1, 2], fireRow: 3, walkFps: 4.2 },
  dreadnought: { idleRow: 0, walkRows: [1, 2], fireRow: 3, walkFps: 2.8 },
  submarine: { idleRow: 0, walkRows: [1, 2], fireRow: 3, walkFps: 3.8 },
};

export type UnitAnimState = 'idle' | 'walk' | 'fire' | 'death';

/** Resolves a unit's current sprite-sheet frame from its named config
 * instead of hardcoded row arithmetic (the direct predecessor of this
 * function was `direction + (justFired ? 24 : moving ? walkRow : 0)` —
 * correct only by coincidence, for exactly the one row layout every unit
 * happened to share so far). */
export function resolveUnitFrame(config: UnitAnimConfig, direction: number, state: UnitAnimState, simTime: number): number {
  if (state === 'fire') return config.fireRow * COLS_PER_ROW + direction;
  if (state === 'walk') {
    const step = Math.floor(simTime * config.walkFps) % config.walkRows.length;
    return config.walkRows[step] * COLS_PER_ROW + direction;
  }
  return config.idleRow * COLS_PER_ROW + direction;
}

/** The generated race atlases use clean, rotatable top-down silhouettes
 * rather than baking every possible facing into separate frames. Motion is
 * layered in code so every imported unit gets the same vocabulary: idle
 * breathing/engine hover, locomotion weight, weapon recoil, and air lift.
 * Profiles change the feel without adding renderer conditionals. */
export interface UnitMotionConfig {
  idleFps: number;
  idleBob: number;
  moveFps: number;
  moveBob: number;
  moveLean: number;
  recoil: number;
  hoverHeight: number;
}

export interface UnitPose {
  x: number;
  y: number;
  rotationOffset: number;
  scaleX: number;
  scaleY: number;
}

export const UNIT_MOTION_CONFIG: Record<string, UnitMotionConfig> = {
  builder: motion(2.2, 1.2, 7, 2.2, 0.035, 1, 0),
  soldier: motion(1.8, 0.8, 8, 2.4, 0.045, 4, 0),
  rocketeer: motion(1.6, 0.7, 6, 2, 0.035, 7, 0),
  marksman: motion(1.5, 0.6, 7, 1.8, 0.028, 5, 0),
  scout: motion(2.8, 1.6, 11, 2.8, 0.06, 2, 2),
  tank: motion(1.1, 0.35, 4.5, 1.2, 0.015, 6, 0),
  artillery: motion(0.8, 0.25, 3.4, 0.9, 0.012, 10, 0),
  aircraft: motion(2.4, 2.8, 7, 3.2, 0.07, 4, 13),
  support: motion(2.6, 2.1, 7.5, 2.7, 0.055, 2, 6),
  bomber: motion(1.8, 2.4, 5.8, 3, 0.045, 7, 14),
  frigate: motion(1.2, 1.1, 4.2, 1.7, 0.025, 5, 1),
  dreadnought: motion(0.75, 0.65, 2.8, 1.05, 0.012, 9, 1),
  submarine: motion(1.05, 0.8, 3.8, 1.35, 0.02, 6, 2),
};

function motion(
  idleFps: number,
  idleBob: number,
  moveFps: number,
  moveBob: number,
  moveLean: number,
  recoil: number,
  hoverHeight: number,
): UnitMotionConfig {
  return { idleFps, idleBob, moveFps, moveBob, moveLean, recoil, hoverHeight };
}

export function resolveUnitPose(
  config: UnitMotionConfig,
  state: UnitAnimState,
  simTime: number,
  phase = 0,
  fireProgress = 0,
): UnitPose {
  const moving = state === 'walk';
  const wave = Math.sin((simTime * (moving ? config.moveFps : config.idleFps) + phase) * Math.PI * 2);
  const bob = wave * (moving ? config.moveBob : config.idleBob);
  const recoil = state === 'fire' ? Math.sin(Math.min(1, fireProgress) * Math.PI) * config.recoil : 0;
  const stride = moving ? Math.abs(wave) * 0.035 : Math.sin((simTime * config.idleFps + phase) * Math.PI * 2) * 0.012;
  return {
    x: -recoil,
    y: bob - config.hoverHeight,
    rotationOffset: moving ? wave * config.moveLean : 0,
    scaleX: 1 + stride,
    scaleY: 1 - stride * 0.65,
  };
}

/** All baked unit art is authored facing south/down at rest. Convert the
 * normal x-axis screen angle into that shared sprite convention. */
export function resolveUnitFacingAngle(dx: number, dy: number): number {
  if (Math.abs(dx) + Math.abs(dy) < 0.001) return 0;
  return Math.atan2(dy, dx) - Math.PI / 2;
}
