import type { WebSocket } from 'ws';
import { MatchController } from '../src/game/matchController';
import { FIXED_DT, SNAPSHOT_INTERVAL } from '../src/game/constants';
import { PLAYER_ID_LIST, type PlayerId, type RaceId } from '../src/types/game';
import type { ClientMessage, LobbyPlayer, ServerMessage, SnapshotPayload } from '../src/net/protocol';
import { makeId } from '../src/utils/id';
import type { MapId } from '../src/game/maps';

interface Participant extends LobbyPlayer {
  socket: WebSocket | null;
  code: string;
}

/** Server-authoritative two-to-four-player free-for-all room. */
export class Room {
  readonly code: string;
  readonly mapId: MapId;
  controller: MatchController | null = null;

  private participants: Partial<Record<PlayerId, Participant>> = {};
  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private snapshotAccumulator = 0;

  constructor(code: string, hostSocket: WebSocket, hostCode: string, hostName: string, hostRace: RaceId, mapId: MapId) {
    this.code = code;
    this.mapId = mapId;
    this.participants.player = { side: 'player', socket: hostSocket, code: hostCode, name: hostName, race: hostRace };
  }

  isStarted(): boolean { return this.controller !== null; }
  isFull(): boolean { return this.playerCount() >= PLAYER_ID_LIST.length; }
  isEmpty(): boolean { return !PLAYER_ID_LIST.some((side) => this.participants[side]?.socket); }
  playerCount(): number { return PLAYER_ID_LIST.filter((side) => this.participants[side]).length; }

  addPlayer(socket: WebSocket, code: string, name: string, race: RaceId): PlayerId | null {
    if (this.isStarted() || this.isFull()) return null;
    const side = PLAYER_ID_LIST.find((candidate) => !this.participants[candidate]);
    if (!side) return null;
    this.participants[side] = { side, socket, code, name, race };
    this.broadcastLobby();
    return side;
  }

  start(requester: PlayerId): boolean {
    if (requester !== 'player' || this.controller || this.playerCount() < 2) return false;
    const activePlayers = PLAYER_ID_LIST.filter((side) => this.participants[side]);
    const strategies = Object.fromEntries(activePlayers.map((side) => {
      const p = this.participants[side]!;
      return [side, { id: makeId('strategy'), name: p.name, mode: 'code' as const, code: p.code, rules: [] }];
    }));
    const races = Object.fromEntries(activePlayers.map((side) => [side, this.participants[side]!.race]));
    this.controller = new MatchController({
      playerStrategy: strategies.player!,
      enemyStrategy: strategies.enemy!,
      strategies,
      races,
      activePlayers,
      mapId: this.mapId,
    });
    this.broadcast({ type: 'match_started', mapId: this.mapId });
    this.broadcastSnapshot();
    this.startTicking();
    return true;
  }

  handleMessage(owner: PlayerId, msg: ClientMessage): void {
    if (msg.type === 'start_match') {
      if (!this.start(owner)) this.send(owner, { type: 'error', message: 'Only the host can start, with at least two players.' });
      return;
    }
    if (!this.controller) return;
    if (msg.type === 'code_update') this.controller.setCode(owner, msg.code);
    else if (msg.type === 'trigger_function') this.controller.triggerFunction(owner, msg.name);
  }

  /** A disconnected AI keeps running once a match has started. Before start,
   * its slot is reopened so someone else can join. */
  removeSocket(owner: PlayerId): boolean {
    const participant = this.participants[owner];
    if (!participant) return this.isEmpty();
    participant.socket = null;
    if (this.controller) {
      this.broadcast({ type: 'player_left', side: owner });
    } else {
      delete this.participants[owner];
      if (owner === 'player') {
        this.broadcast({ type: 'error', message: 'The host closed the room.' });
        this.destroy();
        return true;
      }
      this.broadcastLobby();
    }
    if (this.isEmpty()) this.destroy();
    return this.isEmpty();
  }

  sendJoined(side: PlayerId): void {
    this.send(side, { type: 'joined', roomCode: this.code, side, isHost: side === 'player', mapId: this.mapId });
    this.sendLobby(side);
  }

  destroy(): void {
    if (this.tickHandle) clearInterval(this.tickHandle);
    this.tickHandle = null;
  }

  private lobbyPlayers(): LobbyPlayer[] {
    return PLAYER_ID_LIST.flatMap((side) => {
      const p = this.participants[side];
      return p ? [{ side, name: p.name, race: p.race }] : [];
    });
  }

  private sendLobby(side: PlayerId): void { this.send(side, { type: 'lobby_state', players: this.lobbyPlayers() }); }
  private broadcastLobby(): void { this.broadcast({ type: 'lobby_state', players: this.lobbyPlayers() }); }

  private startTicking(): void {
    if (this.tickHandle) return;
    this.tickHandle = setInterval(() => {
      if (!this.controller) return;
      this.controller.update(FIXED_DT);
      this.snapshotAccumulator += FIXED_DT;
      if (this.snapshotAccumulator >= SNAPSHOT_INTERVAL) {
        this.snapshotAccumulator = 0;
        this.broadcastSnapshot();
      }
    }, FIXED_DT * 1000);
  }

  private broadcastSnapshot(): void {
    if (!this.controller) return;
    const payload: SnapshotPayload = {
      sim: this.controller.sim.state,
      phase: this.controller.phase,
      activityLog: this.controller.activityLog,
      codes: Object.fromEntries(PLAYER_ID_LIST.map((side) => [side, this.controller!.getStrategy(side).code])) as Record<PlayerId, string>,
    };
    this.broadcast({ type: 'snapshot', payload });
  }

  private broadcast(msg: ServerMessage): void { for (const side of PLAYER_ID_LIST) this.send(side, msg); }

  private send(owner: PlayerId, msg: ServerMessage): void {
    const socket = this.participants[owner]?.socket;
    if (socket && socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
  }
}
