import { create } from 'zustand';
import type { PlayerId, RaceId } from '../types/game';
import { MultiplayerClient } from './MultiplayerClient';
import { RemoteMatchController } from './RemoteMatchController';
import type { LobbyPlayer, ServerMessage } from './protocol';
import type { MapId } from '../game/maps';

/** Derives the WS server URL from wherever this page was loaded from, so
 * "two tabs on localhost" and "two machines on the same LAN" (Vite started
 * with --host) both just work without hardcoding an address. The server
 * always listens on PORT (see server/index.ts) regardless of which host
 * reached it. */
function serverUrl(): string {
  const port = 8787;
  return `ws://${window.location.hostname}:${port}`;
}

interface MultiplayerState {
  client: MultiplayerClient | null;
  controller: RemoteMatchController | null;
  roomCode: string | null;
  side: PlayerId | null;
  players: LobbyPlayer[];
  isHost: boolean;
  matchStarted: boolean;
  mapId: MapId | null;
  disconnectedPlayers: PlayerId[];
  connecting: boolean;
  error: string | null;

  createMatch: (name: string, code: string, race: RaceId, mapId: MapId) => Promise<void>;
  joinMatch: (roomCode: string, name: string, code: string, race: RaceId) => Promise<void>;
  startMatch: () => void;
  leaveMatch: () => void;
}

export const useMultiplayerStore = create<MultiplayerState>((set, get) => {
  /** Connects and wires up message handling; the caller sends the initial
   * create_match/join_match once this resolves. `client` is declared before
   * `connect()` is called so the onMessage closure (which only actually runs
   * later, after the connection is up) can reference it — needed to
   * construct RemoteMatchController, which sends messages back through it. */
  async function connectAndAttach(playerCode: string): Promise<MultiplayerClient | null> {
    const client = new MultiplayerClient();
    try {
      await client.connect(serverUrl(), {
        onMessage: (msg: ServerMessage) => {
          if (msg.type === 'joined') {
            const controller = new RemoteMatchController(client, msg.side, playerCode);
            set({ controller, roomCode: msg.roomCode, side: msg.side, isHost: msg.isHost, mapId: msg.mapId, connecting: false });
          } else if (msg.type === 'lobby_state') {
            set({ players: msg.players });
          } else if (msg.type === 'match_started') {
            set({ matchStarted: true, mapId: msg.mapId });
          } else if (msg.type === 'snapshot') {
            get().controller?.applySnapshot(msg.payload);
          } else if (msg.type === 'player_left') {
            set((state) => ({ disconnectedPlayers: [...new Set([...state.disconnectedPlayers, msg.side])] }));
          } else if (msg.type === 'error') {
            set({ error: msg.message, connecting: false });
          }
        },
        onClose: () => set((s) => ({ error: s.error ?? 'Disconnected from the server.' })),
        onError: (message) => set({ error: message, connecting: false }),
      });
    } catch {
      set({ connecting: false, error: 'Could not reach the multiplayer server. Is it running (npm run server)?' });
      return null;
    }
    return client;
  }

  return {
    client: null,
    controller: null,
    roomCode: null,
    side: null,
    players: [],
    isHost: false,
    matchStarted: false,
    mapId: null,
    disconnectedPlayers: [],
    connecting: false,
    error: null,

    createMatch: async (name, code, race, mapId) => {
      set({ connecting: true, error: null, players: [], isHost: false, matchStarted: false, disconnectedPlayers: [] });
      const client = await connectAndAttach(code);
      if (!client) return;
      client.send({ type: 'create_match', name, code, race, mapId });
      set({ client, mapId });
    },

    joinMatch: async (roomCode, name, code, race) => {
      set({ connecting: true, error: null, players: [], isHost: false, matchStarted: false, disconnectedPlayers: [] });
      const client = await connectAndAttach(code);
      if (!client) return;
      client.send({ type: 'join_match', roomCode, name, code, race });
      set({ client });
    },

    startMatch: () => get().client?.send({ type: 'start_match' }),

    leaveMatch: () => {
      get().client?.disconnect();
      set({ client: null, controller: null, roomCode: null, side: null, players: [], isHost: false, matchStarted: false, mapId: null, disconnectedPlayers: [], error: null, connecting: false });
    },
  };
});
