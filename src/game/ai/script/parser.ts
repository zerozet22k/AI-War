import type { BinOp, Expr, Program, Stmt } from './ast';
import { type Token, tokenize } from './lexer';

export class ParseError extends Error {
  constructor(
    message: string,
    public pos: { line: number; col: number },
  ) {
    super(message);
  }
}

/** Recursive-descent parser for the AI scripting language. Throws ParseError
 * on the first syntax error it finds (no multi-error recovery yet). */
export function parse(source: string): Program {
  const tokens = tokenize(source);
  let pos = 0;

  function peek(): Token {
    return tokens[pos];
  }

  function check(type: Token['type'], value?: string): boolean {
    const t = peek();
    if (t.type !== type) return false;
    return value === undefined || t.value === value;
  }

  function advance(): Token {
    const t = tokens[pos];
    if (pos < tokens.length - 1) pos += 1;
    return t;
  }

  function expect(type: Token['type'], value?: string): Token {
    if (!check(type, value)) {
      const t = peek();
      const expected = value ? `"${value}"` : type;
      throw new ParseError(`Expected ${expected} but found "${t.value || t.type}"`, t.pos);
    }
    return advance();
  }

  function parseProgram(): Program {
    const statements: Stmt[] = [];
    while (!check('eof')) {
      statements.push(parseStatement());
    }
    return { statements };
  }

  function parseBlock(): Stmt[] {
    expect('punct', '{');
    const statements: Stmt[] = [];
    while (!check('punct', '}') && !check('eof')) {
      statements.push(parseStatement());
    }
    expect('punct', '}');
    return statements;
  }

  function parseStatement(): Stmt {
    const t = peek();

    if (check('keyword', 'let') || check('keyword', 'var')) {
      const startPos = advance().pos;
      const name = expect('ident').value;
      let init: Expr | null = null;
      if (check('punct', '=')) {
        advance();
        init = parseExpr();
      }
      expect('punct', ';');
      return { kind: 'VarDecl', name, init, pos: startPos };
    }

    if (check('keyword', 'if')) {
      const startPos = advance().pos;
      expect('punct', '(');
      const test = parseExpr();
      expect('punct', ')');
      const thenBranch = parseBlock();
      let elseBranch: Stmt[] | null = null;
      if (check('keyword', 'else')) {
        advance();
        elseBranch = check('keyword', 'if') ? [parseStatement()] : parseBlock();
      }
      return { kind: 'If', test, thenBranch, elseBranch, pos: startPos };
    }

    if (check('keyword', 'while')) {
      const startPos = advance().pos;
      expect('punct', '(');
      const test = parseExpr();
      expect('punct', ')');
      const body = parseBlock();
      return { kind: 'While', test, body, pos: startPos };
    }

    if (check('keyword', 'for')) {
      const startPos = advance().pos;
      expect('punct', '(');
      const itemName = expect('ident').value;
      expect('keyword', 'in');
      const iterable = parseExpr();
      expect('punct', ')');
      const body = parseBlock();
      return { kind: 'ForEach', itemName, iterable, body, pos: startPos };
    }

    if (check('keyword', 'function')) {
      const startPos = advance().pos;
      const name = expect('ident').value;
      expect('punct', '(');
      const params: string[] = [];
      if (!check('punct', ')')) {
        params.push(expect('ident').value);
        while (check('punct', ',')) {
          advance();
          params.push(expect('ident').value);
        }
      }
      expect('punct', ')');
      const body = parseBlock();
      return { kind: 'FunctionDecl', name, params, body, pos: startPos };
    }

    if (check('keyword', 'return')) {
      const startPos = advance().pos;
      let value: Expr | null = null;
      if (!check('punct', ';')) value = parseExpr();
      expect('punct', ';');
      return { kind: 'Return', value, pos: startPos };
    }

    // Assignment: (IDENT | IDENT ("[" expr "]")+) "=" expr ";" — speculatively
    // parse an ident plus any trailing index brackets, then only commit to it
    // as an assignment if an "=" actually follows; otherwise roll back and
    // let it fall through to a normal expression statement (e.g. a bare
    // call, or an index read like `log(arr[0]);` is a separate ExprStmt, not
    // this branch, since it doesn't start the statement with a bare ident).
    const assignment = tryParseAssignment();
    if (assignment) return assignment;

    const expr = parseExpr();
    expect('punct', ';');
    return { kind: 'ExprStmt', expr, pos: t.pos };
  }

  /** Speculatively parses `ident ("[" expr "]")* "=" expr ";"`. Returns null
   * (and rewinds `pos`) if no "=" follows, so the caller can fall through to
   * parsing it as a normal expression statement instead — this is the only
   * place that needs to distinguish "assignment" from "everything else that
   * starts with an identifier" (a bare call, or just an index read). */
  function tryParseAssignment(): Stmt | null {
    if (!check('ident')) return null;
    const checkpoint = pos;
    const startPos = peek().pos;
    const name = advance().value;
    const target = parsePostfixFrom({ kind: 'Ident', name, pos: startPos });
    if (!check('punct', '=')) {
      pos = checkpoint;
      return null;
    }
    advance(); // '='
    const value = parseExpr();
    expect('punct', ';');
    if (target.kind === 'Ident') {
      return { kind: 'Assign', name: target.name, value, pos: startPos };
    }
    if (target.kind === 'Index') {
      return { kind: 'IndexAssign', array: target.array, index: target.index, value, pos: startPos };
    }
    throw new ParseError('Invalid assignment target', startPos);
  }

  function parseExpr(): Expr {
    return parseLogicalOr();
  }

  function parseLogicalOr(): Expr {
    let left = parseLogicalAnd();
    while (check('punct', '||')) {
      const opPos = advance().pos;
      const right = parseLogicalAnd();
      left = { kind: 'Logical', op: '||', left, right, pos: opPos };
    }
    return left;
  }

  function parseLogicalAnd(): Expr {
    let left = parseEquality();
    while (check('punct', '&&')) {
      const opPos = advance().pos;
      const right = parseEquality();
      left = { kind: 'Logical', op: '&&', left, right, pos: opPos };
    }
    return left;
  }

  const EQUALITY_OPS = ['==', '!='];
  const COMPARISON_OPS = ['<', '<=', '>', '>='];
  const ADDITIVE_OPS = ['+', '-'];
  const MULTIPLICATIVE_OPS = ['*', '/', '%'];

  function parseEquality(): Expr {
    let left = parseComparison();
    while (EQUALITY_OPS.includes(peek().value) && check('punct')) {
      const op = advance();
      const right = parseComparison();
      left = { kind: 'Binary', op: op.value as BinOp, left, right, pos: op.pos };
    }
    return left;
  }

  function parseComparison(): Expr {
    let left = parseAdditive();
    while (COMPARISON_OPS.includes(peek().value) && check('punct')) {
      const op = advance();
      const right = parseAdditive();
      left = { kind: 'Binary', op: op.value as BinOp, left, right, pos: op.pos };
    }
    return left;
  }

  function parseAdditive(): Expr {
    let left = parseMultiplicative();
    while (ADDITIVE_OPS.includes(peek().value) && check('punct')) {
      const op = advance();
      const right = parseMultiplicative();
      left = { kind: 'Binary', op: op.value as BinOp, left, right, pos: op.pos };
    }
    return left;
  }

  function parseMultiplicative(): Expr {
    let left = parseUnary();
    while (MULTIPLICATIVE_OPS.includes(peek().value) && check('punct')) {
      const op = advance();
      const right = parseUnary();
      left = { kind: 'Binary', op: op.value as BinOp, left, right, pos: op.pos };
    }
    return left;
  }

  function parseUnary(): Expr {
    if (check('punct', '!') || check('punct', '-')) {
      const op = advance();
      const expr = parseUnary();
      return { kind: 'Unary', op: op.value as '!' | '-', expr, pos: op.pos };
    }
    return parsePostfix();
  }

  /** Consumes zero or more trailing `[expr]` index brackets after `base`,
   * e.g. turning `arr` into `arr[0]` into `arr[0][1]`. Shared by the normal
   * expression chain (parsePostfix) and by tryParseAssignment's speculative
   * lookahead, so `arr[i]` reads and `arr[i] = x;` writes agree on grammar. */
  function parsePostfixFrom(base: Expr): Expr {
    let expr = base;
    while (check('punct', '[')) {
      const bracketPos = advance().pos;
      const index = parseExpr();
      expect('punct', ']');
      expr = { kind: 'Index', array: expr, index, pos: bracketPos };
    }
    return expr;
  }

  function parsePostfix(): Expr {
    return parsePostfixFrom(parsePrimary());
  }

  function parsePrimary(): Expr {
    const t = peek();

    if (t.type === 'number') {
      advance();
      return { kind: 'Number', value: parseFloat(t.value), pos: t.pos };
    }

    if (t.type === 'string') {
      advance();
      return { kind: 'String', value: t.value, pos: t.pos };
    }

    if (check('keyword', 'true') || check('keyword', 'false')) {
      advance();
      return { kind: 'Bool', value: t.value === 'true', pos: t.pos };
    }

    if (t.type === 'ident') {
      advance();
      if (check('punct', '(')) {
        advance();
        const args: Expr[] = [];
        if (!check('punct', ')')) {
          args.push(parseExpr());
          while (check('punct', ',')) {
            advance();
            args.push(parseExpr());
          }
        }
        expect('punct', ')');
        return { kind: 'Call', callee: t.value, args, pos: t.pos };
      }
      return { kind: 'Ident', name: t.value, pos: t.pos };
    }

    if (check('punct', '(')) {
      advance();
      const expr = parseExpr();
      expect('punct', ')');
      return expr;
    }

    if (check('punct', '[')) {
      const startPos = advance().pos;
      const elements: Expr[] = [];
      if (!check('punct', ']')) {
        elements.push(parseExpr());
        while (check('punct', ',')) {
          advance();
          elements.push(parseExpr());
        }
      }
      expect('punct', ']');
      return { kind: 'ArrayLiteral', elements, pos: startPos };
    }

    throw new ParseError(`Unexpected token "${t.value || t.type}"`, t.pos);
  }

  const program = parseProgram();
  return program;
}
