import { useEffect, useRef, useState } from 'react';
import type { MatchView } from '../../game/matchView';
import type { PlayerId } from '../../types/game';
import './LiveVariablesBar.css';

export interface LiveVariablesBarProps {
  controller: MatchView;
  owner: PlayerId;
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.length}]`;
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === 'string') return value === '' ? '""' : `"${value}"`;
  return String(value);
}

/** The running script's actual `let` values, live — not just the source
 * text next to it. Polls rather than pushing on every sim tick (variables
 * can change many times a second; nobody needs to read that fast) and
 * briefly flashes any chip whose value just changed. */
export function LiveVariablesBar({ controller, owner }: LiveVariablesBarProps) {
  const [vars, setVars] = useState<Record<string, unknown>>({});
  const [changed, setChanged] = useState<ReadonlySet<string>>(new Set());
  const previous = useRef<Record<string, unknown>>({});

  useEffect(() => {
    previous.current = {};
    setVars({});
    setChanged(new Set());

    const id = setInterval(() => {
      const next = controller.getScriptVariables(owner);
      const changedNow = new Set<string>();
      for (const [name, value] of Object.entries(next)) {
        if (name in previous.current && previous.current[name] !== value) changedNow.add(name);
      }
      previous.current = next;
      setVars(next);
      if (changedNow.size > 0) setChanged(changedNow);
    }, 300);
    return () => clearInterval(id);
  }, [controller, owner]);

  // Clear the flash a beat after it's shown, on its own timer rather than
  // inside the poll above — so a chip's flash always gets its full duration
  // even if the next poll lands before the CSS animation finishes.
  useEffect(() => {
    if (changed.size === 0) return;
    const id = setTimeout(() => setChanged(new Set()), 550);
    return () => clearTimeout(id);
  }, [changed]);

  const entries = Object.entries(vars);
  if (entries.length === 0) return null;

  return (
    <div className="live-variables-bar">
      <span className="live-variables-bar__label">Live</span>
      <div className="live-variables-bar__chips">
        {entries.map(([name, value]) => (
          <span className={`live-variables-bar__chip${changed.has(name) ? ' live-variables-bar__chip--changed' : ''}`} key={name}>
            <strong>{name}</strong>
            <span>{formatValue(value)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
