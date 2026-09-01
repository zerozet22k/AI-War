import { WebSocketServer, WebSocket } from 'ws';
import { Room } from './room';
import type { ClientMessage, ServerMessage } from '../src/net/protocol';
import { RACE_ID_LIST, type PlayerId, type RaceId } from '../src/types/game';
import { isMapId } from '../src/game/maps';

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

function isRaceId(value: unknown): value is RaceId {
  return typeof value === 'string' && (RACE_ID_LIST as readonly string[]).includes(value);
}

const wss = new WebSocketServer({ port: PORT });
// eslint-disable-next-line no-console
console.log(`AEVRA multiplayer server listening on ws://localhost:${PORT}`);

wss.on('connection', (socket: WebSocket) => {
  let joinedRoom: Room | null = null;
  let side: PlayerId | null = null;

  function send(msg: ServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
  }

  socket.on('message', (raw: Buffer) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send({ type: 'error', message: 'Malformed message.' });
      return;
    }

    if (msg.type === 'create_match') {
      if (!isRaceId(msg.race)) {
        send({ type: 'error', message: 'Choose a valid race before creating the match.' });
        return;
      }
      if (!isMapId(msg.mapId)) {
        send({ type: 'error', message: 'Choose a valid map before creating the match.' });
        return;
      }
      const code = makeRoomCode();
      const room = new Room(code, socket, msg.code, msg.name, msg.race, msg.mapId);
      rooms.set(code, room);
      joinedRoom = room;
      side = 'player';
      room.sendJoined('player');
      return;
    }

    if (msg.type === 'join_match') {
      if (!isRaceId(msg.race)) {
        send({ type: 'error', message: 'Choose a valid race before joining the match.' });
        return;
      }
      const room = rooms.get(msg.roomCode.trim().toUpperCase());
      if (!room) {
        send({ type: 'error', message: `No match with code "${msg.roomCode}".` });
        return;
      }
      if (room.isStarted() || room.isFull()) {
        send({ type: 'error', message: room.isStarted() ? 'That match has already started.' : 'That match already has four players.' });
        return;
      }
      const assignedSide = room.addPlayer(socket, msg.code, msg.name, msg.race);
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
    if (joinedRoom && side) {
      if (joinedRoom.removeSocket(side)) rooms.delete(joinedRoom.code);
    }
  });
});
