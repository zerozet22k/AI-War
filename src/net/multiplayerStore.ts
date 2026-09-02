import { create } from 'zustand';
import type { PlayerId, RaceId } from '../types/game';
import { MultiplayerClient } from './MultiplayerClient';
import { RemoteMatchController } from './RemoteMatchController';
import type { LanServerInfo, LobbyPlayer, ServerMessage } from './protocol';
import type { MapId } from '../game/maps';
import type { SaveGameData } from '../game/saveGame';

/** Derives the WS server URL from wherever this page was loaded from, so
 * "two tabs on localhost" and "two machines on the same LAN" (Vite started
 * with --host) both just work without hardcoding an address. The server
 * always listens on PORT (see server/index.ts) regardless of which host
 * reached it. An explicit `hostOverride` ("192.168.1.42:8787") instead
 * targets a peer discovered via LAN scan — that peer's own server, not this
 * machine's local one. */
function serverUrl(hostOverride?: string): string {
  if (hostOverride) return `ws://${hostOverride}`;
  const port = 8787;
  return `ws://${window.location.hostname}:${port}`;
}

/** Fields a joined player can change about their own (or, for the host, an
 * AI slot's) row — see update_slot in protocol.ts. */
export interface SlotPatch {
  race?: RaceId;
  team?: number;
  color?: number;
  ready?: boolean;
}

interface MultiplayerState {
  client: MultiplayerClient | null;
  controller: RemoteMatchController | null;
  roomCode: string | null;
  side: PlayerId | null;
  players: LobbyPlayer[];
  closedSlots: PlayerId[];
  isHost: boolean;
  matchStarted: boolean;
  mapId: MapId | null;
  disconnectedPlayers: PlayerId[];
  connecting: boolean;
  error: string | null;

  /** A lightweight, separate connection to this machine's own local server
   * purely to receive its relayed `lan_servers` pushes while browsing the
   * lobby — never reused for an actual create/join/load (those always open
   * their own connection, possibly to a different, discovered peer). */
  discoveryClient: MultiplayerClient | null;
  lanServers: LanServerInfo[];
  connectForDiscovery: () => void;
  disconnectDiscovery: () => void;

  /** Race is never chosen before joining — only name/code (your AI script)
   * and, for create, the map. Everyone picks their race, team, and color
   * inside the room once connected, same as team/color already worked. */
  createMatch: (name: string, code: string, mapId: MapId) => Promise<void>;
  joinMatch: (roomCode: string, name: string, code: string, hostOverride?: string) => Promise<void>;
  loadMatch: (name: string, code: string, save: SaveGameData) => Promise<void>;
  startMatch: () => void;
  updateSlot: (patch: SlotPatch, side?: PlayerId) => void;
  setSlotState: (side: PlayerId, state: 'closed' | 'open') => void;
  addAiSlot: (race: RaceId, name: string, code: string) => void;
  removeAiSlot: (side: PlayerId) => void;
  leaveMatch: () => void;
}

export const useMultiplayerStore = create<MultiplayerState>((set, get) => {
  // Read by the 'joined' handler below at the time it actually fires, not
  // at connect time — lets connectForDiscovery() open a connection before
  // anyone has decided to host/join/load anything yet.
  let latestPlayerCode = '';

  /** Connects and wires up message handling; the caller sends the initial
   * create_match/join_match/load_match once this resolves. `client` is
   * declared before `connect()` is called so the onMessage closure (which
   * only actually runs later, after the connection is up) can reference it
   * — needed to construct RemoteMatchController, which sends messages back
   * through it. */
  async function connectAndAttach(hostOverride?: string): Promise<MultiplayerClient | null> {
    const client = new MultiplayerClient();
    try {
      await client.connect(serverUrl(hostOverride), {
        onMessage: (msg: ServerMessage) => {
          if (msg.type === 'joined') {
            const controller = new RemoteMatchController(client, msg.side, latestPlayerCode);
            set({ controller, roomCode: msg.roomCode, side: msg.side, isHost: msg.isHost, mapId: msg.mapId, connecting: false });
          } else if (msg.type === 'lobby_state') {
            set({ players: msg.players, closedSlots: msg.closedSlots });
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
    closedSlots: [],
    isHost: false,
    matchStarted: false,
    mapId: null,
    disconnectedPlayers: [],
    connecting: false,
    error: null,

    discoveryClient: null,
    lanServers: [],

    connectForDiscovery: () => {
      if (get().discoveryClient) return;
      const client = new MultiplayerClient();
      client
        .connect(serverUrl(), {
          onMessage: (msg) => {
            if (msg.type === 'lan_servers') set({ lanServers: msg.servers });
          },
          onClose: () => set({ discoveryClient: null, lanServers: [] }),
        })
        .catch(() => set({ discoveryClient: null }));
      set({ discoveryClient: client });
    },
    disconnectDiscovery: () => {
      get().discoveryClient?.disconnect();
      set({ discoveryClient: null, lanServers: [] });
    },

    createMatch: async (name, code, mapId) => {
      latestPlayerCode = code;
      set({ connecting: true, error: null, players: [], closedSlots: [], isHost: false, matchStarted: false, disconnectedPlayers: [] });
      const client = await connectAndAttach();
      if (!client) return;
      client.send({ type: 'create_match', name, code, mapId });
      set({ client, mapId });
    },

    joinMatch: async (roomCode, name, code, hostOverride) => {
      latestPlayerCode = code;
      set({ connecting: true, error: null, players: [], closedSlots: [], isHost: false, matchStarted: false, disconnectedPlayers: [] });
      const client = await connectAndAttach(hostOverride);
      if (!client) return;
      client.send({ type: 'join_match', roomCode, name, code });
      set({ client });
    },

    loadMatch: async (name, code, save) => {
      latestPlayerCode = code;
      set({ connecting: true, error: null, players: [], closedSlots: [], isHost: false, matchStarted: false, disconnectedPlayers: [] });
      const client = await connectAndAttach();
      if (!client) return;
      client.send({ type: 'load_match', name, code, save });
      set({ client, mapId: save.mapId });
    },

    startMatch: () => get().client?.send({ type: 'start_match' }),

    updateSlot: (patch, side) => get().client?.send({ type: 'update_slot', side, ...patch }),
    setSlotState: (side, state) => get().client?.send({ type: 'set_slot_state', side, state }),
    addAiSlot: (race, name, code) => get().client?.send({ type: 'add_ai_slot', race, name, code }),
    removeAiSlot: (side) => get().client?.send({ type: 'remove_ai_slot', side }),

    leaveMatch: () => {
      get().client?.disconnect();
      set({ client: null, controller: null, roomCode: null, side: null, players: [], closedSlots: [], isHost: false, matchStarted: false, mapId: null, disconnectedPlayers: [], error: null, connecting: false });
    },
  };
});
