import { useAppStore } from '../../state/store';
import { Button } from '../shared/Button';
import { FullscreenButton } from '../shared/FullscreenButton';
import './MainMenu.css';
import { exitGame, isElectronApp } from '../../utils/electron';
import { hasSaves } from '../../game/saveGame';

export function MainMenu() {
  const goTo = useAppStore((s) => s.goTo);
  const strategy = useAppStore((s) => s.playerStrategy);

  const lineCount = strategy.code.split('\n').filter((l) => l.trim().length > 0).length;

  return (
    <div className="main-menu">
      <div className="main-menu__panel">
        <h1 className="main-menu__title">AVERA</h1>
        <p className="main-menu__tagline">Your code vs. their code — write an AI and watch it fight.</p>

        <div className="main-menu__strategy-summary">
          Loaded strategy: <strong>{strategy.name}</strong> · {lineCount} line{lineCount === 1 ? '' : 's'} of code
        </div>

        <div className="main-menu__actions">
          <FullscreenButton />
          <Button variant="primary" onClick={() => goTo('lobby')}>
            Play with AI
          </Button>
          <Button variant="secondary" onClick={() => goTo('multiplayerLobby')}>
            Multiplayer
          </Button>
          {hasSaves() && (
            <Button variant="secondary" onClick={() => goTo('loadGame')}>
              Load Game
            </Button>
          )}
          <Button variant="secondary" onClick={() => goTo('strategyEditor')}>
            Edit AI Code
          </Button>
          <Button variant="ghost" onClick={() => goTo('settings')}>
            Settings &amp; Keybinds
          </Button>
          <Button variant="ghost" onClick={() => goTo('apiReference')}>
            📖 API Reference
          </Button>
          {isElectronApp() && (
            <Button variant="danger" onClick={exitGame}>
              Exit Game
            </Button>
          )}
        </div>

        <ul className="main-menu__rules">
          <li>Your AI gathers, builds, and fights entirely on its own — no manual command phases.</li>
          <li>A small sandboxed scripting language, not arbitrary JavaScript.</li>
          <li>The built-in opponents run on the same kind of code you do.</li>
        </ul>
      </div>
    </div>
  );
}
