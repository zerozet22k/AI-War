import { describe, expect, it } from 'vitest';
import { Simulation } from './Simulation';
import { createUnit } from './entities';

// Each race's two signature abilities, verified for the actual mechanical
// behavior they're supposed to have — not just that they compile. See
// useUnitSkill()/dealDamage()/effectiveUnitSpeed()/attackTick() in
// Simulation.ts and the identity split in fuzzy-puzzling-plum.md.

describe('Ironclad — shieldBarrier (bastion/brace)', () => {
  it('absorbs damage before hp, then stops absorbing once depleted', () => {
    const sim = new Simulation({ player: 'ironclad', enemy: 'ironclad' });
    const bastion = createUnit('tank', 'player', { x: 0, y: 0 }, 'ironclad', 'bastion');
    sim.state.units.push(bastion);

    expect(sim.useUnitSkill('player', bastion.id, 'brace')).toBe(true);
    expect(bastion.shieldRemaining).toBeGreaterThan(0);
    const shield = bastion.shieldRemaining;
    const hpBefore = bastion.hp;

    // A hit smaller than the shield is fully absorbed.
    (sim as unknown as { dealDamage: (target: unknown, projectile: unknown) => void }).dealDamage(bastion, {
      damage: shield - 5,
      damageTypes: ['normal'],
      sourceId: 'nobody',
    });
    expect(bastion.hp).toBe(hpBefore);
    expect(bastion.shieldRemaining).toBe(5);

    // A second hit exceeding what's left spills over onto hp.
    (sim as unknown as { dealDamage: (target: unknown, projectile: unknown) => void }).dealDamage(bastion, {
      damage: 20,
      damageTypes: ['normal'],
      sourceId: 'nobody',
    });
    expect(bastion.shieldRemaining).toBe(0);
    expect(bastion.hp).toBe(hpBefore - 15);
  });
});

describe('Ironclad — stunSlam (thunderhead/siegeCalibration)', () => {
  it('locks a hit enemy out of moving and attacking for the duration', () => {
    const sim = new Simulation({ player: 'ironclad', enemy: 'ironclad' });
    const thunderhead = createUnit('artillery', 'player', { x: 0, y: 0 }, 'ironclad', 'thunderhead');
    const target = createUnit('soldier', 'enemy', { x: 30, y: 0 }, 'ironclad');
    sim.state.units.push(thunderhead, target);

    expect(sim.useUnitSkill('player', thunderhead.id, 'siegeCalibration')).toBe(true);
    expect(target.stunnedUntil).toBeGreaterThan(sim.getGameTime());

    const speed = (sim as unknown as { effectiveUnitSpeed: (u: unknown) => number }).effectiveUnitSpeed(target);
    expect(speed).toBe(0);

    target.order = { type: 'attackMove', position: { x: -100, y: 0 } };
    sim.state.units.push(createUnit('soldier', 'player', { x: 20, y: 0 }, 'ironclad'));
    sim.step(0.1);
    expect(target.position).toEqual({ x: 30, y: 0 }); // never moved
  });
});

describe('Aether — phaseCloak (wisp/phaseSkim)', () => {
  it('makes the unit unselectable as anyone\'s attack target while active', () => {
    const sim = new Simulation({ player: 'aether', enemy: 'aether' });
    // Only the wisp should be a candidate target — clear the auto-spawned
    // starting builders so they can't mask the assertion below.
    sim.state.units = [];
    const wisp = createUnit('scout', 'player', { x: 0, y: 0 }, 'aether', 'wisp');
    const enemyTank = createUnit('tank', 'enemy', { x: 30, y: 0 }, 'aether');
    sim.state.units.push(wisp, enemyTank);

    expect(sim.useUnitSkill('player', wisp.id, 'phaseSkim')).toBe(true);
    const target = (sim as unknown as { getNearestAttackableEnemy: (u: unknown) => unknown }).getNearestAttackableEnemy(enemyTank);
    expect(target).toBeUndefined();
  });
});

describe('Aether — lifeDrain (ruptor/volatileBloom)', () => {
  it('heals the attacker by a share of the damage it actually deals', () => {
    const sim = new Simulation({ player: 'aether', enemy: 'aether' });
    const ruptor = createUnit('rocketeer', 'player', { x: 0, y: 0 }, 'aether', 'ruptor');
    ruptor.hp = ruptor.maxHp - 50;
    const target = createUnit('tank', 'enemy', { x: 30, y: 0 }, 'aether');
    sim.state.units.push(ruptor, target);

    expect(sim.useUnitSkill('player', ruptor.id, 'volatileBloom')).toBe(true);
    const hpBeforeHeal = ruptor.hp;

    (sim as unknown as { dealDamage: (target: unknown, projectile: unknown) => void }).dealDamage(target, {
      damage: 40,
      damageTypes: ['normal'],
      sourceId: ruptor.id,
    });
    expect(ruptor.hp).toBeGreaterThan(hpBeforeHeal);
  });
});

describe('Nullforge — overclockSurge (sentinelDrone/clockBoost)', () => {
  it('shortens the effective attack cooldown while active', () => {
    const sim = new Simulation({ player: 'nullforge', enemy: 'nullforge' });
    const drone = createUnit('soldier', 'player', { x: 0, y: 0 }, 'nullforge', 'sentinelDrone');
    sim.state.units.push(drone);

    const baseline = (sim as unknown as { effectiveAttackCooldown: (u: unknown) => number }).effectiveAttackCooldown(drone);
    expect(sim.useUnitSkill('player', drone.id, 'clockBoost')).toBe(true);
    const boosted = (sim as unknown as { effectiveAttackCooldown: (u: unknown) => number }).effectiveAttackCooldown(drone);
    expect(boosted).toBeLessThan(baseline);
  });
});

describe('Nullforge — chainOverload (lanceMech/capacitorDump)', () => {
  it('also damages a second nearby enemy on the same hit', () => {
    const sim = new Simulation({ player: 'nullforge', enemy: 'nullforge' });
    const lanceMech = createUnit('rocketeer', 'player', { x: 0, y: 0 }, 'nullforge', 'lanceMech');
    const primary = createUnit('tank', 'enemy', { x: 30, y: 0 }, 'nullforge');
    const nearby = createUnit('soldier', 'enemy', { x: 50, y: 0 }, 'nullforge');
    sim.state.units.push(lanceMech, primary, nearby);

    expect(sim.useUnitSkill('player', lanceMech.id, 'capacitorDump')).toBe(true);
    const nearbyHpBefore = nearby.hp;

    (sim as unknown as { dealDamage: (target: unknown, projectile: unknown) => void }).dealDamage(primary, {
      damage: 30,
      damageTypes: ['normal'],
      sourceId: lanceMech.id,
    });
    expect(nearby.hp).toBeLessThan(nearbyHpBefore);
  });
});
