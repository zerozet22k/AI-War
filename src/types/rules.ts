// Typed, JSON-compatible AI strategy rule schema. No arbitrary code execution:
// conditions and actions are a fixed, safe vocabulary the rule builder UI selects from.

export type ConditionType =
  | 'resource_at_least'
  | 'builder_count_below'
  | 'soldier_count_at_least'
  | 'enemy_detected'
  | 'command_center_under_attack'
  | 'army_strength_at_least'
  | 'game_time_above';

/** Which condition types require a numeric `value` selected by the player. */
export const CONDITION_NEEDS_VALUE: Record<ConditionType, boolean> = {
  resource_at_least: true,
  builder_count_below: true,
  soldier_count_at_least: true,
  enemy_detected: false,
  command_center_under_attack: false,
  army_strength_at_least: true,
  game_time_above: true,
};

export interface Condition {
  type: ConditionType;
  value?: number;
}

export type ActionType =
  | 'train_builder'
  | 'train_soldier'
  | 'train_scout'
  | 'train_tank'
  | 'construct_barracks'
  | 'construct_factory'
  | 'construct_turret'
  | 'gather_resources'
  | 'defend_command_center'
  | 'attack_nearest_enemy'
  | 'attack_enemy_command_center'
  | 'retreat_to_base'
  | 'scout_the_map'
  | 'rally_units';

export interface Action {
  type: ActionType;
}

export interface Rule {
  id: string;
  enabled: boolean;
  priority: number; // lower number = higher priority (1 is evaluated first)
  condition: Condition;
  action: Action;
}

export type StrategyMode = 'visual' | 'code';

export interface StrategyConfig {
  id: string;
  name: string;
  /** 'visual' (default) drives the AI from `rules`; 'code' drives it by
   * interpreting `code` as a script. Both fields are always present so
   * switching modes in the editor never loses the other representation's work. */
  mode: StrategyMode;
  rules: Rule[];
  code: string;
}
