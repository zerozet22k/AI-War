import type { Vector2 } from './game';

export type InterventionType =
  | 'attack_now'
  | 'defend_base'
  | 'retreat_all'
  | 'focus_production'
  | 'focus_gathering'
  | 'build_turret'
  | 'rally_units'
  | 'skip';

/** Which intervention types require the player to pick a point on the map. */
export const INTERVENTION_NEEDS_POSITION: Record<InterventionType, boolean> = {
  attack_now: false,
  defend_base: false,
  retreat_all: false,
  focus_production: false,
  focus_gathering: false,
  build_turret: true,
  rally_units: true,
  skip: false,
};

export interface InterventionCommand {
  type: InterventionType;
  position?: Vector2;
}

/** Sentence-case label for each intervention, used in the AI activity log
 * (e.g. "Manual command: Attack now"). */
export const INTERVENTION_LABEL: Record<InterventionType, string> = {
  attack_now: 'Attack now',
  defend_base: 'Defend the base',
  retreat_all: 'Retreat all units',
  focus_production: 'Focus unit production',
  focus_gathering: 'Focus resource gathering',
  build_turret: 'Build a turret',
  rally_units: 'Rally units',
  skip: 'Skip',
};
