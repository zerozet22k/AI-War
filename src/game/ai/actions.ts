import type { PlayerId } from '../../types/game';
import type { Action } from '../../types/rules';
import type { Simulation } from '../simulation/Simulation';

/** Executes a single safe, typed action against the live simulation. No user code runs here. */
export function executeAction(sim: Simulation, owner: PlayerId, action: Action): void {
  switch (action.type) {
    case 'train_builder':
      sim.trainUnit(owner, 'builder');
      break;
    case 'train_soldier':
      sim.trainUnit(owner, 'soldier');
      break;
    case 'train_scout':
      sim.trainUnit(owner, 'scout');
      break;
    case 'train_tank':
      sim.trainUnit(owner, 'tank');
      break;
    case 'construct_barracks':
      sim.constructBuilding(owner, 'barracks');
      break;
    case 'construct_factory':
      sim.constructBuilding(owner, 'factory');
      break;
    case 'construct_turret':
      sim.constructBuilding(owner, 'turret');
      break;
    case 'gather_resources':
      sim.orderGatherResources(owner);
      break;
    case 'defend_command_center':
      sim.orderDefendCommandCenter(owner);
      break;
    case 'attack_nearest_enemy':
      sim.orderAttackNearestEnemy(owner);
      break;
    case 'attack_enemy_command_center':
      sim.orderAttackEnemyCommandCenter(owner);
      break;
    case 'retreat_to_base':
      sim.orderRetreatToBase(owner);
      break;
    case 'scout_the_map':
      sim.orderScoutMap(owner);
      break;
    case 'rally_units':
      // No position is available on a visual Rule — rallying to a specific
      // point is script/intervention-only (see api.ts's rallyAt and
      // interventions.ts's rally_units command).
      break;
    default:
      break;
  }
}
