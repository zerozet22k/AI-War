import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../state/store';
import { useMultiplayerStore } from '../../net/multiplayerStore';
import { Button } from '../shared/Button';
import { RacePicker } from '../shared/RacePicker';
import { RACES } from '../../game/races';
import { raceEmblemUrl } from '../../game/raceVisuals';
import { MAPS, MAP_ID_LIST } from '../../game/maps';
import './MultiplayerLobby.css';

type Tab = 'create' | 'join';

export function MultiplayerLobby() {
  const goTo = useAppStore((s) => s.goTo);
  const playerStrategy = useAppStore((s) => s.playerStrategy);
  const playerRace = useAppStore((s) => s.localMatchSetup.playerRace);
  const setPlayerRace = useAppStore((s) => s.setPlayerRace);
  const selectedMapId = useAppStore((s) => s.localMatchSetup.mapId);
  const setMapId = useAppStore((s) => s.setMapId);
  const {
    client, controller, roomCode, side, players, isHost, matchStarted, mapId,
    connecting, error, createMatch, joinMatch, startMatch, leaveMatch,
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
  const chosenMap = mapId ?? selectedMapId;

  function exitLobby() {
    leaveMatch();
    goTo('menu');
  }

  return (
    <div className="mp-lobby">
      <header>
        <h1>Multiplayer</h1>
        <Button variant="ghost" onClick={exitLobby}>← Back to Menu</Button>
      </header>

      <p className="mp-lobby__subtitle">
        Local/LAN rooms support 2–4 players. Everyone brings their currently loaded AI code; the host starts the free-for-all when ready.
      </p>

      {error ? <div className="mp-lobby__error">{error}</div> : null}

      {connected ? (
        <div className="mp-lobby__waiting">
          <div className="mp-lobby__room-code">{roomCode}</div>
          <p>{MAPS[chosenMap].name} · {players.length}/4 commanders connected</p>
          <div className="mp-lobby__players" aria-label="Players in room">
            {players.map((player) => (
              <div className="mp-lobby__player" key={player.side}>
                <span>{player.side === side ? 'You' : player.name}</span>
                <span className="mp-lobby__player-race">
                  <img src={raceEmblemUrl(player.race)} alt="" aria-hidden="true" draggable={false} />
                  <strong>{RACES[player.race].name}</strong>
                </span>
              </div>
            ))}
          </div>
          {isHost ? (
            <Button variant="primary" onClick={startMatch} disabled={players.length < 2}>
              {players.length < 2 ? 'Waiting for another player…' : `Start ${players.length}-Player Match`}
            </Button>
          ) : (
            <p>Waiting for the host to start. More players may still join with the room code.</p>
          )}
          <Button variant="ghost" onClick={exitLobby}>Leave Room</Button>
        </div>
      ) : (
        <>
          <div className="mp-lobby__tabs">
            <button className={`mp-lobby__tab ${tab === 'create' ? 'mp-lobby__tab--active' : ''}`} onClick={() => setTab('create')}>Create Match</button>
            <button className={`mp-lobby__tab ${tab === 'join' ? 'mp-lobby__tab--active' : ''}`} onClick={() => setTab('join')}>Join Match</button>
          </div>

          <RacePicker label="Your race" value={playerRace} onChange={setPlayerRace} disabled={connecting} compact />

          {tab === 'create' ? (
            <div className="mp-lobby__panel">
              <label className="mp-lobby__map-picker">
                <span>Battlefield</span>
                <select value={selectedMapId} onChange={(event) => setMapId(event.target.value as typeof selectedMapId)} disabled={connecting}>
                  {MAP_ID_LIST.map((id) => <option key={id} value={id}>{MAPS[id].name} · {MAPS[id].columns}×{MAPS[id].rows}</option>)}
                </select>
                <small>{MAPS[selectedMapId].description}</small>
              </label>
              <Button variant="primary" onClick={() => createMatch(playerStrategy.name, playerStrategy.code, playerRace, selectedMapId)} disabled={connecting}>
                {connecting ? 'Connecting…' : 'Create Room'}
              </Button>
            </div>
          ) : (
            <div className="mp-lobby__panel">
              <p>Enter the room code. Open slots are assigned automatically.</p>
              <input
                className="mp-lobby__code-input"
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                placeholder="ROOM CODE"
                maxLength={8}
                aria-label="Room code"
              />
              <Button variant="primary" onClick={() => joinMatch(joinCode, playerStrategy.name, playerStrategy.code, playerRace)} disabled={connecting || joinCode.trim().length === 0}>
                {connecting ? 'Connecting…' : 'Join Room'}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
