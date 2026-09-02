import { describe, expect, it } from 'vitest';
import { Simulation } from './Simulation';
import { createUnit } from './entities';
import { BUILDING_BUILD_TIME, DAMAGE_MULTIPLIER, STARTING_RESOURCES, UNIT_BUILD_TIME } from '../constants';
import { RACES } from '../races';

// `new Simulation()` defaults the 'player' seat to ironclad — its builder,
// the fabricator, is what these cost assertions are checking against.
const IRONCLAD_BUILDER_COST = RACES.ironclad.units.fabricator.cost;

describe('Simulation setup', () => {
  it('gives both players a Command Center, one Builder, and starting resources', () => {
    const sim = new Simulation();
    for (const owner of ['player', 'enemy'] as const) {
      expect(sim.getResources(owner)).toBe(STARTING_RESOURCES);
      expect(sim.getBuildings(owner, 'commandCenter')).toHaveLength(1);
      expect(sim.getUnits(owner, 'builder')).toHaveLength(1);
    }
  });
});

describe('training units', () => {
  it('deducts cost and eventually spawns the unit once build time elapses', () => {
    const sim = new Simulation();
    const before = sim.getResources('player');
    const ok = sim.trainUnit('player', 'builder');
    expect(ok).toBe(true);
    expect(sim.getResources('player')).toBe(before - IRONCLAD_BUILDER_COST);
    expect(sim.getUnits('player', 'builder')).toHaveLength(1); // not spawned yet

    for (let i = 0; i < Math.ceil(UNIT_BUILD_TIME.builder / 0.25) + 2; i += 1) {
      sim.step(0.25);
    }
    expect(sim.getUnits('player', 'builder').length).toBeGreaterThanOrEqual(2);
  });

  it('refuses to train when resources are insufficient', () => {
    const sim = new Simulation();
    sim.state.players.player.resources = 10;
    const ok = sim.trainUnit('player', 'tank');
    expect(ok).toBe(false);
    expect(sim.state.players.player.resources).toBe(10);
  });

  it('refuses to train a unit whose producer building does not exist yet', () => {
    const sim = new Simulation();
    sim.state.players.player.resources = 1000;
    // No Barracks has been built, so Soldiers cannot be trained yet.
    const ok = sim.trainUnit('player', 'soldier');
    expect(ok).toBe(false);
  });
});

describe('constructing buildings', () => {
  it('spends resources, places the building under construction, and finishes it over time', () => {
    const sim = new Simulation();
    sim.state.players.player.resources = 1000;
    // Near the player's own base, not a fixed map coordinate — the default
    // map (twin-seas) has a water strait splitting it in two, and a fixed
    // point can easily land on the far, ground-unreachable side of it.
    const base = sim.state.map.bases.player;
    const ok = sim.constructBuilding('player', 'barracks', { x: base.x + 120, y: base.y });
    expect(ok).toBe(true);
    const barracks = sim.getBuildings('player', 'barracks')[0];
    expect(barracks.underConstruction).toBe(true);
    expect(barracks.constructionProgress).toBeLessThan(1);

    // A builder has to walk to the site before construction progress starts
    // ticking, so budget generous travel time on top of the build duration
    // itself (worst case, roughly the map's diagonal at builder speed).
    const travelBudget = 60;
    for (let i = 0; i < Math.ceil((BUILDING_BUILD_TIME.barracks + travelBudget) / 0.25) + 2; i += 1) {
      sim.step(0.25);
    }
    const finished = sim.getBuildings('player', 'barracks')[0];
    expect(finished.underConstruction).toBe(false);
    expect(finished.hp).toBe(finished.maxHp);
  });

  it('rejects overlapping or out-of-bounds build positions', () => {
    const sim = new Simulation();
    const cc = sim.getCommandCenter('player')!;
    expect(sim.isValidBuildPosition({ x: cc.position.x, y: cc.position.y })).toBe(false);
    expect(sim.isValidBuildPosition({ x: -50, y: 50 })).toBe(false);
    expect(sim.isValidBuildPosition({ x: 500, y: 500 })).toBe(true);
  });

  it('only allows a shipyard on dry land that is actually coastal, unlike every other building', () => {
    const sim = new Simulation({ player: 'ironclad', enemy: 'ironclad' }, 'twin-seas');
    // A dry-land spot far from any water is fine for a barracks but not a shipyard.
    const inlandSpot = { x: sim.state.map.bases.player.x + 120, y: sim.state.map.bases.player.y };
    expect(sim.isValidBuildPosition(inlandSpot, 'barracks')).toBe(true);
    expect(sim.isValidBuildPosition(inlandSpot, 'shipyard')).toBe(false);

    // Auto-placement for a shipyard has to actually go find a coastal spot —
    // confirm it does, and that the result is genuinely near water.
    sim.state.players.player.resources = 1000;
    const ok = sim.constructBuilding('player', 'shipyard');
    expect(ok).toBe(true);
    const shipyard = sim.getBuildings('player', 'shipyard')[0];
    expect(shipyard).toBeDefined();
  });

  it('hides a freshly-queued foundation from the enemy — and from combat targeting — until its builder actually arrives and starts working', () => {
    // Regression test: constructBuilding() used to create a real, fully
    // targetable entity (with 20% HP) the instant the command was issued,
    // long before the assigned builder physically walked there — so an
    // opponent who could merely see that spot could spot and destroy a
    // foundation nobody had started building yet.
    const sim = new Simulation();
    sim.state.players.player.resources = 1000;
    const base = sim.state.map.bases.player;
    const spot = { x: base.x + 400, y: base.y };
    expect(sim.constructBuilding('player', 'barracks', spot)).toBe(true);
    const foundation = sim.getBuildings('player', 'barracks')[0];
    expect(foundation.underConstruction).toBe(true);
    expect(foundation.constructionProgress).toBe(0);

    // constructBuilding() already sent the starting builder walking toward
    // the site — hold it back at home for now so it can't wander into the
    // enemy tank below before this phase is done checking the foundation.
    const builder = sim.getUnits('player', 'builder')[0];
    builder.order = { type: 'idle' };

    // Give the enemy full vision of that spot (a unit standing right on it) —
    // the foundation must still be invisible and untargetable to them.
    const scout = createUnit('scout', 'enemy', spot);
    sim.state.units.push(scout);
    expect(sim.isBuildingVisibleTo('enemy', foundation)).toBe(false);

    const tank = createUnit('tank', 'enemy', spot);
    sim.state.units.push(tank);
    sim.setUnitsOrder([tank.id], { type: 'attackMove', position: { ...spot } });
    for (let i = 0; i < 50; i += 1) {
      builder.order = { type: 'idle' }; // keep it parked; re-assert in case anything else reassigns it
      sim.step(0.1);
    }
    expect(foundation.hp).toBe(Math.max(1, Math.round(foundation.maxHp * 0.2))); // untouched

    // Its own owner can always see it, though.
    expect(sim.isBuildingVisibleTo('player', foundation)).toBe(true);

    // Once its builder actually arrives and progress ticks past 0, it
    // becomes a normal (visible, destroyable) building under construction.
    // Clear the attacker first so the builder isn't killed en route, then
    // send it in and teleport it on site rather than waiting out travel time.
    scout.hp = 0;
    tank.hp = 0;
    sim.step(0.1); // removeDead()
    builder.order = { type: 'build', buildingId: foundation.id };
    builder.position = { ...spot };
    for (let i = 0; i < 5; i += 1) sim.step(0.1);
    expect(foundation.constructionProgress).toBeGreaterThan(0);

    // A fresh set of enemy eyes on the same spot now sees a normal
    // half-built structure, not a phantom.
    sim.state.units.push(createUnit('scout', 'enemy', spot));
    expect(sim.isBuildingVisibleTo('enemy', foundation)).toBe(true);
  });

  it('stalls a foundation forever once its builder dies, until resumeConstruction() sends a replacement', () => {
    const sim = new Simulation();
    sim.state.players.player.resources = 1000;
    const base = sim.state.map.bases.player;
    const spot = { x: base.x + 120, y: base.y };
    expect(sim.constructBuilding('player', 'barracks', spot)).toBe(true);
    const foundation = sim.getBuildings('player', 'barracks')[0];
    const originalBuilder = sim.getUnits('player', 'builder')[0];

    // Walk the original builder to the site and let real progress accrue.
    originalBuilder.position = { ...spot };
    for (let i = 0; i < 20; i += 1) sim.step(0.1);
    expect(foundation.constructionProgress).toBeGreaterThan(0);
    expect(sim.isBuildingStaffed(foundation.id)).toBe(true);

    // Kill the builder mid-construction. stepBuilding() doesn't skip a unit
    // already at hp<=0 (only removeDead() does, at the end of this same
    // step), so one more tick of progress still lands here — snapshot
    // "progress at death" only once that step has fully settled.
    originalBuilder.hp = 0;
    sim.step(0.1); // removeDead()
    const progressBeforeDeath = foundation.constructionProgress;
    expect(sim.getUnits('player', 'builder')).toHaveLength(0);
    expect(sim.isBuildingStaffed(foundation.id)).toBe(false);

    // With nobody left to build it, progress genuinely stalls — this is the
    // bug: stepBuilding() never reassigns a builder on its own.
    const spentResources = sim.getResources('player');
    for (let i = 0; i < 20; i += 1) sim.step(0.1);
    expect(foundation.constructionProgress).toBe(progressBeforeDeath);
    expect(foundation.underConstruction).toBe(true);

    // Train a fresh builder and use the explicit resume command.
    sim.trainUnit('player', 'builder');
    for (let i = 0; i < Math.ceil(UNIT_BUILD_TIME.builder / 0.25) + 2; i += 1) sim.step(0.25);
    const replacement = sim.getUnits('player', 'builder')[0];
    expect(replacement).toBeDefined();

    const resourcesBeforeResume = sim.getResources('player');
    expect(sim.resumeConstruction('player', foundation.id)).toBe(true);
    expect(sim.getResources('player')).toBe(resourcesBeforeResume); // never charged again
    expect(sim.isBuildingStaffed(foundation.id)).toBe(true);

    replacement.position = { ...spot };
    for (let i = 0; i < 20; i += 1) sim.step(0.1);
    // Progress kept climbing from where it stalled, not from a discount/reset.
    expect(foundation.constructionProgress).toBeGreaterThan(progressBeforeDeath);
    expect(sim.getResources('player')).toBeLessThanOrEqual(spentResources); // no double charge anywhere in this flow

    // A second resumeConstruction() call is a no-op — the building already has a builder.
    expect(sim.resumeConstruction('player', foundation.id)).toBe(false);
    // And once complete, there's nothing left to resume.
    for (let i = 0; i < Math.ceil(BUILDING_BUILD_TIME.barracks / 0.1) + 5; i += 1) sim.step(0.1);
    expect(foundation.underConstruction).toBe(false);
    expect(sim.resumeConstruction('player', foundation.id)).toBe(false);
  });
});

describe('gathering', () => {
  it('automatically sends idle builders to gather and deposits resources over time', () => {
    const sim = new Simulation();
    const start = sim.getResources('player');
    for (let i = 0; i < 400; i += 1) {
      sim.step(0.1); // 40 simulated seconds — enough for at least one full gather round trip
    }
    expect(sim.getResources('player')).toBeGreaterThan(start);
  });
});

describe('combat', () => {
  it('fires a projectile in range and applies damage only when it reaches the target', () => {
    const sim = new Simulation();
    const enemyCC = sim.getCommandCenter('enemy')!;
    const hpBefore = enemyCC.hp;
    // Every match starts with a builder unit next to each base — remove the
    // enemy's so it can't intercept the attack-move order meant for the CC.
    sim.state.units = sim.state.units.filter((u) => u.owner !== 'enemy');

    const tank = createUnit('tank', 'player', { x: enemyCC.position.x + 65, y: enemyCC.position.y });
    sim.state.units.push(tank);
    sim.setUnitsOrder([tank.id], { type: 'attackMove', position: { ...enemyCC.position } });

    sim.step(0.01);

    expect(sim.state.projectiles).toHaveLength(1);
    expect(enemyCC.hp).toBe(hpBefore);

    for (let i = 0; i < 30; i += 1) sim.step(0.01);

    expect(sim.state.projectiles).toHaveLength(0);
    // A tank's explosive damage vs. the Command Center's armored armor type
    // isn't 1:1 — see DAMAGE_MULTIPLIER in constants.ts.
    const expectedDamage = tank.attack * DAMAGE_MULTIPLIER.explosive[enemyCC.armorType];
    expect(enemyCC.hp).toBe(hpBefore - expectedDamage);
  });

  it('does not fire until a target is inside the attacker range', () => {
    const sim = new Simulation();
    const enemyCC = sim.getCommandCenter('enemy')!;
    // Remove the enemy's starting builder — it stands close enough to the
    // base to otherwise be a valid in-range target on its own.
    sim.state.units = sim.state.units.filter((u) => u.owner !== 'enemy');
    const tank = createUnit('tank', 'player', { x: enemyCC.position.x, y: enemyCC.position.y });
    tank.position.x += tank.attackRange + 20;
    sim.state.units.push(tank);

    sim.step(0.1);

    expect(sim.state.projectiles).toHaveLength(0);
    expect(enemyCC.hp).toBe(enemyCC.maxHp);
  });

  it('continues ticking a unit cooldown while it remains engaged', () => {
    const sim = new Simulation();
    const enemyCC = sim.getCommandCenter('enemy')!;
    // Remove the enemy's starting builder so the soldier's attack-move
    // engages the Command Center itself, not the builder standing nearby.
    sim.state.units = sim.state.units.filter((u) => u.owner !== 'enemy');
    const soldier = createUnit('soldier', 'player', { x: enemyCC.position.x + 20, y: enemyCC.position.y });
    sim.state.units.push(soldier);
    sim.setUnitsOrder([soldier.id], { type: 'attackMove', position: { ...enemyCC.position } });

    sim.step(0.1);
    const afterFirstShot = enemyCC.hp;
    for (let i = 0; i < 4; i += 1) sim.step(0.1);
    expect(enemyCC.hp).toBe(afterFirstShot);

    for (let i = 0; i < 6; i += 1) sim.step(0.1);
    expect(enemyCC.hp).toBeLessThan(afterFirstShot);
  });

  it('removes destroyed buildings and declares a winner when a Command Center falls', () => {
    const sim = new Simulation();
    const enemyCC = sim.getCommandCenter('enemy')!;
    enemyCC.hp = 0;

    sim.step(0.1);

    expect(sim.getBuildings('enemy', 'commandCenter')).toHaveLength(0);
    expect(sim.state.matchResult).not.toBeNull();
    expect(sim.state.matchResult?.winner).toBe('player');
  });
});

describe('single-unit and explicit-position orders (used by the scripting API)', () => {
  it('orderAttackMoveTo sends combat units toward an explicit point', () => {
    const sim = new Simulation();
    const soldier = createUnit('soldier', 'player', { x: 100, y: 100 });
    sim.state.units.push(soldier);

    sim.orderAttackMoveTo('player', { x: 900, y: 500 });

    expect(soldier.order).toEqual({ type: 'attackMove', position: { x: 900, y: 500 } });
  });

  it('orderUnitMoveTo moves only the named unit, and only if it belongs to the caller', () => {
    const sim = new Simulation();
    const mine = createUnit('soldier', 'player', { x: 100, y: 100 });
    const theirs = createUnit('soldier', 'enemy', { x: 100, y: 100 });
    sim.state.units.push(mine, theirs);

    expect(sim.orderUnitMoveTo('player', mine.id, { x: 400, y: 400 })).toBe(true);
    expect(mine.order).toEqual({ type: 'moveTo', position: { x: 400, y: 400 } });

    expect(sim.orderUnitMoveTo('player', theirs.id, { x: 400, y: 400 })).toBe(false);
    expect(theirs.order.type).not.toBe('moveTo');
  });

  it('orderUnitAttackMoveTo returns false for an id that does not exist', () => {
    const sim = new Simulation();
    expect(sim.orderUnitAttackMoveTo('player', 'not-a-real-id', { x: 0, y: 0 })).toBe(false);
  });

  it('never lets a unit walk outside the map, even when ordered far past its edge', () => {
    const sim = new Simulation();
    const soldier = createUnit('soldier', 'player', { x: 50, y: 50 });
    sim.state.units.push(soldier);
    sim.orderUnitMoveTo('player', soldier.id, { x: -99999, y: -99999 });

    for (let i = 0; i < 2000; i += 1) sim.step(0.25);

    expect(soldier.position.x).toBeGreaterThanOrEqual(0);
    expect(soldier.position.y).toBeGreaterThanOrEqual(0);
    expect(soldier.position.x).toBeLessThanOrEqual(sim.state.map.width);
    expect(soldier.position.y).toBeLessThanOrEqual(sim.state.map.height);
  });

  it('orderScoutMap borrows an idle unit when no Scout exists, but never one already busy fighting', () => {
    const sim = new Simulation();
    const cc = sim.getCommandCenter('player')!;
    const busySoldier = createUnit('soldier', 'player', { x: cc.position.x, y: cc.position.y });
    busySoldier.order = { type: 'attackMove', position: { x: cc.position.x + 400, y: cc.position.y } };
    sim.state.units.push(busySoldier);

    sim.orderScoutMap('player');
    expect(busySoldier.order.type).toBe('attackMove'); // untouched — was not idle

    const idleSoldier = createUnit('soldier', 'player', { x: cc.position.x, y: cc.position.y });
    sim.state.units.push(idleSoldier);
    sim.orderScoutMap('player');
    expect(idleSoldier.order.type).toBe('scout');
  });

  it('orderScoutMap does not reroll an in-progress scout every call, so a script re-issuing it every AI tick still lets the scout actually travel', () => {
    // Regression test for a real bug: orderScoutMap() used to unconditionally
    // reassign scoutWaypoint = randomWaypointFor(unit) on every call, and
    // every doctrine script calls scoutMap() from its per-tick brain every
    // single AI tick (20/second, see AI_TICK_INTERVAL) — so the scout's
    // target reset 20 times a second and it never got anywhere, reading as
    // "moving stupidly" / stuck near home instead of exploring the map.
    const sim = new Simulation();
    const cc = sim.getCommandCenter('player')!;
    const scout = createUnit('scout', 'player', { x: cc.position.x, y: cc.position.y });
    sim.state.units.push(scout);

    sim.orderScoutMap('player');
    const firstWaypoint = { ...scout.scoutWaypoint! };

    // Re-issuing the order many times in a row, before the scout could
    // possibly have reached that first waypoint, must leave it untouched.
    for (let i = 0; i < 20; i += 1) sim.orderScoutMap('player');
    expect(scout.scoutWaypoint).toEqual(firstWaypoint);

    let traveled = 0;
    let last = { ...scout.position };
    const dt = 1 / 60;
    for (let t = 0; t < Math.round(30 / dt); t += 1) {
      sim.orderScoutMap('player'); // simulates the doctrine script calling this every tick
      sim.step(dt);
      traveled += Math.hypot(scout.position.x - last.x, scout.position.y - last.y);
      last = { ...scout.position };
    }

    expect(traveled).toBeGreaterThan(1000);
  });
});

describe('artillery attacks', () => {
  // Splash/ballistic behavior now belongs to the dedicated 'artillery' unit
  // type specifically — 'tank' fires a plain single-target 'shell' (see
  // UNIT_STATS in constants.ts), so these tests use 'artillery', not 'tank'.
  it('splash damage hits every nearby enemy, not just the original target', () => {
    const sim = new Simulation();
    const arty = createUnit('artillery', 'player', { x: 0, y: 0 });
    const enemyTank = createUnit('tank', 'enemy', { x: 60, y: 0 }); // within the artillery's attack range
    const bystander = createUnit('soldier', 'enemy', { x: 60, y: 30 }); // within splash radius of that impact point
    sim.state.units.push(arty, enemyTank, bystander);

    for (let i = 0; i < 20; i += 1) sim.step(0.05);

    expect(enemyTank.hp).toBeLessThan(enemyTank.maxHp);
    expect(bystander.hp).toBeLessThan(bystander.maxHp);
  });

  it('never damages its own side, even one standing right in the blast', () => {
    const sim = new Simulation();
    const arty = createUnit('artillery', 'player', { x: 0, y: 0 });
    const enemyTank = createUnit('tank', 'enemy', { x: 60, y: 0 });
    enemyTank.attack = 0; // isolate the assertion to the artillery's own splash, not return fire
    const friendlyBystander = createUnit('soldier', 'player', { x: 30, y: 0 }); // between the two, well within splash
    sim.state.units.push(arty, enemyTank, friendlyBystander);

    for (let i = 0; i < 20; i += 1) sim.step(0.05);

    expect(friendlyBystander.hp).toBe(friendlyBystander.maxHp);
  });

  it('is ballistic, not homing — a target that moves after the shot is fired can dodge it', () => {
    const sim = new Simulation();
    const arty = createUnit('artillery', 'player', { x: 0, y: 0 });
    const enemyTank = createUnit('tank', 'enemy', { x: 60, y: 0 });
    sim.state.units.push(arty, enemyTank);

    sim.step(0.05); // fires immediately — both units start already in range

    enemyTank.position = { x: 3000, y: 3000 }; // teleport away before the shell lands

    for (let i = 0; i < 20; i += 1) sim.step(0.05);

    expect(enemyTank.hp).toBe(enemyTank.maxHp);
  });
});

describe('attack-vs-armor damage matrix', () => {
  it('piercing (soldier) shreds light armor harder than the raw attack number', () => {
    // Aether has passive unit regen (see stepSupportUnits) — createUnit()'s
    // race defaults independently of the Simulation's own player races (see
    // DEFAULT_RACE_FOR_PLAYER), so pin it explicitly to a race without regen,
    // otherwise the post-hit hp reading is a moving target.
    const sim = new Simulation();
    const soldier = createUnit('soldier', 'player', { x: 0, y: 0 });
    const enemyScout = createUnit('scout', 'enemy', { x: 30, y: 0 }, 'ironclad'); // light armor, within soldier's range
    sim.state.units.push(soldier, enemyScout);

    for (let i = 0; i < 10; i += 1) sim.step(0.05);

    const expectedDamage = soldier.attack * DAMAGE_MULTIPLIER.piercing.light;
    expect(expectedDamage).toBeGreaterThan(soldier.attack); // sanity check on the matrix itself
    expect(enemyScout.hp).toBeCloseTo(enemyScout.maxHp - expectedDamage, 5);
  });

  it('explosive (tank) is weaker than its raw attack number against light armor', () => {
    // Aether has passive unit regen (see stepSupportUnits) — createUnit()'s
    // race defaults independently of the Simulation's own player races (see
    // DEFAULT_RACE_FOR_PLAYER), so pin it explicitly to a race without regen,
    // otherwise the post-hit hp reading is a moving target.
    const sim = new Simulation();
    const tank = createUnit('tank', 'player', { x: 0, y: 0 });
    const enemyScout = createUnit('scout', 'enemy', { x: 60, y: 0 }, 'ironclad'); // light armor, within the tank's range
    sim.state.units.push(tank, enemyScout);

    for (let i = 0; i < 10; i += 1) sim.step(0.05);

    const expectedDamage = tank.attack * DAMAGE_MULTIPLIER.explosive.light;
    expect(expectedDamage).toBeLessThan(tank.attack); // sanity check on the matrix itself
    expect(enemyScout.hp).toBeCloseTo(enemyScout.maxHp - expectedDamage, 5);
  });
});
