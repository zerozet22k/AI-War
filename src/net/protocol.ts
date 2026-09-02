// Wire format shared by the client (src/net/) and the server (server/) —
// the single source of truth for what a networked match sends over the
// WebSocket. Kept deliberately small: the server is the only place
// Simulation/MatchController actually run (see the "Real networked
// multiplayer" architecture note in the README), so clients only ever send
// inputs and receive snapshots.

import type { PlayerId, RaceId, SimState } from '../types/game';
import type { MapId } from '../game/maps';
import type { SaveGameData } from '../game/saveGame';

export interface NetActivityLogEntry {
  time: number;
  message: string;
}

export type NetMatchPhase = 'running' | 'ended';

/** Everything a client needs to render one frame of a networked match. Both
 * players receive the exact same payload — which side is "you" comes from
 * the `side` the server assigned at join time (see the `joined` message),
 * not from anything in the snapshot itself. */
export interface SnapshotPayload {
  sim: SimState;
  phase: NetMatchPhase;
  activityLog: NetActivityLogEntry[];
  codes: Record<PlayerId, string>;
}

/** An occupied slot — human or AI. Race/team/color are all chosen inside the
 * room (never before joining), same as a local skirmish's lobby. */
export interface LobbyPlayer {
  side: PlayerId;
  name: string;
  race: RaceId;
  /** Optional team grouping — see PlayerState.team. Defaults to a distinct
   * number per slot (plain free-for-all); two players set to the same
   * number become allies. */
  team: number;
  color: number;
  /** True for a bot slot the host filled with "Add AI" — has no socket and
   * never will, unlike a merely-disconnected human's slot. */
  isAi: boolean;
  /** A human confirming their race/team/color choice is final — the host
   * can't start until every human slot is ready (a bot is always
   * effectively ready, it has no settings left to confirm). Changing your
   * own race/team/color un-readies you again, same as classic RTS lobbies. */
  ready: boolean;
}

export interface LanRoomSummary {
  code: string;
  hostName: string;
  playerCount: number;
  maxPlayers: number;
  mapId: MapId;
  started: boolean;
  joinable: boolean;
}

/** One other AVERA server instance heard on the LAN via UDP broadcast (see
 * server/index.ts's discovery loop) — `addr` is `host:wsPort`, ready to pass
 * straight to MultiplayerClient as a join target, no manual IP entry. */
export interface LanServerInfo {
  addr: string;
  hostName: string;
  rooms: LanRoomSummary[];
}

// --- Client -> Server ---

export type ClientMessage =
  | { type: 'create_match'; name: string; code: string; mapId: MapId }
  | { type: 'join_match'; roomCode: string; name: string; code: string }
  /** Creates a room seeded from a previously-saved match (see
   * game/saveGame.ts) instead of a fresh one — the sender always becomes
   * 'player'; every other originally-active slot is recreated exactly as
   * saved (race/team/color/code) with no live socket, waiting for its
   * original occupant (or anyone else) to reclaim it via join_match. */
  | { type: 'load_match'; name: string; code: string; save: SaveGameData }
  | { type: 'start_match' }
  | { type: 'code_update'; code: string }
  | { type: 'trigger_function'; name: string }
  /** Sent by a joined player to change their own row's race/team/color/ready
   * while still in the lobby (rejected once the match has started). The
   * host may additionally target another slot's `side` — but only an AI
   * one, to configure a bot it added; a human's own row is theirs alone.
   * Changing race/team/color implicitly clears `ready` unless this same
   * message also explicitly sets it. */
  | { type: 'update_slot'; side?: PlayerId; race?: RaceId; team?: number; color?: number; ready?: boolean }
  /** Host-only: opens or closes an empty slot (must have nobody — human or
   * AI — in it already). A closed slot can't be joined or filled with AI;
   * an open-but-never-filled slot at start time is simply not part of the
   * match, same as closed — the difference only matters while still in the
   * lobby (open invites someone to fill it, closed says nobody should). */
  | { type: 'set_slot_state'; side: PlayerId; state: 'closed' | 'open' }
  /** Host-only: fills the next open slot with a bot running the given
   * script (built client-side via createOpponentStrategy, the same helper
   * local skirmish AI uses — the server has no doctrine-script assets of
   * its own to generate one from). */
  | { type: 'add_ai_slot'; race: RaceId; name: string; code: string }
  /** Host-only: removes a bot slot (never a human's) before the match starts. */
  | { type: 'remove_ai_slot'; side: PlayerId };

// --- Server -> Client ---

export type ServerMessage =
  | { type: 'joined'; roomCode: string; side: PlayerId; isHost: boolean; mapId: MapId }
  | { type: 'lobby_state'; players: LobbyPlayer[]; closedSlots: PlayerId[] }
  | { type: 'match_started'; mapId: MapId }
  | { type: 'snapshot'; payload: SnapshotPayload }
  | { type: 'player_left'; side: PlayerId }
  /** Periodic push of every other AVERA server instance heard on the LAN —
   * lets the lobby list joinable rooms without anyone typing a code. */
  | { type: 'lan_servers'; servers: LanServerInfo[] }
  | { type: 'error'; message: string };
