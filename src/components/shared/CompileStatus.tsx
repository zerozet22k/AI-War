import { useMemo } from 'react';
import { compile } from '../../game/ai/script/compiler';
import './CompileStatus.css';

export interface CompileStatusProps {
  code: string;
}

/** "✓ Compiles cleanly" or "✗ N errors" plus, critically, *where* — the
 * first error's actual line/column and message, not just a bare count you'd
 * otherwise have to go hunting for a tiny squiggle under one character to
 * find (see CodeEditor's scriptLinter, which only underlines it inline). */
export function CompileStatus({ code }: CompileStatusProps) {
  const result = useMemo(() => compile(code), [code]);

  if (result.errors.length === 0) {
    return <span className="compile-status compile-status--ok">✓ Compiles cleanly</span>;
  }

  const [first, ...rest] = result.errors;
  return (
    <span className="compile-status compile-status--error">
      ✗ {result.errors.length} error{result.errors.length > 1 ? 's' : ''} — Line {first.line}, col {first.col}: {first.message}
      {rest.length > 0 ? ` (+${rest.length} more)` : ''}
    </span>
  );
}
