import type { PlayerId } from '../../types/game';
import type { ActionType, StrategyConfig } from '../../types/rules';
import type { Simulation } from '../simulation/Simulation';
import { AI_TICK_INTERVAL } from '../constants';
import { evaluateCondition } from './conditions';
import { executeAction } from './actions';

/** Minimum seconds between two executions of the same action type, so the AI
 * can't fire a rule on every single AI tick. */
const ACTION_COOLDOWNS: Record<ActionType, number> = {
  train_builder: 4,
  train_soldier: 4,
  train_scout: 4,
  train_tank: 6,
  construct_barracks: 8,
  construct_factory: 8,
  construct_turret: 8,
  gather_resources: 3,
  defend_command_center: 3,
  attack_nearest_enemy: 5,
  attack_enemy_command_center: 5,
  retreat_to_base: 3,
  scout_the_map: 6,
  rally_units: 5,
};

export interface RuleFireEvent {
  ruleId: string;
  actionType: ActionType;
  time: number;
}

/**
 * Runs one player's strategy: on a fixed interval, evaluates enabled rules
 * from highest to lowest priority and executes the action for every rule
 * whose condition is true and whose action isn't on cooldown.
 */
export class RuleEngine {
  private accumulator: number;
  private cooldownReadyAt: Partial<Record<ActionType, number>> = {};
  lastFired: RuleFireEvent[] = [];

  constructor(private readonly phaseOffset = 0) {
    this.accumulator = -phaseOffset;
  }

  update(sim: Simulation, owner: PlayerId, strategy: StrategyConfig, dt: number, suppressedActions?: ReadonlySet<ActionType>): void {
    // Cleared unconditionally so callers that read `lastFired` after every
    // update() (e.g. to log firings) only ever see the results of a tick that
    // actually ran just now, never a stale list from several calls ago.
    this.lastFired = [];

    this.accumulator += dt;
    if (this.accumulator < AI_TICK_INTERVAL) return;
    this.accumulator %= AI_TICK_INTERVAL;

    const rules = [...strategy.rules].filter((r) => r.enabled).sort((a, b) => a.priority - b.priority);
    const now = sim.getGameTime();

    for (const rule of rules) {
      if (suppressedActions?.has(rule.action.type)) continue;
      const readyAt = this.cooldownReadyAt[rule.action.type] ?? 0;
      if (now < readyAt) continue;
      if (!evaluateCondition(sim, owner, rule.condition)) continue;

      executeAction(sim, owner, rule.action);
      this.cooldownReadyAt[rule.action.type] = now + (ACTION_COOLDOWNS[rule.action.type] ?? 3);
      this.lastFired.push({ ruleId: rule.id, actionType: rule.action.type, time: now });
    }
  }

  reset(): void {
    this.accumulator = -this.phaseOffset;
    this.cooldownReadyAt = {};
    this.lastFired = [];
  }
}
