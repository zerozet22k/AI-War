import type { Pos } from './ast';

export type TokenType =
  | 'number'
  | 'string'
  | 'ident'
  | 'keyword'
  | 'punct'
  | 'eof';

export interface Token {
  type: TokenType;
  value: string;
  pos: Pos;
}

export class LexError extends Error {
  constructor(
    message: string,
    public pos: Pos,
  ) {
    super(message);
  }
}

const KEYWORDS = new Set(['let', 'var', 'if', 'else', 'while', 'true', 'false', 'function', 'return', 'for', 'in']);

// Longest-match-first so e.g. "==" is not lexed as two "=" tokens.
const PUNCTUATION = ['&&', '||', '==', '!=', '<=', '>=', '(', ')', '{', '}', '[', ']', ';', ',', '=', '<', '>', '+', '-', '*', '/', '%', '!'];

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let col = 1;

  function advance(n = 1): void {
    for (let k = 0; k < n; k += 1) {
      if (source[i] === '\n') {
        line += 1;
        col = 1;
      } else {
        col += 1;
      }
      i += 1;
    }
  }

  while (i < source.length) {
    const ch = source[i];

    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      advance();
      continue;
    }

    // Line comments: // ...
    if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') advance();
      continue;
    }

    const startPos: Pos = { line, col };

    if (/[0-9]/.test(ch)) {
      let text = '';
      while (i < source.length && /[0-9.]/.test(source[i])) {
        text += source[i];
        advance();
      }
      tokens.push({ type: 'number', value: text, pos: startPos });
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      let text = '';
      while (i < source.length && /[A-Za-z0-9_]/.test(source[i])) {
        text += source[i];
        advance();
      }
      tokens.push({ type: KEYWORDS.has(text) ? 'keyword' : 'ident', value: text, pos: startPos });
      continue;
    }

    if (ch === '"') {
      advance();
      let text = '';
      while (i < source.length && source[i] !== '"') {
        if (source[i] === '\n') throw new LexError('Unterminated string literal', startPos);
        text += source[i];
        advance();
      }
      if (i >= source.length) throw new LexError('Unterminated string literal', startPos);
      advance(); // closing quote
      tokens.push({ type: 'string', value: text, pos: startPos });
      continue;
    }

    const punct = PUNCTUATION.find((p) => source.startsWith(p, i));
    if (punct) {
      tokens.push({ type: 'punct', value: punct, pos: startPos });
      advance(punct.length);
      continue;
    }

    throw new LexError(`Unexpected character "${ch}"`, startPos);
  }

  tokens.push({ type: 'eof', value: '', pos: { line, col } });
  return tokens;
}
