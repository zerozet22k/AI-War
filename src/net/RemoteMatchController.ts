import { Simulation } from '../game/simulation/Simulation';
import type { ActivityLogEntry, MatchPhase } from '../game/matchController';
import type { MatchView } from '../game/matchView';
import { PLAYER_ID_LIST, type PlayerId } from '../types/game';
import type { StrategyConfig } from '../types/rules';
import type { MultiplayerClient } from './MultiplayerClient';
import type { SnapshotPayload } from './protocol';

/**
 * The client-side half of a networked match. Implements the same MatchView
 * surface MainScene/HUD/AiCodePanel already read from a local
 * MatchController, but never simulates anything itself — `update()` is a
 * no-op, and `applySnapshot()` (called whenever a `snapshot` message
 * arrives) overwrites `sim.state` wholesale. Reusing a real Simulation
 * instance purely as a state holder means every one of its existing query
 * methods (getResources, getUnits, getStats, isValidBuildPosition, ...)
 * keeps working unchanged — nothing needed reimplementing.
 */
export class RemoteMatchController implements MatchView {
  sim = new Simulation();
  phase: MatchPhase = 'running';
  activityLog: ActivityLogEntry[] = [];
  playerStrategy: StrategyConfig;
  enemyStrategy: StrategyConfig;
  readonly strategies: Record<PlayerId, StrategyConfig>;

  constructor(
    private client: MultiplayerClient,
    /** Which side this browser is playing — the server always treats the
     * room's host as 'player' and the guest as 'enemy'. */
    readonly side: PlayerId,
    /** Seeds `playerStrategy.code` immediately with what you already typed
     * locally, so "Your Code" doesn't flash empty while waiting for the
     * server's first snapshot to echo it back. */
    initialPlayerCode: string,
  ) {
    this.strategies = Object.fromEntries(PLAYER_ID_LIST.map((owner) => [owner, {
      id: `remote-${owner}`,
      name: owner === side ? 'You' : owner,
      mode: 'code' as const,
      code: owner === side ? initialPlayerCode : '',
      rules: [],
    }])) as unknown as Record<PlayerId, StrategyConfig>;
    this.playerStrategy = this.strategies.player;
    this.enemyStrategy = this.strategies.enemy;
  }

  applySnapshot(payload: SnapshotPayload): void {
    this.sim.state = payload.sim;
    this.phase = payload.phase;
    this.activityLog = payload.activityLog;
    for (const owner of PLAYER_ID_LIST) this.strategies[owner].code = payload.codes[owner] ?? '';
  }

  /** No-op: state only ever changes when a snapshot arrives over the wire. */
  update(_dt: number): void {}

  setCode(owner: PlayerId, code: string): void {
    if (owner !== this.side) return; // can't edit the opponent's code from here
    this.client.send({ type: 'code_update', code });
  }

  getStrategy(owner: PlayerId): StrategyConfig {
    return this.strategies[owner];
  }

  /** The server runs the actual script; nothing about its live variable
   * state reaches this client today, so there's nothing to show yet. */
  getScriptVariables(): Record<string, never> {
    return {};
  }

  triggerFunction(owner: PlayerId, name: string): { success: boolean; message: string } {
    if (owner !== this.side) return { success: false, message: "That's not your side." };
    this.client.send({ type: 'trigger_function', name });
    return { success: true, message: `${name}() sent.` };
  }
}
