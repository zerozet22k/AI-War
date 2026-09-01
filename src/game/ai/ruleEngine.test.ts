import { describe, expect, it } from 'vitest';
import { Simulation } from '../simulation/Simulation';
import { RuleEngine } from './ruleEngine';
import type { StrategyConfig } from '../../types/rules';
import { UNIT_COSTS } from '../constants';

function strategyWith(rules: StrategyConfig['rules']): StrategyConfig {
  return { id: 's1', name: 'test', mode: 'visual', code: '', rules };
}

describe('RuleEngine', () => {
  it('evaluates enabled rules in priority order and skips disabled ones', () => {
    const sim = new Simulation();
    const engine = new RuleEngine();
    const strategy = strategyWith([
      { id: 'r-disabled', enabled: false, priority: 1, condition: { type: 'resource_at_least', value: 0 }, action: { type: 'scout_the_map' } },
      { id: 'r1', enabled: true, priority: 2, condition: { type: 'resource_at_least', value: 0 }, action: { type: 'train_builder' } },
    ]);

    sim.step(1);
    engine.update(sim, 'player', strategy, 1);

    expect(engine.lastFired.map((f) => f.ruleId)).toEqual(['r1']);
    expect(sim.getResources('player')).toBe(200 - UNIT_COSTS.builder);
  });

  it('only fires one rule per action-type cooldown window, and the higher-priority rule wins the tick it triggers on', () => {
    const sim = new Simulation();
    const engine = new RuleEngine();
    const strategy = strategyWith([
      { id: 'high', enabled: true, priority: 1, condition: { type: 'resource_at_least', value: 0 }, action: { type: 'train_builder' } },
      { id: 'low', enabled: true, priority: 2, condition: { type: 'resource_at_least', value: 0 }, action: { type: 'train_builder' } },
    ]);

    sim.step(1);
    engine.update(sim, 'player', strategy, 1);
    expect(engine.lastFired.map((f) => f.ruleId)).toEqual(['high']);

    const resourcesAfterFirstFire = sim.getResources('player');

    // Cooldown for train_builder is 4s — ticking for the next few seconds should not fire again.
    for (let i = 0; i < 3; i += 1) {
      sim.step(1);
      engine.update(sim, 'player', strategy, 1);
    }
    expect(sim.getResources('player')).toBe(resourcesAfterFirstFire);

    // Once the cooldown has elapsed, the action fires again.
    sim.step(1);
    engine.update(sim, 'player', strategy, 1);
    expect(sim.getResources('player')).toBe(resourcesAfterFirstFire - UNIT_COSTS.builder);
  });

  it('does not evaluate anything before the fixed AI tick interval has accumulated', () => {
    const sim = new Simulation();
    const engine = new RuleEngine();
    const strategy = strategyWith([
      { id: 'r1', enabled: true, priority: 1, condition: { type: 'resource_at_least', value: 0 }, action: { type: 'train_builder' } },
    ]);

    sim.step(0.4);
    engine.update(sim, 'player', strategy, 0.4);
    expect(engine.lastFired).toHaveLength(0);
    expect(sim.getResources('player')).toBe(200);
  });

  it('respects a suppressed-actions set (used by intervention overrides)', () => {
    const sim = new Simulation();
    const engine = new RuleEngine();
    const strategy = strategyWith([
      { id: 'r1', enabled: true, priority: 1, condition: { type: 'resource_at_least', value: 0 }, action: { type: 'train_builder' } },
    ]);

    sim.step(1);
    engine.update(sim, 'player', strategy, 1, new Set(['train_builder']));
    expect(engine.lastFired).toHaveLength(0);
    expect(sim.getResources('player')).toBe(200);
  });
});
