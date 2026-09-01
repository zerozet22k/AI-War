// Wire format shared by the client (src/net/) and the server (server/) —
// the single source of truth for what a networked match sends over the
// WebSocket. Kept deliberately small: the server is the only place
// Simulation/MatchController actually run (see the "Real networked
// multiplayer" architecture note in the README), so clients only ever send
// inputs and receive snapshots.

import type { PlayerId, RaceId, SimState } from '../types/game';
import type { MapId } from '../game/maps';

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

export interface LobbyPlayer {
  side: PlayerId;
  name: string;
  race: RaceId;
}

// --- Client -> Server ---

export type ClientMessage =
  | { type: 'create_match'; name: string; code: string; race: RaceId; mapId: MapId }
  | { type: 'join_match'; roomCode: string; name: string; code: string; race: RaceId }
  | { type: 'start_match' }
  | { type: 'code_update'; code: string }
  | { type: 'trigger_function'; name: string };

// --- Server -> Client ---

export type ServerMessage =
  | { type: 'joined'; roomCode: string; side: PlayerId; isHost: boolean; mapId: MapId }
  | { type: 'lobby_state'; players: LobbyPlayer[] }
  | { type: 'match_started'; mapId: MapId }
  | { type: 'snapshot'; payload: SnapshotPayload }
  | { type: 'player_left'; side: PlayerId }
  | { type: 'error'; message: string };
