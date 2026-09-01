import { useEffect, useState } from 'react';
import type { MatchView } from '../../game/matchView';
import type { PlayerId } from '../../types/game';

/** Polls a side's running script variables — shared by the live-values bar
 * and the inline editor annotations, so both read from the same cadence. */
export function useLiveScriptVariables(controller: MatchView, owner: PlayerId): Record<string, unknown> {
  const [vars, setVars] = useState<Record<string, unknown>>({});

  useEffect(() => {
    setVars({});
    const id = setInterval(() => setVars(controller.getScriptVariables(owner)), 300);
    return () => clearInterval(id);
  }, [controller, owner]);

  return vars;
}
