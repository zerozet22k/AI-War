import type { Program } from './ast';
import type { ScriptError } from './errors';
import { LexError } from './lexer';
import { ParseError, parse } from './parser';

export interface CompileResult {
  program: Program | null;
  errors: ScriptError[];
}

/** Lexes and parses source into a Program. Never throws — syntax problems
 * come back as `errors` so the editor can show them as diagnostics. */
export function compile(source: string): CompileResult {
  try {
    const program = parse(source);
    return { program, errors: [] };
  } catch (err) {
    if (err instanceof ParseError || err instanceof LexError) {
      return { program: null, errors: [{ message: err.message, line: err.pos.line, col: err.pos.col }] };
    }
    return { program: null, errors: [{ message: (err as Error).message ?? 'Unknown compile error', line: 1, col: 1 }] };
  }
}
