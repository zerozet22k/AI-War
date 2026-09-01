import { compile } from '../game/ai/script/compiler';
import type { ScriptError } from '../game/ai/script/errors';
import { Interpreter, type Value } from '../game/ai/script/interpreter';

/** Bindable actions that aren't a script function call — everything else
 * passed to bind(key, action) is treated as the name of a function your own
 * AI script defines, validated only when the key is actually pressed (the
 * keybind script compiles independently of whatever AI script happens to be
 * loaded, so there's nothing to check ahead of time). */
const RESERVED_UI_ACTIONS = new Set(['toggle_settings', 'toggle_strategy_editor']);

const MAX_STEPS = 500;

/** "1" -> "Digit1", "k" -> "KeyK", plus a few named keys — the small,
 * human-friendly vocabulary a bindings script writes, mapped to the
 * KeyboardEvent.code values the match screen's keydown handler compares against. */
export function normalizeKeyName(name: string): string | null {
  const s = name.trim().toLowerCase();
  if (/^[0-9]$/.test(s)) return `Digit${s}`;
  if (/^[a-z]$/.test(s)) return `Key${s.toUpperCase()}`;
  if (s === 'space') return 'Space';
  if (s === 'enter' || s === 'return') return 'Enter';
  if (s === 'tab') return 'Tab';
  // Escape is reserved for the match screen's pause menu and can't be
  // rebound to anything else — not in this list on purpose.
  return null;
}

export interface KeybindCompileResult {
  /** Normalized key code -> action id (a reserved UI action, or a script
   * function name), e.g. { Digit1: "rush" }. */
  bindings: Record<string, string>;
  errors: ScriptError[];
}

/**
 * Compiles and runs a bindings script exactly once (not per-tick, unlike an
 * AI strategy script) with a single host function, `bind(key, action)`.
 * Reuses the same lexer/parser/interpreter as the AI language — keybinds are
 * config, but they're still "code," per the same safety model (no eval,
 * bounded step budget).
 */
export function compileKeybinds(source: string): KeybindCompileResult {
  const { program, errors } = compile(source);
  if (errors.length > 0 || !program) return { bindings: {}, errors };

  const bindings: Record<string, string> = {};
  const api = {
    bind: (key: Value, action: Value): Value => {
      if (typeof key !== 'string' || typeof action !== 'string') {
        throw new Error('bind(key, action) expects two string arguments');
      }
      const code = normalizeKeyName(key);
      if (!code) throw new Error(`Unknown key name "${key}" — use "0"-"9", "a"-"z", "space", "escape", "enter", or "tab"`);
      bindings[code] = action;
      return true;
    },
  };

  try {
    new Interpreter().runProgram(program, api, MAX_STEPS);
    return { bindings, errors: [] };
  } catch (err) {
    return { bindings, errors: [{ message: (err as Error).message ?? 'Unknown error', line: 1, col: 1 }] };
  }
}

export function isReservedUiAction(action: string): boolean {
  return RESERVED_UI_ACTIONS.has(action);
}

export const DEFAULT_KEYBIND_SCRIPT = `// Bind a key to any function YOUR AI script defines — e.g. if your script
// has "function rush() { ... }", pressing "1" during the match calls it:
//   bind("1", "rush");

// UI shortcuts — active anywhere.
bind("k", "toggle_settings");
bind("e", "toggle_strategy_editor");
`;

/** Reverse lookup for display, e.g. "what key fires toggle_settings?" — a
 * linear scan over a handful of entries, not worth a second map. */
export function findKeyForAction(bindings: Record<string, string>, action: string): string | null {
  for (const [code, a] of Object.entries(bindings)) {
    if (a === action) return code;
  }
  return null;
}

/** Human-readable form of a normalized key code, e.g. "Digit1" -> "1". */
export function formatKeyCode(code: string): string {
  if (code.startsWith('Digit')) return code.replace('Digit', '');
  if (code.startsWith('Key')) return code.replace('Key', '');
  return code;
}
