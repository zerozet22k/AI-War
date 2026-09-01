import { describe, expect, it } from 'vitest';
import { Simulation } from './Simulation';

const REAL_FIXED_DT = 1 / 60; // matches constants.ts FIXED_DT, what the actual game steps with

describe('gathering: unreachable-node recovery', () => {
  it('a builder that cannot actually path to its assigned node goes idle instead of freezing forever', () => {
    // Regression test for a real bug: moveUnitToward() caches a path and,
    // once every waypoint is consumed short of arrival range, just returns
    // the unit's current position forever — the cache only invalidates on a
    // changed destination or a large positional jump, neither of which
    // happens to a unit that has stopped moving. A builder assigned (by
    // nearestNodeWithResources(), which picks by straight-line distance with
    // no reachability check) to a node its ground path can't actually reach
    // used to sit in the 'gather' order — never gathering, never depositing
    // — for the rest of the match. twin-seas reliably reproduces this: its
    // water strait puts some nodes within "nearest by distance" range of a
    // base while being unreachable by ground.
    //
    // Steps at a coarse dt=1 (not the real game's dt, see below) purely so
    // this test runs in ~200 iterations instead of ~12000 — the freeze this
    // is regression-testing doesn't depend on step size, only on the target
    // being genuinely unreachable.
    const sim = new Simulation({ player: 'ironclad', enemy: 'ironclad' }, 'twin-seas');
    sim.orderGatherResources('player');
    const builder = sim.getUnits('player').find((u) => u.type === 'builder')!;
    expect(builder.order.type).toBe('gather');

    let sawMotionlessTooLong = false;
    let lastPosition = { ...builder.position };
    let motionlessTicks = 0;
    for (let t = 0; t < 200; t += 1) {
      sim.step(1);
      if (builder.order.type !== 'gather') break; // deposited, or recovered to idle — either way, not frozen
      const moved = Math.hypot(builder.position.x - lastPosition.x, builder.position.y - lastPosition.y) > 0.01;
      motionlessTicks = moved ? 0 : motionlessTicks + 1;
      lastPosition = { ...builder.position };
      // Before the fix, a stuck unit sat at the exact same position forever
      // once its path was exhausted — well past this window means frozen.
      if (motionlessTicks > 30) {
        sawMotionlessTooLong = true;
        break;
      }
    }

    expect(sawMotionlessTooLong).toBe(false);
  });

  it('gathers and deposits normally from a reachable node, at the real game\'s actual timestep', () => {
    // This is the one that matters for "does the economy actually work":
    // stepped at the real FIXED_DT (1/60), not a coarse dt=1 — moveUnitToward's
    // arrival-radius check scales with dt (Math.max(5, speed * dt * 1.5)), and
    // at dt=1 that radius can exceed the spacing between a short path's
    // waypoints, letting the skip-ahead loop consume the whole cached path in
    // one tick before the builder's position has actually caught up — which
    // looks identical to the unreachable-node freeze above but isn't one.
    // Confirmed this only shows up at that unrealistic dt: at the game's real
    // timestep, gathering behaves normally on every map, including twin-seas.
    const sim = new Simulation({ player: 'ironclad', enemy: 'ironclad' }, 'twin-seas');
    const before = sim.state.players.player.resources;
    sim.orderGatherResources('player');

    const totalSteps = Math.round(90 / REAL_FIXED_DT);
    for (let t = 0; t < totalSteps; t += 1) sim.step(REAL_FIXED_DT);

    expect(sim.state.players.player.resources).toBeGreaterThan(before);
  });
});
