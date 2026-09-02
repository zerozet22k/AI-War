import type { WebSocket } from 'ws';
import { MatchController } from '../src/game/matchController';
import { FIXED_DT, SNAPSHOT_INTERVAL } from '../src/game/constants';
import { PLAYER_ID_LIST, type PlayerId, type RaceId } from '../src/types/game';
import type { ClientMessage, LanRoomSummary, LobbyPlayer, ServerMessage, SnapshotPayload } from '../src/net/protocol';
import type { SaveGameData } from '../src/game/saveGame';
import { makeId } from '../src/utils/id';
import { MAPS, type MapId } from '../src/game/maps';
import { DEFAULT_OWNER_COLOR } from '../src/game/simulation/Simulation';
import { DEFAULT_RACE_FOR_PLAYER } from '../src/game/races';

interface Participant extends LobbyPlayer {
  socket: WebSocket | null;
  code: string;
}

/** Team numbers a newly-joined slot defaults to, keyed by join order — every
 * participant on their own number (plain free-for-all) until someone opts
 * into teaming up via `update_slot`. */
const DEFAULT_TEAM_FOR_SIDE: Record<PlayerId, number> = { player: 1, enemy: 2, player3: 3, player4: 4 };

/** Server-authoritative two-to-four-player free-for-all room. Race is always
 * chosen inside the room (never before joining), same as team/color — see
 * update_slot in protocol.ts. */
export class Room {
  readonly code: string;
  readonly mapId: MapId;
  controller: MatchController | null = null;

  private participants: Partial<Record<PlayerId, Participant>> = {};
  private closedSlots = new Set<PlayerId>();
  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private snapshotAccumulator = 0;

  constructor(code: string, hostSocket: WebSocket, hostCode: string, hostName: string, mapId: MapId, resume?: SaveGameData) {
    this.code = code;
    this.mapId = mapId;
    if (resume) {
      for (const side of resume.activePlayers) {
        const lobbyInfo = resume.lobby[side];
        const isHostSeat = side === 'player';
        this.participants[side] = {
          side,
          socket: isHostSeat ? hostSocket : null,
          code: isHostSeat ? hostCode : (resume.strategies[side]?.code ?? ''),
          name: isHostSeat ? hostName : (lobbyInfo?.name ?? side),
          race: resume.races[side] ?? 'ironclad',
          team: lobbyInfo?.team ?? DEFAULT_TEAM_FOR_SIDE[side],
          color: lobbyInfo?.color ?? DEFAULT_OWNER_COLOR[side],
          isAi: false,
          ready: true,
        };
      }
      const strategies = Object.fromEntries(resume.activePlayers.map((side) => {
        const p = this.participants[side]!;
        return [side, resume.strategies[side] ?? { id: makeId('strategy'), name: p.name, mode: 'code' as const, code: p.code, rules: [] }];
      }));
      const races = Object.fromEntries(resume.activePlayers.map((side) => [side, this.participants[side]!.race]));
      const lobby = Object.fromEntries(resume.activePlayers.map((side) => {
        const p = this.participants[side]!;
        return [side, { name: p.name, team: p.team, color: p.color }];
      }));
      this.controller = new MatchController({
        playerStrategy: strategies.player!,
        enemyStrategy: strategies.enemy ?? strategies.player!,
        strategies,
        races,
        activePlayers: resume.activePlayers,
        lobby,
        mapId: this.mapId,
        scriptTimeBudgetMs: 12,
        resume: { simState: resume.simState, phase: resume.phase, activityLog: resume.activityLog },
      });
    } else {
      this.participants.player = {
        side: 'player',
        socket: hostSocket,
        code: hostCode,
        name: hostName,
        race: DEFAULT_RACE_FOR_PLAYER.player,
        team: DEFAULT_TEAM_FOR_SIDE.player,
        color: DEFAULT_OWNER_COLOR.player,
        isAi: false,
        ready: false,
      };
    }
  }

  isStarted(): boolean { return this.controller !== null; }
  mapMaxPlayers(): number { return Math.min(PLAYER_ID_LIST.length, MAPS[this.mapId]?.maxPlayers ?? PLAYER_ID_LIST.length); }
  private mapSlots(): PlayerId[] { return PLAYER_ID_LIST.slice(0, this.mapMaxPlayers()); }
  isFull(): boolean { return this.playerCount() >= this.mapMaxPlayers(); }
  isEmpty(): boolean { return !PLAYER_ID_LIST.some((side) => this.participants[side]?.socket); }
  playerCount(): number { return this.mapSlots().filter((side) => this.participants[side]).length; }
  hostName(): string { return this.participants.player?.name ?? 'Unknown'; }

  /** A slot that exists (was part of the original roster or a resumed save)
   * but currently has no live socket — reclaimable by anyone who joins,
   * whether the match is still in its lobby or already running. Covers both
   * "a resumed save's other original players haven't reconnected yet" and
   * "someone disconnected mid-match and a replacement wants their seat." */
  private hasReconnectableSlot(): boolean {
    return PLAYER_ID_LIST.some((side) => this.participants[side] && !this.participants[side]!.socket && !this.participants[side]!.isAi);
  }

  canJoin(): boolean {
    if (this.isFull()) return false;
    return !this.isStarted() || this.hasReconnectableSlot();
  }

  /** Everything a LAN discovery broadcast needs to describe this room to a
   * peer that hasn't joined it — see server/index.ts's UDP loop. */
  summary(): LanRoomSummary {
    return {
      code: this.code,
      hostName: this.hostName(),
      playerCount: this.playerCount(),
      maxPlayers: this.mapMaxPlayers(),
      mapId: this.mapId,
      started: this.isStarted(),
      joinable: this.canJoin(),
    };
  }

  addPlayer(socket: WebSocket, code: string, name: string): PlayerId | null {
    if (!this.canJoin()) return null;
    if (this.isStarted()) {
      // Reclaiming an existing (disconnected, or never-yet-connected resumed)
      // seat — its race/team/color/AI-code are already fixed by whatever
      // match is actually running; only the human behind it changes.
      const side = PLAYER_ID_LIST.find((candidate) => this.participants[candidate] && !this.participants[candidate]!.socket && !this.participants[candidate]!.isAi);
      if (!side) return null;
      const participant = this.participants[side]!;
      participant.socket = socket;
      participant.name = name;
      this.broadcastLobby();
      return side;
    }
    const side = this.mapSlots().find((candidate) => !this.closedSlots.has(candidate) && !this.participants[candidate]);
    if (!side) return null;
    this.participants[side] = {
      side,
      socket,
      code,
      name,
      race: DEFAULT_RACE_FOR_PLAYER[side],
      team: DEFAULT_TEAM_FOR_SIDE[side],
      color: DEFAULT_OWNER_COLOR[side],
      isAi: false,
      ready: false,
    };
    this.broadcastLobby();
    return side;
  }

  /** Host-only: opens or closes an empty slot. Closing kicks nobody — it
   * only ever applies to a slot with no participant at all. */
  setSlotState(requester: PlayerId, side: PlayerId, state: 'closed' | 'open'): boolean {
    if (requester !== 'player' || this.controller) return false;
    if (!this.mapSlots().includes(side) || this.participants[side]) return false;
    if (state === 'closed') this.closedSlots.add(side);
    else this.closedSlots.delete(side);
    this.broadcastLobby();
    return true;
  }

  /** Host-only: fills the next open slot with a bot. `code`/`name` are the
   * already-built AI script/label — see the client-side add_ai_slot sender,
   * which uses the same createOpponentStrategy() local skirmish AI does
   * (the server has no doctrine-script assets to build one from itself). */
  addAiSlot(requester: PlayerId, race: RaceId, name: string, code: string): PlayerId | null {
    if (requester !== 'player' || this.controller || this.isFull()) return null;
    const side = this.mapSlots().find((candidate) => !this.closedSlots.has(candidate) && !this.participants[candidate]);
    if (!side) return null;
    this.participants[side] = {
      side,
      socket: null,
      code,
      name,
      race,
      team: DEFAULT_TEAM_FOR_SIDE[side],
      color: DEFAULT_OWNER_COLOR[side],
      isAi: true,
      ready: true,
    };
    this.broadcastLobby();
    return side;
  }

  removeAiSlot(requester: PlayerId, side: PlayerId): boolean {
    if (requester !== 'player' || this.controller) return false;
    const p = this.participants[side];
    if (!p || !p.isAi) return false;
    delete this.participants[side];
    this.broadcastLobby();
    return true;
  }

  start(requester: PlayerId): boolean {
    if (requester !== 'player' || this.controller || this.playerCount() < 2) return false;
    const activePlayers = this.mapSlots().filter((side) => this.participants[side]);
    if (activePlayers.some((side) => !this.participants[side]!.isAi && !this.participants[side]!.ready)) return false;
    const strategies = Object.fromEntries(activePlayers.map((side) => {
      const p = this.participants[side]!;
      return [side, { id: makeId('strategy'), name: p.name, mode: 'code' as const, code: p.code, rules: [] }];
    }));
    const races = Object.fromEntries(activePlayers.map((side) => [side, this.participants[side]!.race]));
    const lobby = Object.fromEntries(activePlayers.map((side) => {
      const p = this.participants[side]!;
      return [side, { name: p.name, team: p.team, color: p.color }];
    }));
    this.controller = new MatchController({
      playerStrategy: strategies.player!,
      enemyStrategy: strategies.enemy!,
      strategies,
      races,
      activePlayers,
      lobby,
      mapId: this.mapId,
      // Up to PLAYER_ID_LIST.length players' scripts run sequentially on this
      // one thread every tick (see MatchController.update()) — one occasional
      // expensive-but-legitimate tick delays every other player in the room,
      // not just its own owner. 12ms was picked from a real measurement of
      // aether_me.txt (a large, expensive script) under a full match with
      // combat: p99 tick cost was 2.84ms, with a few legitimate outliers up
      // to ~12.8ms and a couple of rare spikes to 20-41ms. 12ms comfortably
      // covers ordinary variance without ever clipping a normal tick in that
      // measurement, while still bounding the disruptive rare tail.
      scriptTimeBudgetMs: 12,
    });
    this.beginMatch();
    return true;
  }

  /** Starts ticking a room whose controller already exists — a normal
   * lobby-driven start() (built just above) and a resumed (load_match) room
   * (built entirely in the constructor) both end up here. */
  beginMatch(): void {
    this.broadcast({ type: 'match_started', mapId: this.mapId });
    this.broadcastSnapshot();
    this.startTicking();
  }

  handleMessage(owner: PlayerId, msg: ClientMessage): void {
    if (msg.type === 'start_match') {
      if (!this.start(owner)) {
        const reason = owner !== 'player'
          ? 'Only the host can start.'
          : this.playerCount() < 2
            ? 'Need at least two players.'
            : 'Every human player must be ready first.';
        this.send(owner, { type: 'error', message: reason });
      }
      return;
    }
    if (msg.type === 'update_slot') {
      this.updateSlot(owner, msg.side, msg.race, msg.team, msg.color, msg.ready);
      return;
    }
    if (msg.type === 'set_slot_state') {
      this.setSlotState(owner, msg.side, msg.state);
      return;
    }
    if (msg.type === 'add_ai_slot') {
      if (!this.addAiSlot(owner, msg.race, msg.name, msg.code)) {
        this.send(owner, { type: 'error', message: 'Could not add an AI slot — room may be full, already started, or you are not the host.' });
      }
      return;
    }
    if (msg.type === 'remove_ai_slot') {
      this.removeAiSlot(owner, msg.side);
      return;
    }
    if (!this.controller) return;
    if (msg.type === 'code_update') this.controller.setCode(owner, msg.code);
    else if (msg.type === 'trigger_function') this.controller.triggerFunction(owner, msg.name);
  }

  /** A joined player editing their own row's race/team/color/ready while
   * still in the lobby — rejected once the match has started (the lobby is
   * frozen at that point). The host may instead pass `targetSide` to
   * configure a bot slot it added; nobody may edit another human's row.
   * Changing race/team/color un-readies a human (they need to confirm
   * again) unless this same message also explicitly sets `ready`. */
  private updateSlot(
    owner: PlayerId,
    targetSide: PlayerId | undefined,
    race: RaceId | undefined,
    team: number | undefined,
    color: number | undefined,
    ready: boolean | undefined,
  ): void {
    if (this.controller) return;
    const side = targetSide ?? owner;
    if (side !== owner) {
      if (owner !== 'player') return;
      if (!this.participants[side]?.isAi) return;
    }
    const participant = this.participants[side];
    if (!participant) return;
    let changed = false;
    if (race !== undefined) {
      participant.race = race;
      changed = true;
    }
    if (team !== undefined) {
      if (!Number.isInteger(team) || team < 1 || team > PLAYER_ID_LIST.length) return;
      participant.team = team;
      changed = true;
    }
    if (color !== undefined) {
      if (!Number.isInteger(color) || color < 0 || color > 0xffffff) return;
      const takenByOther = PLAYER_ID_LIST.some((candidate) => candidate !== side && this.participants[candidate]?.color === color);
      if (takenByOther) return;
      participant.color = color;
      changed = true;
    }
    if (!participant.isAi && changed && ready === undefined) participant.ready = false;
    if (ready !== undefined && !participant.isAi) participant.ready = ready;
    this.broadcastLobby();
  }

  /** A disconnected human's AI keeps running once a match has started; their
   * slot stays reconnectable (see hasReconnectableSlot/addPlayer). Before
   * start, the slot is simply reopened for anyone to fill. */
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
      return p ? [{ side, name: p.name, race: p.race, team: p.team, color: p.color, isAi: p.isAi, ready: p.ready }] : [];
    });
  }

  private sendLobby(side: PlayerId): void { this.send(side, { type: 'lobby_state', players: this.lobbyPlayers(), closedSlots: [...this.closedSlots] }); }
  private broadcastLobby(): void { this.broadcast({ type: 'lobby_state', players: this.lobbyPlayers(), closedSlots: [...this.closedSlots] }); }

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
