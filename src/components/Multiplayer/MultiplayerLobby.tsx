import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../state/store';
import { useMultiplayerStore } from '../../net/multiplayerStore';
import { Button } from '../shared/Button';
import { TeamColorPicker } from '../shared/TeamColorPicker';
import { RACES } from '../../game/races';
import { raceEmblemUrl } from '../../game/raceVisuals';
import { MAPS, MAP_ID_LIST } from '../../game/maps';
import { AI_DIFFICULTY_LABEL, AI_DIFFICULTY_LIST, createOpponentStrategy, type AiDifficulty } from '../../game/ai/strategies';
import { PLAYER_ID_LIST, RACE_ID_LIST, type PlayerId, type RaceId } from '../../types/game';
import './MultiplayerLobby.css';

type Tab = 'create' | 'join';

const OPPONENT_SLOT_NAMES: Partial<Record<PlayerId, string>> = { enemy: 'Enemy', player3: 'Player 3', player4: 'Player 4' };

/** Host-only inline form for filling an open slot with a bot — reuses
 * createOpponentStrategy(), the exact same helper local skirmish AI uses,
 * so a networked bot plays identically to a local one. */
function AddAiSlotForm({ onAdd }: { onAdd: (race: RaceId, difficulty: AiDifficulty) => void }) {
  const [race, setRace] = useState<RaceId>('aether');
  const [difficulty, setDifficulty] = useState<AiDifficulty>('standard');
  return (
    <div className="mp-lobby__add-ai">
      <select className="mp-lobby__race-select" value={race} onChange={(e) => setRace(e.target.value as RaceId)} aria-label="Bot race">
        {RACE_ID_LIST.map((r) => <option key={r} value={r}>{RACES[r].name}</option>)}
      </select>
      <div className="mp-lobby__difficulty-options" role="group" aria-label="Bot difficulty">
        {AI_DIFFICULTY_LIST.map((d) => (
          <button
            type="button"
            key={d}
            className={difficulty === d ? 'mp-lobby__difficulty-option mp-lobby__difficulty-option--selected' : 'mp-lobby__difficulty-option'}
            onClick={() => setDifficulty(d)}
            aria-pressed={difficulty === d}
          >
            {AI_DIFFICULTY_LABEL[d].name}
          </button>
        ))}
      </div>
      <Button variant="secondary" onClick={() => onAdd(race, difficulty)}>+ Add AI</Button>
    </div>
  );
}

export function MultiplayerLobby() {
  const goTo = useAppStore((s) => s.goTo);
  const playerStrategy = useAppStore((s) => s.playerStrategy);
  const selectedMapId = useAppStore((s) => s.localMatchSetup.mapId);
  const setMapId = useAppStore((s) => s.setMapId);
  const pendingLoadedSave = useAppStore((s) => s.pendingLoadedSave);
  const setPendingLoadedSave = useAppStore((s) => s.setPendingLoadedSave);
  const {
    client, controller, roomCode, side, players, closedSlots, isHost, matchStarted, mapId,
    connecting, error, lanServers, connectForDiscovery, disconnectDiscovery,
    createMatch, joinMatch, loadMatch, startMatch, updateSlot, setSlotState, addAiSlot, removeAiSlot, leaveMatch,
  } = useMultiplayerStore();

  const [tab, setTab] = useState<Tab>('create');
  const [joinCode, setJoinCode] = useState('');
  const startedRef = useRef(matchStarted);
  startedRef.current = matchStarted;

  useEffect(
    () => () => {
      if (!startedRef.current) leaveMatch();
    },
    [leaveMatch],
  );

  useEffect(() => {
    if (controller && matchStarted) goTo('match');
  }, [controller, matchStarted, goTo]);

  const connected = client !== null && controller !== null;

  // Passive LAN listing while browsing the lobby — a separate connection to
  // this machine's own local server, which relays whatever it's heard from
  // other AVERA instances on the LAN (see server/index.ts). Torn down once
  // an actual room connection exists (connected) or the screen is left.
  useEffect(() => {
    if (connected) return;
    connectForDiscovery();
    return () => disconnectDiscovery();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  const chosenMap = mapId ?? selectedMapId;

  function exitLobby() {
    leaveMatch();
    setPendingLoadedSave(null);
    goTo('menu');
  }

  const joinableLanRooms = lanServers.flatMap((server) =>
    server.rooms.filter((room) => room.joinable).map((room) => ({ server, room })),
  );

  const mySlot = players.find((p) => p.side === side);
  const canStart = players.length >= 2 && players.every((p) => p.isAi || p.ready);
  const slots = PLAYER_ID_LIST.slice(0, MAPS[chosenMap]?.maxPlayers ?? PLAYER_ID_LIST.length);
  const takenColors = players.map((p) => p.color);

  return (
    <div className="mp-lobby">
      <header>
        <h1>Multiplayer</h1>
        <Button variant="ghost" onClick={exitLobby}>← Back to Menu</Button>
      </header>

      <p className="mp-lobby__subtitle">
        Local/LAN rooms support 2–4 players, capped by the chosen map. Everyone brings their currently loaded AI code and
        picks their own race/team/color once inside the room, then readies up — the host can also close slots or fill
        them with bots, and starts once everyone's ready.
      </p>

      {error ? <div className="mp-lobby__error">{error}</div> : null}

      {connected ? (
        <div className="mp-lobby__waiting">
          <div className="mp-lobby__room-code">{roomCode}</div>
          <p>{MAPS[chosenMap].name} · {players.length}/{slots.length} commanders</p>
          <div className="mp-lobby__players" aria-label="Player slots">
            {slots.map((slot) => {
              const player = players.find((p) => p.side === slot);
              const closed = closedSlots.includes(slot);
              const isMe = slot === side;
              const label = slot === 'player' ? (isMe ? 'You' : (player?.name ?? 'Host')) : (OPPONENT_SLOT_NAMES[slot] ?? slot);

              if (!player) {
                return (
                  <div className="mp-lobby__player mp-lobby__player--empty" key={slot}>
                    <span>{label}</span>
                    <span className="mp-lobby__empty-state">{closed ? '— Closed —' : '— Open, waiting for a player —'}</span>
                    {isHost && !matchStarted && (
                      <Button variant="ghost" onClick={() => setSlotState(slot, closed ? 'open' : 'closed')}>
                        {closed ? 'Open' : 'Close'}
                      </Button>
                    )}
                  </div>
                );
              }

              const editable = isMe || (isHost && player.isAi);
              return (
                <div className="mp-lobby__player" key={slot}>
                  <span>{player.isAi ? `🤖 ${player.name}` : isMe ? 'You' : player.name}</span>
                  {editable ? (
                    <select
                      className="mp-lobby__race-select mp-lobby__race-select--row"
                      value={player.race}
                      onChange={(e) => updateSlot({ race: e.target.value as RaceId }, isMe ? undefined : slot)}
                    >
                      {RACE_ID_LIST.map((r) => <option key={r} value={r}>{RACES[r].name}</option>)}
                    </select>
                  ) : (
                    <span className="mp-lobby__player-race">
                      <img src={raceEmblemUrl(player.race)} alt="" aria-hidden="true" draggable={false} />
                      <strong>{RACES[player.race].name}</strong>
                    </span>
                  )}
                  {editable ? (
                    <TeamColorPicker
                      team={player.team}
                      onTeamChange={(team) => updateSlot({ team }, isMe ? undefined : slot)}
                      color={player.color}
                      onColorChange={(color) => updateSlot({ color }, isMe ? undefined : slot)}
                      takenColors={takenColors}
                    />
                  ) : (
                    <span className="mp-lobby__player-team" title={`Team ${player.team}`}>
                      <span className="mp-lobby__player-swatch" style={{ backgroundColor: `#${player.color.toString(16).padStart(6, '0')}` }} />
                      Team {player.team}
                    </span>
                  )}
                  {player.isAi ? (
                    isHost && !matchStarted && <Button variant="ghost" onClick={() => removeAiSlot(slot)}>✕ Remove</Button>
                  ) : isMe ? (
                    <button
                      type="button"
                      className={player.ready ? 'mp-lobby__ready mp-lobby__ready--on' : 'mp-lobby__ready'}
                      onClick={() => updateSlot({ ready: !player.ready })}
                    >
                      {player.ready ? '✓ Ready' : 'Ready?'}
                    </button>
                  ) : (
                    <span className={player.ready ? 'mp-lobby__ready-badge mp-lobby__ready-badge--on' : 'mp-lobby__ready-badge'}>
                      {player.ready ? 'Ready' : 'Not ready'}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {isHost && players.length < slots.length && !matchStarted && (
            <AddAiSlotForm onAdd={(race, difficulty) => {
              const strategy = createOpponentStrategy(`${AI_DIFFICULTY_LABEL[difficulty].name} ${RACES[race].name} AI`, difficulty, race);
              addAiSlot(race, strategy.name, strategy.code);
            }}
            />
          )}

          {isHost ? (
            <Button variant="primary" onClick={startMatch} disabled={!canStart}>
              {players.length < 2 ? 'Add a player or a bot to start' : !canStart ? 'Waiting for everyone to ready up…' : `Start ${players.length}-Player Match`}
            </Button>
          ) : mySlot && !mySlot.isAi ? (
            <p>{mySlot.ready ? 'Waiting for the host to start.' : 'Ready up when you\'re set — the host can start once everyone has.'}</p>
          ) : null}
          <Button variant="ghost" onClick={exitLobby}>Leave Room</Button>
        </div>
      ) : pendingLoadedSave ? (
        <div className="mp-lobby__panel">
          <p>
            Resuming <strong>{pendingLoadedSave.label}</strong> — {MAPS[pendingLoadedSave.mapId].name}, every original
            slot rejoins the room exactly as saved (race, team, color, code) once its player reconnects with the room code.
          </p>
          <Button
            variant="primary"
            onClick={() => loadMatch(playerStrategy.name, playerStrategy.code, pendingLoadedSave)}
            disabled={connecting}
          >
            {connecting ? 'Connecting…' : 'Host This Save'}
          </Button>
          <Button variant="ghost" onClick={() => setPendingLoadedSave(null)}>Cancel</Button>
        </div>
      ) : (
        <>
          {joinableLanRooms.length > 0 && (
            <div className="mp-lobby__lan-games">
              <span className="mp-lobby__lan-games-label">LAN games found</span>
              {joinableLanRooms.map(({ server, room }) => (
                <button
                  type="button"
                  key={`${server.addr}-${room.code}`}
                  className="mp-lobby__lan-game"
                  disabled={connecting}
                  onClick={() => joinMatch(room.code, playerStrategy.name, playerStrategy.code, server.addr)}
                >
                  <strong>{room.hostName}</strong>
                  <span>{MAPS[room.mapId]?.name ?? room.mapId} · {room.playerCount}/{room.maxPlayers}</span>
                </button>
              ))}
            </div>
          )}

          <div className="mp-lobby__tabs">
            <button className={`mp-lobby__tab ${tab === 'create' ? 'mp-lobby__tab--active' : ''}`} onClick={() => setTab('create')}>Create Match</button>
            <button className={`mp-lobby__tab ${tab === 'join' ? 'mp-lobby__tab--active' : ''}`} onClick={() => setTab('join')}>Join Match</button>
          </div>

          {tab === 'create' ? (
            <div className="mp-lobby__panel">
              <label className="mp-lobby__map-picker">
                <span>Battlefield</span>
                <select value={selectedMapId} onChange={(event) => setMapId(event.target.value as typeof selectedMapId)} disabled={connecting}>
                  {MAP_ID_LIST.map((id) => <option key={id} value={id}>{MAPS[id].name} · {MAPS[id].maxPlayers}p · {MAPS[id].columns}×{MAPS[id].rows}</option>)}
                </select>
                <small>{MAPS[selectedMapId].description}</small>
              </label>
              <p>Race, team, and color are chosen inside the room once it's created.</p>
              <Button variant="primary" onClick={() => createMatch(playerStrategy.name, playerStrategy.code, selectedMapId)} disabled={connecting}>
                {connecting ? 'Connecting…' : 'Create Room'}
              </Button>
            </div>
          ) : (
            <div className="mp-lobby__panel">
              <p>Enter the room code, or click a LAN game above. Open slots are assigned automatically.</p>
              <input
                className="mp-lobby__code-input"
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                placeholder="ROOM CODE"
                maxLength={8}
                aria-label="Room code"
              />
              <Button variant="primary" onClick={() => joinMatch(joinCode, playerStrategy.name, playerStrategy.code)} disabled={connecting || joinCode.trim().length === 0}>
                {connecting ? 'Connecting…' : 'Join Room'}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
