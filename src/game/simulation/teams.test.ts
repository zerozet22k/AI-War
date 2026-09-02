import { describe, expect, it } from 'vitest';
import { Simulation } from './Simulation';
import { createUnit } from './entities';

// Team assignment is optional (see PlayerState.team) — every slot defaults
// to its own distinct number (plain free-for-all, covered by the rest of
// the suite staying green with no lobby config at all). These tests cover
// what changes once a lobby explicitly puts two slots on the same team.

function teamedSim() {
  return new Simulation(undefined, undefined, ['player', 'enemy', 'player3', 'player4'], false, {
    player: { team: 1 },
    player3: { team: 1 }, // player and player3 are allies
    enemy: { team: 2 },
    player4: { team: 2 }, // enemy and player4 are allies
  });
}

describe('teams — hostility and targeting', () => {
  it('never lets a unit target a teammate, even by explicit id', () => {
    const sim = teamedSim();
    const mine = createUnit('soldier', 'player', { x: 0, y: 0 });
    const allyUnit = createUnit('soldier', 'player3', { x: 30, y: 0 });
    sim.state.units.push(mine, allyUnit);

    expect(sim.orderUnitAttackTarget('player', mine.id, allyUnit.id)).toBe(false);
    expect(mine.order.type).not.toBe('attackTarget');
  });

  it('opponentPlayers()/enemyEntities() exclude teammates but include the other team', () => {
    const sim = teamedSim();
    expect(sim.opponentPlayers('player').sort()).toEqual(['enemy', 'player4']);
    expect(sim.teammatesOf('player')).toEqual(['player3']);
  });
});

describe('teams — shared vision', () => {
  it('lets a teammate see through an ally\'s scout even with no vision of their own', () => {
    const sim = teamedSim();
    // Clear every starting unit so only the ally's scout can grant vision.
    sim.state.units = [];
    const allyScout = createUnit('scout', 'player3', { x: 500, y: 500 });
    sim.state.units.push(allyScout);

    // 'player' has no unit anywhere near this point — only its teammate does.
    expect(sim.isPositionVisibleTo('player', { x: 500, y: 500 })).toBe(true);
    // The other team, with nothing nearby either, still can't see it.
    expect(sim.isPositionVisibleTo('enemy', { x: 500, y: 500 })).toBe(false);
  });
});

describe('teams — win condition', () => {
  it('keeps the match alive while any teammate still has a building standing', () => {
    const sim = teamedSim();
    // Eliminate 'player' alone — its teammate player3 is still alive.
    for (const b of sim.getBuildings('player')) b.hp = 0;
    sim.step(0.1);
    expect(sim.state.matchResult).toBeNull();
  });

  it('declares every member of the last surviving team the winner', () => {
    const sim = teamedSim();
    for (const b of sim.getBuildings('enemy')) b.hp = 0;
    for (const b of sim.getBuildings('player4')) b.hp = 0;
    sim.step(0.1);
    expect(sim.state.matchResult).not.toBeNull();
    expect(sim.state.matchResult?.winners.sort()).toEqual(['player', 'player3']);
  });
});
