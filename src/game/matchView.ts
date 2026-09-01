import type { Simulation } from './simulation/Simulation';
import type { StrategyConfig } from '../types/rules';
import type { PlayerId } from '../types/game';
import type { ActivityLogEntry, MatchPhase } from './matchController';
import type { Value as ScriptValue } from './ai/script/interpreter';

/**
 * The read/command surface the renderer (MainScene) and UI (HUD, AiCodePanel)
 * actually need from a match — satisfied by both the local `MatchController`
 * (owns and steps a real Simulation) and `RemoteMatchController` (renders
 * whatever snapshot last arrived from a multiplayer server, never steps
 * anything itself). Neither the renderer nor the UI needs to know which one
 * it was handed.
 */
export interface MatchView {
  sim: Simulation;
  phase: MatchPhase;
  activityLog: ActivityLogEntry[];
  playerStrategy: StrategyConfig;
  enemyStrategy: StrategyConfig;

  update(dt: number): void;
  setCode(owner: PlayerId, code: string, hardReset?: boolean): void;
  getStrategy(owner: PlayerId): StrategyConfig;
  /** Live values of that side's running script variables — empty for a
   * 'visual' rules strategy, or (currently) for a networked match view,
   * which only ever receives code text and HUD numbers over the wire. */
  getScriptVariables(owner: PlayerId): Record<string, ScriptValue>;
  triggerFunction(owner: PlayerId, name: string): { success: boolean; message: string };
}
