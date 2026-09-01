import { useAppStore } from '../../state/store';
import { AI_DIFFICULTY_LABEL, AI_DIFFICULTY_LIST } from '../../game/ai/strategies';
import { Button } from '../shared/Button';
import { RacePicker } from '../shared/RacePicker';
import { FullscreenButton } from '../shared/FullscreenButton';
import './MainMenu.css';
import { MAPS, MAP_ID_LIST } from '../../game/maps';

export function MainMenu() {
  const goTo = useAppStore((s) => s.goTo);
  const startNewMatch = useAppStore((s) => s.startNewMatch);
  const strategy = useAppStore((s) => s.playerStrategy);
  const setup = useAppStore((s) => s.localMatchSetup);
  const setPlayerRace = useAppStore((s) => s.setPlayerRace);
  const setEnemyRace = useAppStore((s) => s.setEnemyRace);
  const setAiDifficulty = useAppStore((s) => s.setAiDifficulty);
  const setMapId = useAppStore((s) => s.setMapId);

  const lineCount = strategy.code.split('\n').filter((l) => l.trim().length > 0).length;

  return (
    <div className="main-menu">
      <div className="main-menu__panel">
        <h1 className="main-menu__title">AEVRA</h1>
        <p className="main-menu__tagline">Your code vs. their code — write an AI and watch it fight.</p>

        <div className="main-menu__strategy-summary">
          Loaded strategy: <strong>{strategy.name}</strong> · {lineCount} line{lineCount === 1 ? '' : 's'} of code
        </div>

        <section className="main-menu__match-setup" aria-label="AI match setup">
          <RacePicker label="Your race" value={setup.playerRace} onChange={setPlayerRace} />
          <RacePicker label="Opponent race" value={setup.enemyRace} onChange={setEnemyRace} />
          <fieldset className="main-menu__maps">
            <legend>Battlefield</legend>
            <div className="main-menu__map-options">
              {MAP_ID_LIST.map((mapId) => {
                const map = MAPS[mapId];
                return (
                  <button
                    type="button"
                    key={mapId}
                    className={setup.mapId === mapId ? 'main-menu__map-option main-menu__map-option--selected' : 'main-menu__map-option'}
                    onClick={() => setMapId(mapId)}
                    aria-pressed={setup.mapId === mapId}
                  >
                    <strong>{map.name}</strong>
                    <small>{map.columns}×{map.rows} tiles · {map.description}</small>
                  </button>
                );
              })}
            </div>
          </fieldset>
          <fieldset className="main-menu__difficulty">
            <legend>AI setting</legend>
            <div className="main-menu__difficulty-options">
              {AI_DIFFICULTY_LIST.map((difficulty) => (
                <button
                  type="button"
                  key={difficulty}
                  className={setup.aiDifficulty === difficulty ? 'main-menu__difficulty-option main-menu__difficulty-option--selected' : 'main-menu__difficulty-option'}
                  onClick={() => setAiDifficulty(difficulty)}
                  aria-pressed={setup.aiDifficulty === difficulty}
                >
                  <strong>{AI_DIFFICULTY_LABEL[difficulty].name}</strong>
                  <small>{AI_DIFFICULTY_LABEL[difficulty].description}</small>
                </button>
              ))}
            </div>
          </fieldset>
        </section>

        <div className="main-menu__actions">
          <FullscreenButton />
          <Button variant="primary" onClick={() => startNewMatch()}>
            Play with AI
          </Button>
          <Button variant="secondary" onClick={() => goTo('multiplayerLobby')}>
            Multiplayer
          </Button>
          <Button variant="secondary" onClick={() => goTo('strategyEditor')}>
            Edit AI Code
          </Button>
          <Button variant="ghost" onClick={() => goTo('settings')}>
            Settings &amp; Keybinds
          </Button>
          <Button variant="ghost" onClick={() => goTo('apiReference')}>
            📖 API Reference
          </Button>
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
