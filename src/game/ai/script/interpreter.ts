import type { Expr, Pos, Program, Stmt } from './ast';

export type Value = number | boolean | string | Value[];
export type HostFn = (...args: Value[]) => Value;
export type Scope = Map<string, Value>;

export class ScriptRuntimeError extends Error {
  constructor(
    message: string,
    public pos: Pos,
  ) {
    super(message);
  }
}

export class StepBudgetExceededError extends Error {}
export class CallDepthExceededError extends Error {}
export class TimeBudgetExceededError extends Error {}

/** Internal control-flow signal for `return` — caught only at the boundary
 * of the function call it belongs to, never treated as a script error. */
class ReturnSignal {
  constructor(public value: Value) {}
}

const MAX_CALL_DEPTH = 100;
const ORIGIN_POS: Pos = { line: 0, col: 0 };

function truthy(v: Value): boolean {
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return v;
}

function asNumber(v: Value, pos: Pos, context: string): number {
  if (typeof v !== 'number') {
    throw new ScriptRuntimeError(`Expected a number for ${context}, got ${typeof v} (${JSON.stringify(v)})`, pos);
  }
  return v;
}

type FunctionDecl = Extract<Stmt, { kind: 'FunctionDecl' }>;

/**
 * A compiled script's live runtime state — one instance per script,
 * recreated only when the script's source changes (see ScriptEngine). Its
 * `scope` (global variables) and function table both persist across
 * separate `runProgram()` calls, which is what lets a variable hold memory
 * from one AI tick to the next, and lets `callNamed()` invoke a script's own
 * function on demand (e.g. from a keybind press) using the same state the
 * regular per-tick run left behind — not just a fresh one-off call.
 *
 * Safety: every run (`runProgram` or `callNamed`) is bounded by a step
 * budget and a call-depth limit, so a runaway `while (true) {}` or infinite
 * recursion aborts that one run with an error instead of hanging the tab.
 */
export class Interpreter {
  constructor(readonly scope: Scope = new Map()) {}

  private functions = new Map<string, FunctionDecl>();
  private steps = 0;
  private callDepth = 0;
  private maxSteps = 0;
  private api: Record<string, HostFn> = {};
  /** Absolute Date.now() deadline for the current run, or null for no
   * wall-clock limit (see tick()). Independent from maxSteps: a few steps
   * that each make an expensive host-API call can blow real time without
   * ever approaching the step count, which the step budget alone can't
   * catch. Only the networked path (see ScriptEngine.update) sets this —
   * local single-player has no other player's tick to protect. */
  private deadline: number | null = null;

  functionNames(): string[] {
    return [...this.functions.keys()];
  }

  hasFunction(name: string): boolean {
    return this.functions.has(name);
  }

  /** Runs the whole program top-to-bottom — the normal once-per-tick pass.
   * `deadlineMs`, if given, additionally bounds wall-clock time (see
   * `deadline` field) — omit it for the step-count-only budget. */
  runProgram(program: Program, api: Record<string, HostFn>, maxSteps: number, deadlineMs?: number): void {
    this.api = api;
    this.maxSteps = maxSteps;
    this.deadline = deadlineMs === undefined ? null : Date.now() + deadlineMs;
    this.steps = 0;
    this.callDepth = 0;
    this.execBlock(program.statements, null);
  }

  /** Calls a previously-registered top-level function by name — used to run
   * a script's own function outside the normal per-tick pass (e.g. a
   * keybind press), sharing this same persistent scope/function table. */
  callNamed(name: string, args: Value[], api: Record<string, HostFn>, maxSteps: number, deadlineMs?: number): Value {
    const fn = this.functions.get(name);
    if (!fn) {
      throw new ScriptRuntimeError(`No function named "${name}()" in this script`, ORIGIN_POS);
    }
    this.api = api;
    this.maxSteps = maxSteps;
    this.deadline = deadlineMs === undefined ? null : Date.now() + deadlineMs;
    this.steps = 0;
    this.callDepth = 0;
    return this.callUserFunction(fn, args);
  }

  private tick(): void {
    this.steps += 1;
    if (this.steps > this.maxSteps) {
      throw new StepBudgetExceededError('Script exceeded its step budget (likely an infinite loop) — this run was aborted');
    }
    // Checked every 64 steps, not every step — Date.now() is comparatively
    // expensive to call on every single AST node visited, and the step
    // cadence already bounds how far a single overshoot between checks can go.
    if (this.deadline !== null && (this.steps & 0x3f) === 0 && Date.now() > this.deadline) {
      throw new TimeBudgetExceededError('Script exceeded its per-tick time budget — aborted to keep the match responsive for other players');
    }
  }

  private resolveScope(name: string, locals: Scope | null): Scope | null {
    if (locals?.has(name)) return locals;
    if (this.scope.has(name)) return this.scope;
    return null;
  }

  private execBlock(statements: Stmt[], locals: Scope | null): void {
    for (const stmt of statements) this.execStmt(stmt, locals);
  }

  private execStmt(stmt: Stmt, locals: Scope | null): void {
    this.tick();
    switch (stmt.kind) {
      case 'VarDecl': {
        // The whole script re-runs from the top every AI tick, and each
        // scope frame (global, or one function call) is the only place a
        // given "let" ever writes — so "let" only initializes a variable
        // the first time *that frame* reaches it and is a no-op after that.
        // That's what lets a global variable act as persistent memory across
        // ticks. Use plain assignment (`x = ...;`) to change an existing
        // variable's value, including to reset one back to a starting value.
        const target = locals ?? this.scope;
        if (!target.has(stmt.name)) {
          target.set(stmt.name, stmt.init ? this.evalExpr(stmt.init, locals) : 0);
        }
        return;
      }
      case 'Assign': {
        const target = this.resolveScope(stmt.name, locals);
        if (!target) {
          throw new ScriptRuntimeError(`Unknown variable "${stmt.name}" — declare it with "let" first`, stmt.pos);
        }
        target.set(stmt.name, this.evalExpr(stmt.value, locals));
        return;
      }
      case 'IndexAssign': {
        const arr = this.evalArrayTarget(stmt.array, locals);
        const index = this.evalArrayIndex(stmt.index, locals);
        const value = this.evalExpr(stmt.value, locals);
        // Writing exactly at the current length appends (same as push);
        // anything further out is almost certainly a script bug, not an
        // intentional sparse array, so it's rejected rather than silently
        // leaving a hole no read could ever have produced.
        if (index > arr.length) {
          throw new ScriptRuntimeError(`Array index ${index} out of range (length ${arr.length})`, stmt.pos);
        }
        arr[index] = value;
        return;
      }
      case 'If':
        if (truthy(this.evalExpr(stmt.test, locals))) this.execBlock(stmt.thenBranch, locals);
        else if (stmt.elseBranch) this.execBlock(stmt.elseBranch, locals);
        return;
      case 'While':
        while (truthy(this.evalExpr(stmt.test, locals))) {
          this.tick();
          this.execBlock(stmt.body, locals);
        }
        return;
      case 'ExprStmt':
        this.evalExpr(stmt.expr, locals);
        return;
      case 'ForEach': {
        const list = this.evalExpr(stmt.iterable, locals);
        if (!Array.isArray(list)) {
          throw new ScriptRuntimeError(`"for (${stmt.itemName} in ...)" needs a list — got ${typeof list}`, stmt.pos);
        }
        const target = locals ?? this.scope;
        for (const item of list) {
          this.tick();
          target.set(stmt.itemName, item); // rebinds fresh every iteration, no "declare once" rule here
          this.execBlock(stmt.body, locals);
        }
        return;
      }
      case 'FunctionDecl':
        this.functions.set(stmt.name, stmt);
        return;
      case 'Return':
        if (this.callDepth === 0) {
          throw new ScriptRuntimeError('"return" used outside of a function', stmt.pos);
        }
        throw new ReturnSignal(stmt.value ? this.evalExpr(stmt.value, locals) : 0);
    }
  }

  private callUserFunction(fn: FunctionDecl, args: Value[]): Value {
    this.callDepth += 1;
    if (this.callDepth > MAX_CALL_DEPTH) {
      this.callDepth -= 1;
      throw new CallDepthExceededError(`Call depth exceeded ${MAX_CALL_DEPTH} — likely unbounded recursion in "${fn.name}()"`);
    }
    const localScope: Scope = new Map();
    fn.params.forEach((param, i) => localScope.set(param, args[i] ?? 0));
    try {
      this.execBlock(fn.body, localScope);
      return 0; // no explicit "return" — falls through with a default value
    } catch (signal) {
      if (signal instanceof ReturnSignal) return signal.value;
      throw signal;
    } finally {
      this.callDepth -= 1;
    }
  }

  private evalArrayTarget(expr: Expr, locals: Scope | null): Value[] {
    const arr = this.evalExpr(expr, locals);
    if (!Array.isArray(arr)) {
      throw new ScriptRuntimeError(`Expected a list to index, got ${typeof arr} (${JSON.stringify(arr)})`, expr.pos);
    }
    return arr;
  }

  private evalArrayIndex(expr: Expr, locals: Scope | null): number {
    const i = asNumber(this.evalExpr(expr, locals), expr.pos, 'array index');
    if (!Number.isInteger(i) || i < 0) {
      throw new ScriptRuntimeError(`Array index must be a non-negative whole number, got ${i}`, expr.pos);
    }
    return i;
  }

  private evalExpr(expr: Expr, locals: Scope | null): Value {
    this.tick();
    switch (expr.kind) {
      case 'Number':
      case 'String':
      case 'Bool':
        return expr.value;

      case 'Ident': {
        const target = this.resolveScope(expr.name, locals);
        if (!target) {
          throw new ScriptRuntimeError(`Unknown variable "${expr.name}"`, expr.pos);
        }
        return target.get(expr.name)!;
      }

      case 'Call': {
        const args = expr.args.map((a) => this.evalExpr(a, locals));
        const userFn = this.functions.get(expr.callee);
        if (userFn) return this.callUserFunction(userFn, args);
        const hostFn = this.api[expr.callee];
        if (!hostFn) {
          throw new ScriptRuntimeError(`Unknown function "${expr.callee}()"`, expr.pos);
        }
        return hostFn(...args);
      }

      case 'Unary': {
        const v = this.evalExpr(expr.expr, locals);
        if (expr.op === '!') return !truthy(v);
        return -asNumber(v, expr.pos, 'unary "-"');
      }

      case 'Binary': {
        const left = this.evalExpr(expr.left, locals);
        const right = this.evalExpr(expr.right, locals);
        switch (expr.op) {
          case '+':
            if (typeof left === 'string' || typeof right === 'string') return `${left}${right}`;
            return asNumber(left, expr.pos, '"+"') + asNumber(right, expr.pos, '"+"');
          case '-':
            return asNumber(left, expr.pos, '"-"') - asNumber(right, expr.pos, '"-"');
          case '*':
            return asNumber(left, expr.pos, '"*"') * asNumber(right, expr.pos, '"*"');
          case '/':
            return asNumber(left, expr.pos, '"/"') / asNumber(right, expr.pos, '"/"');
          case '%':
            return asNumber(left, expr.pos, '"%"') % asNumber(right, expr.pos, '"%"');
          case '==':
            return left === right;
          case '!=':
            return left !== right;
          case '<':
            return asNumber(left, expr.pos, '"<"') < asNumber(right, expr.pos, '"<"');
          case '<=':
            return asNumber(left, expr.pos, '"<="') <= asNumber(right, expr.pos, '"<="');
          case '>':
            return asNumber(left, expr.pos, '">"') > asNumber(right, expr.pos, '">"');
          case '>=':
            return asNumber(left, expr.pos, '">="') >= asNumber(right, expr.pos, '">="');
        }
        break;
      }

      case 'Logical': {
        const left = this.evalExpr(expr.left, locals);
        if (expr.op === '&&') return truthy(left) ? this.evalExpr(expr.right, locals) : left;
        return truthy(left) ? left : this.evalExpr(expr.right, locals);
      }

      case 'ArrayLiteral':
        return expr.elements.map((element) => this.evalExpr(element, locals));

      case 'Index': {
        const arr = this.evalArrayTarget(expr.array, locals);
        const index = this.evalArrayIndex(expr.index, locals);
        if (index >= arr.length) {
          throw new ScriptRuntimeError(`Array index ${index} out of range (length ${arr.length})`, expr.pos);
        }
        return arr[index];
      }
    }
    throw new ScriptRuntimeError('Unreachable expression kind', (expr as Expr).pos);
  }
}

/** Backward-compatible one-shot entry point used by small config scripts.
 * Stateful callers should keep an Interpreter instance instead. */
export function runProgram(program: Program, scope: Scope, api: Record<string, HostFn>, maxSteps: number): void {
  new Interpreter(scope).runProgram(program, api, maxSteps);
}
