import { PLAYER_ID_LIST, type PlayerId, type RaceId, type SimState } from '../types/game';
import type { StrategyConfig } from '../types/rules';
import { Simulation } from './simulation/Simulation';
import { RuleEngine, type RuleFireEvent } from './ai/ruleEngine';
import { ACTION_LOG_LABEL } from './ai/ruleMeta';
import { ScriptEngine, type ScriptEvent } from './ai/script/ScriptEngine';
import type { Value as ScriptValue } from './ai/script/interpreter';
import type { MatchView } from './matchView';
import type { MapId } from './maps';
import { AI_TICK_INTERVAL } from './constants';
import { recordMatchResult } from './ai/matchMemory';
import type { AiDifficulty } from './ai/strategies';

export type MatchPhase = 'running' | 'ended';

export interface MatchControllerOptions {
  playerStrategy: StrategyConfig;
  enemyStrategy: StrategyConfig;
  races?: Partial<Record<PlayerId, RaceId>>;
  mapId?: MapId;
  activePlayers?: PlayerId[];
  strategies?: Partial<Record<PlayerId, StrategyConfig>>;
  /** Per-seat display name/team/color chosen in the lobby — see
   * PlayerState in types/game.ts. Team assignment is optional: an
   * unspecified seat defaults to its own distinct team (plain FFA). */
  lobby?: Partial<Record<PlayerId, { name?: string; team?: number; color?: number }>>;
  /** Tags any match-history record this match produces (see recordLocalMatchHistory).
   * Not known from sim/strategy state alone — it's a UI-level setting. */
  aiDifficulty?: AiDifficulty;
  /** Local single-player only: records this match's outcome to the "player"
   * seat's persistent match history when it ends (see game/ai/matchMemory.ts),
   * so a script can read past-match stats via winRate() etc. Networked
   * matches don't set this — recording your own outcome from a guest's view
   * of someone else's simulation isn't meaningful. */
  recordHistoryForPlayer?: boolean;
  /** Additional wall-clock cap (ms) on each script's per-tick run, on top of
   * the step-count budget — see ScriptEngine.update()/Interpreter.deadline.
   * Set this for a networked match: up to PLAYER_ID_LIST.length players'
   * scripts run sequentially on one thread there, so one occasional
   * expensive-but-legitimate tick (the step budget alone doesn't catch this
   * — see MAX_STEPS_PER_TICK in ScriptEngine.ts) delays every other player
   * in the room, not just its own owner. Leave unset for local single-player,
   * which has no other player's tick to protect. */
  scriptTimeBudgetMs?: number;
  /** Resumes a previously-saved match (see game/saveGame.ts) instead of
   * starting fresh — `simState` seeds the Simulation itself, `phase`/
   * `activityLog` restore this controller's own bookkeeping. Every AI
   * engine's persistent script/rule memory still starts clean, same
   * limitation as Simulation's own resumeState param. */
  resume?: {
    simState: SimState;
    phase: MatchPhase;
    activityLog: ActivityLogEntry[];
  };
}

export interface ActivityLogEntry {
  time: number;
  message: string;
}

const MAX_LOG_ENTRIES = 60;

/**
 * Owns the Simulation plus the two AI engines and drives a continuous
 * AI-vs-AI (or AI-vs-human-scripted) match — no periodic pause, both sides
 * run their script/rules the whole time. Framework agnostic: Phaser and
 * React both just call `update(dt)` and read state off it.
 */
export class MatchController implements MatchView {
  sim: Simulation;
  phase: MatchPhase = 'running';
  activityLog: ActivityLogEntry[] = [];

  playerStrategy: StrategyConfig;
  enemyStrategy: StrategyConfig;
  readonly strategies: Record<PlayerId, StrategyConfig>;
  private readonly aiDifficulty: AiDifficulty | null;
  private readonly recordHistoryForPlayer: boolean;
  private readonly scriptTimeBudgetMs: number | undefined;
  private rules = Object.fromEntries(PLAYER_ID_LIST.map((owner, index) => [
    owner,
    new RuleEngine((index * AI_TICK_INTERVAL) / PLAYER_ID_LIST.length),
  ])) as Record<PlayerId, RuleEngine>;
  private scripts = Object.fromEntries(PLAYER_ID_LIST.map((owner, index) => [
    owner,
    new ScriptEngine((index * AI_TICK_INTERVAL) / PLAYER_ID_LIST.length),
  ])) as Record<PlayerId, ScriptEngine>;

  constructor(options: MatchControllerOptions) {
    this.sim = new Simulation(options.races, options.mapId, options.activePlayers, true, options.lobby, options.resume?.simState);
    this.strategies = Object.fromEntries(PLAYER_ID_LIST.map((owner) => [
      owner,
      options.strategies?.[owner] ?? (owner === 'player' ? options.playerStrategy : options.enemyStrategy),
    ])) as Record<PlayerId, StrategyConfig>;
    this.playerStrategy = this.strategies.player;
    this.enemyStrategy = this.strategies.enemy;
    this.aiDifficulty = options.aiDifficulty ?? null;
    this.recordHistoryForPlayer = options.recordHistoryForPlayer ?? false;
    this.scriptTimeBudgetMs = options.scriptTimeBudgetMs;
    if (options.resume) {
      this.phase = options.resume.phase;
      this.activityLog = options.resume.activityLog;
    }
  }

  update(dt: number): void {
    if (this.phase === 'ended') return;

    this.sim.step(dt);
    if (this.sim.state.matchResult) {
      this.phase = 'ended';
      if (this.recordHistoryForPlayer) this.recordPlayerMatchHistory();
      return;
    }

    for (const owner of this.sim.state.activePlayers) {
      const strategy = this.strategies[owner];
      this.runAi(owner, strategy, this.rules[owner], this.scripts[owner], dt, owner === 'player' ? '' : `${strategy.name} — `);
    }
  }

  /** Live-edits one side's AI code (always mode: 'code') — the one entry
   * point both the local AiCodePanel and a networked client's code_update
   * message use, so hot-reload works identically either way. ScriptEngine
   * already recompiles whenever `strategy.code` changes; this just mutates
   * the strategy object it reads from. Its persistent `let` state survives
   * a normal edit (see ScriptEngine.recompile) — pass `hardReset: true` for
   * a deliberate clean slate instead, e.g. the "Reset to default AI" button
   * swapping in an unrelated script rather than tweaking the current one. */
  setCode(owner: PlayerId, code: string, hardReset = false): void {
    const strategy = this.strategies[owner];
    strategy.mode = 'code';
    strategy.code = code;
    if (hardReset) this.scripts[owner].reset();
  }

  /** Runs one of that side's own script functions right now — e.g. because
   * the player pressed a bound key — outside the normal fixed AI
   * tick, sharing the same persistent script state that tick uses. Only
   * meaningful in code mode; a visual-rules strategy has no functions to call. */
  triggerFunction(owner: PlayerId, name: string): { success: boolean; message: string } {
    const strategy = this.strategies[owner];
    const script = this.scripts[owner];
    const prefix = owner === 'player' ? '' : `${strategy.name} — `;

    if (strategy.mode !== 'code') {
      return { success: false, message: 'This strategy is not in code mode.' };
    }

    const events = script.triggerFunction(this.sim, owner, name, this.scriptTimeBudgetMs);
    this.logScriptEvents(events, prefix);
    const error = events.find((e) => e.kind === 'error');
    return error ? { success: false, message: error.text } : { success: true, message: `${name}() ran.` };
  }

  getStrategy(owner: PlayerId): StrategyConfig {
    return this.strategies[owner];
  }

  /** Live values of that side's script variables — empty for a 'visual'
   * rules strategy, which has no variables to show. */
  getScriptVariables(owner: PlayerId): Record<string, ScriptValue> {
    return this.scripts[owner].variables();
  }

  /** Runs whichever AI engine matches the strategy's mode ('visual' rules or
   * 'code' script) and logs whatever it did this tick. */
  private runAi(owner: PlayerId, strategy: StrategyConfig, ruleEngine: RuleEngine, scriptEngine: ScriptEngine, dt: number, prefix: string): void {
    if (strategy.mode === 'code') {
      const events = scriptEngine.update(this.sim, owner, strategy, dt, this.scriptTimeBudgetMs);
      this.logScriptEvents(events, prefix);
    } else {
      ruleEngine.update(this.sim, owner, strategy, dt);
      this.logRuleFirings(ruleEngine.lastFired, strategy, prefix);
    }
  }

  private logRuleFirings(fired: RuleFireEvent[], strategy: StrategyConfig, prefix: string): void {
    for (const fire of fired) {
      const index = strategy.rules.findIndex((r) => r.id === fire.ruleId);
      const label = ACTION_LOG_LABEL[fire.actionType] ?? fire.actionType;
      this.pushLog(`${prefix}Rule ${index + 1} activated: ${label}`);
    }
  }

  private logScriptEvents(events: ScriptEvent[], prefix: string): void {
    for (const event of events) {
      if (event.kind === 'action') this.pushLog(`${prefix}Script activated: ${event.text}`);
      else if (event.kind === 'log') this.pushLog(`${prefix}Script log: ${event.text}`);
      else this.pushLog(`${prefix}${event.text}`);
    }
  }

  private pushLog(message: string): void {
    this.activityLog.push({ time: this.sim.getGameTime(), message });
    if (this.activityLog.length > MAX_LOG_ENTRIES) {
      this.activityLog.splice(0, this.activityLog.length - MAX_LOG_ENTRIES);
    }
  }

  /** Records this finished match to the "player" seat's persistent history
   * (see game/ai/matchMemory.ts) so a script's winRate()/lastMatchWon()/etc.
   * reflect it in future matches. Only meaningful for a 1-on-1 local match —
   * skipped (via recordHistoryForPlayer) for networked play, where "player"
   * isn't necessarily this browser's side. */
  private recordPlayerMatchHistory(): void {
    const result = this.sim.state.matchResult;
    if (!result || !this.sim.state.activePlayers.includes('player')) return;

    const outcome = result.winners.includes('player') ? 'win' : result.winners.length === 0 ? 'draw' : 'loss';
    const stats = this.sim.state.stats.player;
    recordMatchResult({
      race: this.sim.state.players.player.race,
      opponentRace: this.sim.state.players.enemy.race,
      outcome,
      durationSeconds: this.sim.getGameTime(),
      difficulty: this.aiDifficulty,
      timestamp: Date.now(),
      unitsCreated: stats.unitsCreated,
      unitsLost: stats.unitsLost,
      resourcesGathered: stats.resourcesGathered,
      buildingsConstructed: stats.buildingsConstructed,
    });
  }
}
