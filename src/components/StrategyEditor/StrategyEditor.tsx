import { useState } from 'react';
import { useAppStore } from '../../state/store';
import { ADVANCED_EXAMPLE_SCRIPT } from '../../game/ai/script/examples';
import { defaultScriptForRace } from '../../game/ai/strategies';
import { RACES } from '../../game/races';
import { CodeEditor } from './CodeEditor';
import { ScriptReference } from './ScriptReference';
import { Button } from '../shared/Button';
import { CompileStatus } from '../shared/CompileStatus';
import './StrategyEditor.css';

export function StrategyEditor() {
  const strategy = useAppStore((s) => s.playerStrategy);
  const race = useAppStore((s) => s.localMatchSetup.playerRace);
  const setStrategy = useAppStore((s) => s.setPlayerStrategy);
  const saveStrategy = useAppStore((s) => s.saveStrategy);
  const goTo = useAppStore((s) => s.goTo);
  const startNewMatch = useAppStore((s) => s.startNewMatch);
  const [savedFlash, setSavedFlash] = useState(false);

  function handleSave() {
    saveStrategy();
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1500);
  }

  function setCode(code: string) {
    setStrategy({ ...strategy, mode: 'code', code });
  }

  return (
    <div className="strategy-editor strategy-editor--code">
      <header className="strategy-editor__header">
        <div>
          <h1>Your {RACES[race].name} AI</h1>
          <p className="strategy-editor__subtitle">
            Write your AI as code: variables, if/else, while/for loops, functions, and calls into a safe vocabulary of
            queries and actions. It runs several times per second — no arbitrary JavaScript, just this small sandboxed language.
            Your opponent's AI is code too — you'll be able to see it once the match starts.
          </p>
        </div>
        <Button variant="ghost" onClick={() => goTo('menu')}>
          ← Back to Menu
        </Button>
      </header>

      <div className="strategy-editor__name-row">
        <label htmlFor="strategy-name">Strategy name</label>
        <input
          id="strategy-name"
          className="strategy-editor__name-input"
          value={strategy.name}
          onChange={(e) => setStrategy({ ...strategy, name: e.target.value })}
          placeholder="Name this strategy"
        />
      </div>

      <div className="strategy-editor__toolbar">
        <Button variant="secondary" onClick={handleSave}>
          {savedFlash ? 'Saved ✓' : 'Save to Browser'}
        </Button>
        <Button variant="secondary" onClick={() => setCode(defaultScriptForRace(race))}>
          Load {RACES[race].name} Doctrine
        </Button>
        <Button variant="secondary" onClick={() => setCode(ADVANCED_EXAMPLE_SCRIPT)}>
          Load Advanced Example
        </Button>
        <Button variant="ghost" onClick={() => goTo('apiReference')}>
          📖 Full API Reference ↗
        </Button>
        <CompileStatus code={strategy.code} />
      </div>

      <div className="strategy-editor__code-area">
        <CodeEditor value={strategy.code} onChange={setCode} />
        <ScriptReference />
      </div>

      <footer className="strategy-editor__footer">
        <Button
          variant="primary"
          onClick={() => {
            saveStrategy();
            startNewMatch();
          }}
        >
          Save &amp; Start Match →
        </Button>
      </footer>
    </div>
  );
}
