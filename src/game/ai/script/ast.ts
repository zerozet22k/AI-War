// AST for the safe AI scripting language. This is a small, deliberately
// limited C/JS-like language: variables, if/else, while, arrays, and calls
// into a fixed set of host functions (see api.ts) that mirror the same safe
// vocabulary the visual rule builder uses. There is no way to reach anything
// outside that vocabulary — no eval, no object/function values, no access to
// the DOM or network. Arrays are a first-class value (see Value in
// interpreter.ts): a script can build one with a `[...]` literal, read/write
// an element with `arr[i]`, and grow one by assigning at `arr[count(arr)]`
// (index === current length appends, same as push).

export interface Pos {
  line: number;
  col: number;
}

export type BinOp = '+' | '-' | '*' | '/' | '%' | '==' | '!=' | '<' | '<=' | '>' | '>=';

export type Expr =
  | { kind: 'Number'; value: number; pos: Pos }
  | { kind: 'String'; value: string; pos: Pos }
  | { kind: 'Bool'; value: boolean; pos: Pos }
  | { kind: 'Ident'; name: string; pos: Pos }
  | { kind: 'Call'; callee: string; args: Expr[]; pos: Pos }
  | { kind: 'Unary'; op: '!' | '-'; expr: Expr; pos: Pos }
  | { kind: 'Binary'; op: BinOp; left: Expr; right: Expr; pos: Pos }
  | { kind: 'Logical'; op: '&&' | '||'; left: Expr; right: Expr; pos: Pos }
  | { kind: 'ArrayLiteral'; elements: Expr[]; pos: Pos }
  | { kind: 'Index'; array: Expr; index: Expr; pos: Pos };

export type Stmt =
  | { kind: 'VarDecl'; name: string; init: Expr | null; pos: Pos }
  | { kind: 'Assign'; name: string; value: Expr; pos: Pos }
  | { kind: 'IndexAssign'; array: Expr; index: Expr; value: Expr; pos: Pos }
  | { kind: 'If'; test: Expr; thenBranch: Stmt[]; elseBranch: Stmt[] | null; pos: Pos }
  | { kind: 'While'; test: Expr; body: Stmt[]; pos: Pos }
  | { kind: 'ExprStmt'; expr: Expr; pos: Pos }
  | { kind: 'FunctionDecl'; name: string; params: string[]; body: Stmt[]; pos: Pos }
  | { kind: 'Return'; value: Expr | null; pos: Pos }
  | { kind: 'ForEach'; itemName: string; iterable: Expr; body: Stmt[]; pos: Pos };

export interface Program {
  statements: Stmt[];
}
