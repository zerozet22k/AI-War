import type { PlayerId, RaceId, SimState } from '../types/game';
import type { StrategyConfig } from '../types/rules';
import type { MapId } from './maps';
import type { ActivityLogEntry, MatchPhase } from './matchController';
import type { AiDifficulty } from './ai/strategies';
import { loadJSON, saveJSON, removeKey } from '../utils/storage';
import { makeId } from '../utils/id';

export const SAVE_GAME_VERSION = 1;

/** Everything needed to fully resume a match — a snapshot of SimState plus
 * the bookkeeping (strategies, activity log, phase) that lives outside it on
 * MatchController. Script/rule engines' own persistent memory is NOT
 * captured (see Simulation's resumeState param) — a resumed match's AI
 * starts with fresh `let` variables, same as a freshly-started one. */
export interface SaveGameData {
  version: number;
  savedAt: number;
  label: string;
  mapId: MapId;
  activePlayers: PlayerId[];
  races: Partial<Record<PlayerId, RaceId>>;
  lobby: Partial<Record<PlayerId, { name?: string; team?: number; color?: number }>>;
  strategies: Partial<Record<PlayerId, StrategyConfig>>;
  aiDifficulty: AiDifficulty | null;
  phase: MatchPhase;
  activityLog: ActivityLogEntry[];
  simState: SimState;
  /** Informational only — a save always resumes as a local match by
   * default; loading it into a hosted multiplayer room is a separate,
   * explicit choice (see MultiplayerLobby's "Host as Multiplayer"). */
  networked: boolean;
}

/** Lightweight per-save listing entry, kept in its own small index so the
 * Load Game screen doesn't have to parse every full (potentially large)
 * SaveGameData blob just to render a list. */
export interface SaveSlotMeta {
  id: string;
  label: string;
  savedAt: number;
  mapId: MapId;
  matchDuration: number;
  networked: boolean;
  playerRace: RaceId;
}

const SAVES_INDEX_KEY = 'ai-war.saves.index.v1';
const MAX_SAVES = 20;
const saveDataKey = (id: string) => `ai-war.save.${id}.v1`;

export function listSaves(): SaveSlotMeta[] {
  const index = loadJSON<SaveSlotMeta[]>(SAVES_INDEX_KEY) ?? [];
  return [...index].sort((a, b) => b.savedAt - a.savedAt);
}

export function hasSaves(): boolean {
  return listSaves().length > 0;
}

/** The minimal shape captureSave() needs from whatever it's capturing —
 * both a local MatchController and a networked RemoteMatchController
 * satisfy this (see MatchView), so "Save Game" works identically either
 * way: local matches simulate for real, networked ones just mirror the
 * server's last snapshot, but both hold a complete, current SimState. */
export interface CapturableMatch {
  sim: { state: SimState };
  phase: MatchPhase;
  activityLog: ActivityLogEntry[];
  strategies: Record<PlayerId, StrategyConfig>;
}

export function captureSave(
  match: CapturableMatch,
  meta: { mapId: MapId; aiDifficulty: AiDifficulty | null; networked: boolean; label: string },
): SaveSlotMeta {
  const state = match.sim.state;
  const races = Object.fromEntries(
    state.activePlayers.map((p) => [p, state.players[p].race]),
  ) as Partial<Record<PlayerId, RaceId>>;
  const lobby = Object.fromEntries(
    state.activePlayers.map((p) => [p, { name: state.players[p].name, team: state.players[p].team, color: state.players[p].color }]),
  ) as Partial<Record<PlayerId, { name?: string; team?: number; color?: number }>>;
  const strategies = Object.fromEntries(
    state.activePlayers.map((p) => [p, match.strategies[p]]),
  ) as Partial<Record<PlayerId, StrategyConfig>>;

  const data: SaveGameData = {
    version: SAVE_GAME_VERSION,
    savedAt: Date.now(),
    label: meta.label,
    mapId: meta.mapId,
    activePlayers: [...state.activePlayers],
    races,
    lobby,
    strategies,
    aiDifficulty: meta.aiDifficulty,
    phase: match.phase,
    activityLog: match.activityLog,
    simState: state,
    networked: meta.networked,
  };

  const id = makeId('save');
  saveJSON(saveDataKey(id), data);
  const slotMeta: SaveSlotMeta = {
    id,
    label: meta.label,
    savedAt: data.savedAt,
    mapId: meta.mapId,
    matchDuration: state.time,
    networked: meta.networked,
    playerRace: state.players.player.race,
  };
  saveJSON(SAVES_INDEX_KEY, [slotMeta, ...listSaves()].slice(0, MAX_SAVES));
  return slotMeta;
}

export function loadSave(id: string): SaveGameData | null {
  return loadJSON<SaveGameData>(saveDataKey(id));
}

export function deleteSave(id: string): void {
  removeKey(saveDataKey(id));
  saveJSON(SAVES_INDEX_KEY, listSaves().filter((s) => s.id !== id));
}
