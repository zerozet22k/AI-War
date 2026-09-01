import { useAppStore } from '../../state/store';
import { Button } from '../shared/Button';
import { ScriptReference } from '../StrategyEditor/ScriptReference';
import './ApiReferencePage.css';

/** The same reference that's squeezed into a narrow sidebar next to the
 * code editor (StrategyEditor, Terminal's edit view) — as its own full,
 * spacious page for actually browsing/reading it, not just glancing at
 * while mid-edit. Reachable from the main menu; not linked from a live
 * match's Terminal since navigating away would tear down the running match. */
export function ApiReferencePage() {
  const goTo = useAppStore((s) => s.goTo);

  return (
    <div className="api-reference-page">
      <header>
        <div>
          <h1>Scripting API Reference</h1>
          <p className="api-reference-page__subtitle">
            The full vocabulary your AI script (and the keybind script) can call into — the same list shown alongside the code editor,
            just with room to actually read it.
          </p>
        </div>
        <Button variant="ghost" onClick={() => goTo('menu')}>← Back to Menu</Button>
      </header>

      <ScriptReference fullPage />
    </div>
  );
}
