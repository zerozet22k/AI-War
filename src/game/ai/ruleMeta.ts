import type { ActionType } from '../../types/rules';

/** Gerund-style phrasing for the AI activity log, e.g. "Rule 2 activated: Training Soldier".
 * Also reused by the script API for the same action, so a script and a
 * visual rule read identically in the log. */
export const ACTION_LOG_LABEL: Record<ActionType, string> = {
  train_builder: 'Training Builder',
  train_soldier: 'Training Soldier',
  train_scout: 'Training Scout',
  train_tank: 'Training Tank',
  construct_barracks: 'Constructing Barracks',
  construct_factory: 'Constructing Factory',
  construct_turret: 'Constructing Turret',
  gather_resources: 'Gathering Resources',
  defend_command_center: 'Defending Command Center',
  attack_nearest_enemy: 'Attacking Nearest Enemy',
  attack_enemy_command_center: 'Attacking Enemy Command Center',
  retreat_to_base: 'Retreating to Base',
  scout_the_map: 'Scouting the Map',
  rally_units: 'Rallying Units',
};
