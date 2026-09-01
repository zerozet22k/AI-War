import type { PlayerId } from '../../../types/game';
import type { StrategyConfig } from '../../../types/rules';
import type { Simulation } from '../../simulation/Simulation';
import { AI_TICK_INTERVAL } from '../../constants';
import { buildScriptApi } from './api';
import type { Program } from './ast';
import { compile } from './compiler';
import type { ScriptError } from './errors';
import { CallDepthExceededError, Interpreter, ScriptRuntimeError, StepBudgetExceededError, type Value } from './interpreter';

// This is only a runaway-script fuse, not a competitive execution quota.
// A large doctrine can inspect sizeable armies and resource networks without
// being penalized, while an accidental infinite loop still cannot hang the UI.
const MAX_STEPS_PER_TICK = 100_000;

export interface ScriptEvent {
  kind: 'action' | 'log' | 'error';
  text: string;
}

/**
 * Runs a script-mode StrategyConfig on the fixed AI tick cadence. Variables
 * declared at the top level of the script persist
 * across ticks — the script re-runs from the top every tick, so persistent
 * state has to be read back from a variable rather than relying on paused
 * execution. Also supports calling one of the script's own functions
 * on-demand (triggerFunction) — e.g. from a keybind press — sharing the
 * same persistent Interpreter state the regular per-tick run uses.
 */
export class ScriptEngine {
  private accumulator: number;
  private compiledSource: string | null = null;
  private program: Program | null = null;
  private interpreter = new Interpreter();
  private lastLoggedError: string | null = null;
  compileErrors: ScriptError[] = [];

  constructor(private readonly phaseOffset = 0) {
    this.accumulator = -phaseOffset;
  }

  /** Names of top-level functions the current script has defined so far —
   * used to validate a keybind's target before/at trigger time. */
  functionNames(): string[] {
    return this.interpreter.functionNames();
  }

  /** A live snapshot of every top-level `let` variable's current value —
   * the same persistent memory the script itself reads back each tick (see
   * the class doc above). Used to show the running AI's actual state next
   * to the code that declares it, instead of just the source text. */
  variables(): Record<string, Value> {
    return Object.fromEntries(this.interpreter.scope);
  }

  update(sim: Simulation, owner: PlayerId, strategy: StrategyConfig, dt: number): ScriptEvent[] {
    if (strategy.code !== this.compiledSource) {
      this.recompile(strategy.code);
    }

    this.accumulator += dt;
    if (this.accumulator < AI_TICK_INTERVAL) return [];
    // A delayed render frame does not require replaying stale decisions on
    // several consecutive frames; evaluate the latest state once and discard
    // missed strategic ticks.
    this.accumulator %= AI_TICK_INTERVAL;

    if (!this.program) {
      if (this.compileErrors.length === 0) return [];
      const first = this.compileErrors[0];
      const message = `Script did not compile (line ${first.line}): ${first.message}`;
      return this.reportErrorOnce(message);
    }

    const events: ScriptEvent[] = [];
    const api = buildScriptApi({
      sim,
      owner,
      onAction: (label) => events.push({ kind: 'action', text: label }),
      onLog: (message) => events.push({ kind: 'log', text: message }),
    });

    try {
      this.interpreter.runProgram(this.program, api, MAX_STEPS_PER_TICK);
      this.lastLoggedError = null;
      return events;
    } catch (err) {
      return [...events, ...this.reportErrorOnce(this.describeError(err))];
    }
  }

  /** Runs one of the script's own top-level functions immediately, outside
   * the normal per-tick pass — e.g. because the player pressed a bound key.
   * Always reports its own errors (no dedup — a keypress is a deliberate,
   * one-off action, not a recurring per-tick check). */
  triggerFunction(sim: Simulation, owner: PlayerId, name: string): ScriptEvent[] {
    if (!this.program) {
      return [{ kind: 'error', text: `Can't run "${name}()" — your script doesn't compile.` }];
    }
    if (!this.interpreter.hasFunction(name)) {
      return [{ kind: 'error', text: `No function named "${name}()" in your script.` }];
    }

    const events: ScriptEvent[] = [];
    const api = buildScriptApi({
      sim,
      owner,
      onAction: (label) => events.push({ kind: 'action', text: label }),
      onLog: (message) => events.push({ kind: 'log', text: message }),
    });

    try {
      this.interpreter.callNamed(name, [], api, MAX_STEPS_PER_TICK);
      return events;
    } catch (err) {
      return [...events, { kind: 'error', text: this.describeError(err) }];
    }
  }

  private describeError(err: unknown): string {
    if (err instanceof ScriptRuntimeError) return `Script error (line ${err.pos.line}): ${err.message}`;
    if (err instanceof StepBudgetExceededError || err instanceof CallDepthExceededError) return `Script error: ${err.message}`;
    return `Script error: ${(err as Error).message}`;
  }

  /** Reports each distinct error message once, not every tick it recurs, so a
   * persistent bug doesn't flood the activity log every AI tick forever. */
  private reportErrorOnce(message: string): ScriptEvent[] {
    if (message === this.lastLoggedError) return [];
    this.lastLoggedError = message;
    return [{ kind: 'error', text: message }];
  }

  /** Recompiles on every source change, including live edits mid-match —
   * deliberately does NOT touch `this.interpreter`. Its persistent `let`
   * memory (phase, timers, counters) would otherwise be wiped by every
   * single keystroke while editing, since typing changes `strategy.code`
   * on each character and update() recompiles whenever it no longer
   * matches. A `let` is a no-op once its name already exists in scope (see
   * interpreter.ts), so keeping the same interpreter across a recompile
   * just picks up the edited code with prior memory intact — exactly the
   * same "persists across ticks" rule extended to "persists across edits."
   * Function bodies still update immediately: runProgram re-registers every
   * FunctionDecl from the top each tick regardless. Use reset() instead for
   * an actual clean slate (new match, or a deliberate "reset AI" action). */
  private recompile(source: string): void {
    this.compiledSource = source;
    const result = compile(source);
    this.program = result.errors.length === 0 ? result.program : null;
    this.compileErrors = result.errors;
    this.lastLoggedError = null;
  }

  reset(): void {
    this.accumulator = -this.phaseOffset;
    this.interpreter = new Interpreter();
    this.lastLoggedError = null;
  }
}
