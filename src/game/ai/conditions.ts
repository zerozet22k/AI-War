import type { PlayerId } from '../../types/game';
import type { Condition } from '../../types/rules';
import type { Simulation } from '../simulation/Simulation';

/** Evaluates a single safe, typed condition against the live simulation. No user code runs here. */
export function evaluateCondition(sim: Simulation, owner: PlayerId, condition: Condition): boolean {
  const v = condition.value ?? 0;
  switch (condition.type) {
    case 'resource_at_least':
      return sim.getResources(owner) >= v;
    case 'builder_count_below':
      return sim.getUnits(owner, 'builder').length < v;
    case 'soldier_count_at_least':
      return sim.getUnits(owner, 'soldier').length >= v;
    case 'enemy_detected':
      return sim.isEnemyDetected(owner);
    case 'command_center_under_attack':
      return sim.isCommandCenterUnderAttack(owner);
    case 'army_strength_at_least':
      return sim.getArmyStrength(owner) >= v;
    case 'game_time_above':
      return sim.getGameTime() > v;
    default:
      return false;
  }
}
