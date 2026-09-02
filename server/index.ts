import { WebSocketServer, WebSocket } from 'ws';
import dgram from 'node:dgram';
import os from 'node:os';
import { Room } from './room';
import type { ClientMessage, LanServerInfo, ServerMessage } from '../src/net/protocol';
import type { PlayerId } from '../src/types/game';
import { isMapId } from '../src/game/maps';
import type { SaveGameData } from '../src/game/saveGame';

const PORT = Number(process.env.PORT ?? 8787);
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I — easier to read aloud/type
const ROOM_CODE_LENGTH = 5;

const rooms = new Map<string, Room>();

function makeRoomCode(): string {
  let code: string;
  do {
    code = Array.from({ length: ROOM_CODE_LENGTH }, () => ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

// ---------------------------------------------------------------------
// LAN discovery: replaces "type in a room code" with "see it in a list".
// Every server instance both announces its own open rooms and listens for
// everyone else's announcements over UDP broadcast on the LAN segment —
// no signaling server needed, and it works identically whether this
// process is `npm run server`/tsx or the Electron app's bundled copy,
// since both are plain Node. Browsers can't do UDP at all, which is
// exactly why this lives server-side and gets relayed to clients over the
// WebSocket connection they already have open to their OWN local server.
// ---------------------------------------------------------------------
const DISCOVERY_PORT = 41235;
const BROADCAST_INTERVAL_MS = 2000;
const PEER_EXPIRY_MS = 6000;

interface DiscoveryAnnouncement {
  type: 'avera_lan';
  wsPort: number;
  hostName: string;
  rooms: LanServerInfo['rooms'];
}

interface DiscoveredPeer {
  addr: string;
  hostName: string;
  rooms: LanServerInfo['rooms'];
  lastSeenAt: number;
}

const discoveredPeers = new Map<string, DiscoveredPeer>();
const wsSockets = new Set<WebSocket>();

function isDiscoveryAnnouncement(value: unknown): value is DiscoveryAnnouncement {
  return typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'avera_lan';
}

function pruneAndListPeers(): LanServerInfo[] {
  const now = Date.now();
  for (const [key, peer] of discoveredPeers) {
    if (now - peer.lastSeenAt > PEER_EXPIRY_MS) discoveredPeers.delete(key);
  }
  return [...discoveredPeers.values()].map(({ addr, hostName, rooms }) => ({ addr, hostName, rooms }));
}

function pushLanServers(): void {
  const msg: ServerMessage = { type: 'lan_servers', servers: pruneAndListPeers() };
  const payload = JSON.stringify(msg);
  for (const socket of wsSockets) if (socket.readyState === WebSocket.OPEN) socket.send(payload);
}

const discoverySocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
discoverySocket.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('LAN discovery socket error (continuing without it):', err.message);
});
discoverySocket.on('message', (msg, rinfo) => {
  try {
    const data: unknown = JSON.parse(msg.toString());
    if (!isDiscoveryAnnouncement(data)) return;
    const addr = `${rinfo.address}:${data.wsPort}`;
    discoveredPeers.set(addr, { addr, hostName: data.hostName, rooms: data.rooms, lastSeenAt: Date.now() });
  } catch {
    // ignore malformed datagrams from anything else on the LAN
  }
});
try {
  discoverySocket.bind(DISCOVERY_PORT, () => {
    discoverySocket.setBroadcast(true);
  });
} catch {
  // best-effort — a match still works over a manually-entered room code
  // even if UDP discovery can't bind (e.g. port already in use locally)
}

setInterval(() => {
  const announcement: DiscoveryAnnouncement = {
    type: 'avera_lan',
    wsPort: PORT,
    hostName: os.hostname(),
    rooms: [...rooms.values()].map((room) => room.summary()),
  };
  try {
    const payload = Buffer.from(JSON.stringify(announcement));
    discoverySocket.send(payload, DISCOVERY_PORT, '255.255.255.255');
  } catch {
    // ignore — discovery is best-effort
  }
  pushLanServers();
}, BROADCAST_INTERVAL_MS);

// ---------------------------------------------------------------------

const wss = new WebSocketServer({ port: PORT });
// eslint-disable-next-line no-console
console.log(`AVERA multiplayer server listening on ws://localhost:${PORT}`);

wss.on('connection', (socket: WebSocket) => {
  let joinedRoom: Room | null = null;
  let side: PlayerId | null = null;
  wsSockets.add(socket);

  function send(msg: ServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
  }

  // Every newly-connected client gets today's LAN list immediately instead
  // of waiting up to BROADCAST_INTERVAL_MS for the first periodic push.
  send({ type: 'lan_servers', servers: pruneAndListPeers() });

  socket.on('message', (raw: Buffer) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send({ type: 'error', message: 'Malformed message.' });
      return;
    }

    if (msg.type === 'create_match') {
      if (!isMapId(msg.mapId)) {
        send({ type: 'error', message: 'Choose a valid map before creating the match.' });
        return;
      }
      const code = makeRoomCode();
      const room = new Room(code, socket, msg.code, msg.name, msg.mapId);
      rooms.set(code, room);
      joinedRoom = room;
      side = 'player';
      room.sendJoined('player');
      return;
    }

    if (msg.type === 'load_match') {
      const save = msg.save as SaveGameData | undefined;
      if (!save || !Array.isArray(save.activePlayers) || save.activePlayers.length < 2 || !save.simState) {
        send({ type: 'error', message: 'That save file looks invalid.' });
        return;
      }
      const code = makeRoomCode();
      const room = new Room(code, socket, msg.code, msg.name, save.mapId, save);
      rooms.set(code, room);
      joinedRoom = room;
      side = 'player';
      room.sendJoined('player');
      room.beginMatch();
      return;
    }

    if (msg.type === 'join_match') {
      const room = rooms.get(msg.roomCode.trim().toUpperCase());
      if (!room) {
        send({ type: 'error', message: `No match with code "${msg.roomCode}".` });
        return;
      }
      if (!room.canJoin()) {
        send({ type: 'error', message: room.isFull() ? 'That match is already full.' : 'That match has already started and has no open seats.' });
        return;
      }
      const assignedSide = room.addPlayer(socket, msg.code, msg.name);
      if (!assignedSide) {
        send({ type: 'error', message: 'No open player slot remains.' });
        return;
      }
      joinedRoom = room;
      side = assignedSide;
      room.sendJoined(assignedSide);
      return;
    }

    if (!joinedRoom || !side) {
      send({ type: 'error', message: 'Not in a match yet — create or join one first.' });
      return;
    }
    joinedRoom.handleMessage(side, msg);
  });

  socket.on('close', () => {
    wsSockets.delete(socket);
    if (joinedRoom && side) {
      if (joinedRoom.removeSocket(side)) rooms.delete(joinedRoom.code);
    }
  });
});
