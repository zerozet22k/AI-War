import { useAppStore } from '../../state/store';
import { AI_DIFFICULTY_LABEL, AI_DIFFICULTY_LIST } from '../../game/ai/strategies';
import { Button } from '../shared/Button';
import { RACE_ID_LIST, type RaceId } from '../../types/game';
import { RACES } from '../../game/races';
import { COLOR_PALETTE } from '../shared/TeamColorPicker';
import { MAPS, MAP_ID_LIST } from '../../game/maps';
import './Lobby.css';

const OPPONENT_SLOT_NAMES = ['Enemy', 'Player 3', 'Player 4'] as const;
const TEAM_NUMBERS = [1, 2, 3, 4] as const;

function ColorSwatches({ color, onChange, taken }: { color: number; onChange: (c: number) => void; taken: number[] }) {
  return (
    <div className="lobby-row__swatches" role="group" aria-label="Color">
      {COLOR_PALETTE.map((swatch) => {
        const takenByOther = taken.includes(swatch) && swatch !== color;
        return (
          <button
            type="button"
            key={swatch}
            className={`lobby-row__swatch${color === swatch ? ' lobby-row__swatch--selected' : ''}`}
            style={{ backgroundColor: `#${swatch.toString(16).padStart(6, '0')}` }}
            onClick={() => onChange(swatch)}
            disabled={takenByOther}
            aria-pressed={color === swatch}
            title={takenByOther ? 'Already taken by another slot' : undefined}
          />
        );
      })}
    </div>
  );
}

/** Local single-player match setup — one compact row per slot (race, AI
 * difficulty, team, color), like a classic RTS custom-game lobby, plus the
 * battlefield. Multiplayer has its own separate lobby (MultiplayerLobby.tsx);
 * this one only ever drives a local match. */
export function Lobby() {
  const goTo = useAppStore((s) => s.goTo);
  const startNewMatch = useAppStore((s) => s.startNewMatch);
  const setup = useAppStore((s) => s.localMatchSetup);
  const setPlayerRace = useAppStore((s) => s.setPlayerRace);
  const setPlayerTeam = useAppStore((s) => s.setPlayerTeam);
  const setPlayerColor = useAppStore((s) => s.setPlayerColor);
  const setMapId = useAppStore((s) => s.setMapId);
  const setOpponentCount = useAppStore((s) => s.setOpponentCount);
  const setOpponentRace = useAppStore((s) => s.setOpponentRace);
  const setOpponentDifficulty = useAppStore((s) => s.setOpponentDifficulty);
  const setOpponentTeam = useAppStore((s) => s.setOpponentTeam);
  const setOpponentColor = useAppStore((s) => s.setOpponentColor);

  const activeOpponents = setup.opponents.slice(0, setup.activeOpponentCount);
  const takenColors = [setup.playerColor, ...activeOpponents.map((o) => o.color)];
  const maxOpponents = Math.max(1, MAPS[setup.mapId].maxPlayers - 1);
  const opponentCountOptions = ([1, 2, 3] as const).filter((count) => count <= maxOpponents);

  return (
    <div className="lobby">
      <div className="lobby__panel">
        <header className="lobby__header">
          <h1>Match Setup</h1>
          <Button variant="ghost" onClick={() => goTo('menu')}>← Back to Menu</Button>
        </header>

        <label className="lobby__map-picker">
          <span>Battlefield</span>
          <select value={setup.mapId} onChange={(e) => setMapId(e.target.value as typeof setup.mapId)}>
            {MAP_ID_LIST.map((id) => <option key={id} value={id}>{MAPS[id].name} · {MAPS[id].maxPlayers}p · {MAPS[id].columns}×{MAPS[id].rows}</option>)}
          </select>
          <small>{MAPS[setup.mapId].description}</small>
        </label>

        <div className="lobby__opponent-count" role="group" aria-label="Number of opponents">
          {opponentCountOptions.map((count) => (
            <button
              type="button"
              key={count}
              className={setup.activeOpponentCount === count ? 'lobby__count-pill lobby__count-pill--selected' : 'lobby__count-pill'}
              onClick={() => setOpponentCount(count)}
              aria-pressed={setup.activeOpponentCount === count}
            >
              {count + 1} players
            </button>
          ))}
        </div>

        <div className="lobby-rows" role="table" aria-label="Player slots">
          <div className="lobby-row lobby-row--header" role="row">
            <span>Slot</span>
            <span>Race</span>
            <span>Difficulty</span>
            <span>Team</span>
            <span>Color</span>
          </div>

          <div className="lobby-row" role="row">
            <span className="lobby-row__slot">You</span>
            <select
              className="lobby-row__select"
              value={setup.playerRace}
              onChange={(e) => setPlayerRace(e.target.value as RaceId)}
            >
              {RACE_ID_LIST.map((r) => <option key={r} value={r}>{RACES[r].name}</option>)}
            </select>
            <span className="lobby-row__blank">—</span>
            <select className="lobby-row__select lobby-row__select--narrow" value={setup.playerTeam} onChange={(e) => setPlayerTeam(Number(e.target.value))}>
              {TEAM_NUMBERS.map((n) => <option key={n} value={n}>Team {n}</option>)}
            </select>
            <ColorSwatches color={setup.playerColor} onChange={setPlayerColor} taken={takenColors} />
          </div>

          {activeOpponents.map((opponent, index) => (
            <div className="lobby-row" role="row" key={index}>
              <span className="lobby-row__slot">{OPPONENT_SLOT_NAMES[index]} <small>AI</small></span>
              <select
                className="lobby-row__select"
                value={opponent.race}
                onChange={(e) => setOpponentRace(index, e.target.value as RaceId)}
              >
                {RACE_ID_LIST.map((r) => <option key={r} value={r}>{RACES[r].name}</option>)}
              </select>
              <select
                className="lobby-row__select"
                value={opponent.aiDifficulty}
                onChange={(e) => setOpponentDifficulty(index, e.target.value as typeof opponent.aiDifficulty)}
              >
                {AI_DIFFICULTY_LIST.map((d) => <option key={d} value={d}>{AI_DIFFICULTY_LABEL[d].name}</option>)}
              </select>
              <select className="lobby-row__select lobby-row__select--narrow" value={opponent.team} onChange={(e) => setOpponentTeam(index, Number(e.target.value))}>
                {TEAM_NUMBERS.map((n) => <option key={n} value={n}>Team {n}</option>)}
              </select>
              <ColorSwatches color={opponent.color} onChange={(c) => setOpponentColor(index, c)} taken={takenColors} />
            </div>
          ))}
        </div>

        <div className="lobby__actions">
          <Button variant="primary" onClick={() => startNewMatch()}>
            Start Match
          </Button>
          <Button variant="secondary" onClick={() => goTo('strategyEditor')}>
            Edit AI Code
          </Button>
        </div>
      </div>
    </div>
  );
}
