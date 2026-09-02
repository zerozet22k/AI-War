import { create } from 'zustand';
import { PLAYER_ID_LIST, RACE_ID_LIST, type Entity, type MatchResult, type MatchStats, type PlayerId, type RaceId, type ResearchType, type Vector2 } from '../types/game';
import type { StrategyConfig } from '../types/rules';
import type { ActivityLogEntry, MatchPhase } from '../game/matchController';
import { createDefaultStrategy, normalizeStrategy, type AiDifficulty } from '../game/ai/strategies';
import { loadJSON, saveJSON } from '../utils/storage';
import type { ScriptError } from '../game/ai/script/errors';
import { DEFAULT_KEYBIND_SCRIPT, compileKeybinds } from './keybindScript';
import { DEFAULT_MAP_ID, MAPS, type MapId } from '../game/maps';
import type { SaveGameData } from '../game/saveGame';

export type Screen = 'menu' | 'lobby' | 'strategyEditor' | 'match' | 'settings' | 'multiplayerLobby' | 'apiReference' | 'loadGame';

const STRATEGY_STORAGE_KEY = 'ai-war.strategy.v1';
const RACE_STRATEGIES_STORAGE_KEY = 'ai-war.raceStrategies.v1';
const KEYBIND_SCRIPT_STORAGE_KEY = 'ai-war.keybindScript.v1';
const MATCH_SETUP_STORAGE_KEY = 'ai-war.matchSetup.v1';
const CAMERA_SETTINGS_STORAGE_KEY = 'ai-war.cameraSettings.v1';

/** Multipliers on top of MainScene's base camera-control constants — 1 means
 * "unchanged from the hardcoded default." Covers every way the camera moves:
 * WASD/arrows, edge-of-screen panning, right-drag panning, and wheel zoom. */
export interface CameraSettings {
  panSpeed: number;
  zoomSpeed: number;
}

const DEFAULT_CAMERA_SETTINGS: CameraSettings = { panSpeed: 1, zoomSpeed: 1 };

/** Default per-slot colors, matching Simulation.ts's own DEFAULT_OWNER_COLOR
 * — an unconfigured lobby row renders exactly as the game always has. */
const DEFAULT_SLOT_COLORS = [0x3b82f6, 0xef4444, 0x22c55e, 0xf59e0b] as const;

export interface LocalOpponentSetup {
  race: RaceId;
  aiDifficulty: AiDifficulty;
  /** Optional team grouping — see PlayerState.team. Defaults (below) give
   * every slot its own distinct number, i.e. plain free-for-all; set two
   * slots to the same number to make them allies. */
  team: number;
  color: number;
}

export interface LocalMatchSetup {
  playerRace: RaceId;
  playerTeam: number;
  playerColor: number;
  mapId: MapId;
  /** AI-controlled slots beyond the human player, in PLAYER_ID_LIST order
   * (enemy, player3, player4) — only the first `activeOpponentCount` of
   * these are actually used when a match starts. */
  opponents: LocalOpponentSetup[];
  activeOpponentCount: 1 | 2 | 3;
}

const DEFAULT_MATCH_SETUP: LocalMatchSetup = {
  playerRace: 'ironclad',
  playerTeam: 1,
  playerColor: DEFAULT_SLOT_COLORS[0],
  mapId: DEFAULT_MAP_ID,
  opponents: [
    { race: 'aether', aiDifficulty: 'standard', team: 2, color: DEFAULT_SLOT_COLORS[1] },
    { race: 'nullforge', aiDifficulty: 'standard', team: 3, color: DEFAULT_SLOT_COLORS[2] },
    { race: 'ironclad', aiDifficulty: 'standard', team: 4, color: DEFAULT_SLOT_COLORS[3] },
  ],
  activeOpponentCount: 1,
};

type RaceStrategies = Record<RaceId, StrategyConfig>;

const INITIAL_MATCH_SETUP: LocalMatchSetup = {
  ...DEFAULT_MATCH_SETUP,
  ...(loadJSON<Partial<LocalMatchSetup>>(MATCH_SETUP_STORAGE_KEY) ?? {}),
};

function initialRaceStrategies(): RaceStrategies {
  const saved = loadJSON<Partial<RaceStrategies>>(RACE_STRATEGIES_STORAGE_KEY) ?? {};
  const result = Object.fromEntries(RACE_ID_LIST.map((race) => [
    race,
    saved[race] ? normalizeStrategy(saved[race]!, race) : createDefaultStrategy('Balanced Default', race),
  ])) as RaceStrategies;
  const legacy = loadJSON<StrategyConfig>(STRATEGY_STORAGE_KEY);
  if (legacy && !saved[INITIAL_MATCH_SETUP.playerRace]) {
    result[INITIAL_MATCH_SETUP.playerRace] = normalizeStrategy(legacy, INITIAL_MATCH_SETUP.playerRace);
  }
  return result;
}

const INITIAL_RACE_STRATEGIES = initialRaceStrategies();

function emptyMatchStats(): MatchStats {
  return { unitsCreated: 0, unitsLost: 0, buildingsConstructed: 0, resourcesGathered: 0 };
}

export interface HudPlayerInfo {
  name: string;
  color: number;
  team: number;
}

export interface HudSnapshot {
  matchPhase: MatchPhase;
  resources: Record<PlayerId, number>;
  unitCounts: Record<PlayerId, number>;
  armyStrength: Record<PlayerId, number>;
  matchResult: MatchResult | null;
  stats: Record<PlayerId, MatchStats>;
  activityLog: ActivityLogEntry[];
  matchDuration: number;
  activePlayers: PlayerId[];
  completedResearch: Record<PlayerId, ResearchType[]>;
  players: Record<PlayerId, HudPlayerInfo>;
}

function createInitialHud(): HudSnapshot {
  return {
    matchPhase: 'running',
    resources: Object.fromEntries(PLAYER_ID_LIST.map((owner) => [owner, 200])) as Record<PlayerId, number>,
    unitCounts: Object.fromEntries(PLAYER_ID_LIST.map((owner) => [owner, owner === 'player' || owner === 'enemy' ? 1 : 0])) as Record<PlayerId, number>,
    armyStrength: Object.fromEntries(PLAYER_ID_LIST.map((owner) => [owner, 0])) as Record<PlayerId, number>,
    matchResult: null,
    stats: Object.fromEntries(PLAYER_ID_LIST.map((owner) => [owner, emptyMatchStats()])) as Record<PlayerId, MatchStats>,
    activityLog: [],
    matchDuration: 0,
    activePlayers: ['player', 'enemy'],
    completedResearch: Object.fromEntries(PLAYER_ID_LIST.map((owner) => [owner, [] as ResearchType[]])) as Record<PlayerId, ResearchType[]>,
    players: Object.fromEntries(PLAYER_ID_LIST.map((owner, index) => [
      owner,
      { name: owner, color: DEFAULT_SLOT_COLORS[index], team: index },
    ])) as Record<PlayerId, HudPlayerInfo>,
  };
}

interface AppState {
  screen: Screen;

  playerStrategy: StrategyConfig;
  raceStrategies: RaceStrategies;
  setPlayerStrategy: (strategy: StrategyConfig) => void;
  saveStrategy: () => void;
  loadSavedStrategy: () => void;
  loadDefaultStrategy: () => void;

  localMatchSetup: LocalMatchSetup;
  setPlayerRace: (race: RaceId) => void;
  setPlayerTeam: (team: number) => void;
  setPlayerColor: (color: number) => void;
  setMapId: (mapId: MapId) => void;
  setOpponentCount: (count: 1 | 2 | 3) => void;
  setOpponentRace: (index: number, race: RaceId) => void;
  setOpponentDifficulty: (index: number, difficulty: AiDifficulty) => void;
  setOpponentTeam: (index: number, team: number) => void;
  setOpponentColor: (index: number, color: number) => void;

  keybindScript: string;
  keybinds: Record<string, string>; // derived from keybindScript: normalized key code -> action id (or a script function name)
  keybindErrors: ScriptError[];
  setKeybindScript: (script: string) => void;
  resetKeybindScript: () => void;

  hud: HudSnapshot;
  setHud: (hud: HudSnapshot) => void;

  /** "📍 Pick position" in the code editor: arms the next map click to
   * insert its coordinate into the editor instead of anything else. */
  pendingCoordinateInsert: boolean;
  beginCoordinateInsert: () => void;
  cancelCoordinateInsert: () => void;
  insertedCoordinate: Vector2 | null;
  resolveCoordinateInsert: (position: Vector2) => void;
  clearInsertedCoordinate: () => void;

  goTo: (screen: Screen) => void;
  matchStartToken: number;
  startNewMatch: () => void;

  /** A save picked from the Load Game screen, waiting to be consumed by
   * whichever screen the user sends it to next — MatchScreen resumes it
   * locally, or MultiplayerLobby uploads it to host as a resumed room.
   * Cleared once consumed (or if the user backs out beforehand). */
  pendingLoadedSave: SaveGameData | null;
  setPendingLoadedSave: (save: SaveGameData | null) => void;
  loadSavedMatch: (save: SaveGameData) => void;

  /** One id for a plain click, several for a drag-select box — inspection
   * only (see SelectedEntityPanel): this is a "script war," so there is no
   * command-issuing UI here, just a way to read the battle state better. */
  selectedEntityIds: string[];
  selectedEntitySnapshots: Entity[];
  setSelectedEntities: (ids: string[]) => void;
  setSelectedEntitySnapshots: (entities: Entity[]) => void;

  /** When set, MainScene's per-frame camera update keeps this unit centered
   * — cleared automatically the moment the player takes manual control of
   * the camera (WASD/arrows, right-drag, or the minimap) or the unit stops
   * existing (dies, or a fresh match starts). */
  followEntityId: string | null;
  setFollowEntity: (id: string | null) => void;

  isPaused: boolean;
  togglePause: () => void;
  simSpeed: number;
  setSimSpeed: (speed: number) => void;

  cameraSettings: CameraSettings;
  setCameraSettings: (settings: Partial<CameraSettings>) => void;
  resetCameraSettings: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  screen: 'menu',

  playerStrategy: INITIAL_RACE_STRATEGIES[INITIAL_MATCH_SETUP.playerRace],
  raceStrategies: INITIAL_RACE_STRATEGIES,
  setPlayerStrategy: (strategy) => set((state) => ({
    playerStrategy: strategy,
    raceStrategies: { ...state.raceStrategies, [state.localMatchSetup.playerRace]: strategy },
  })),
  saveStrategy: () => {
    const state = get();
    const raceStrategies = { ...state.raceStrategies, [state.localMatchSetup.playerRace]: state.playerStrategy };
    saveJSON(RACE_STRATEGIES_STORAGE_KEY, raceStrategies);
    saveJSON(STRATEGY_STORAGE_KEY, state.playerStrategy);
  },
  loadSavedStrategy: () => {
    const race = get().localMatchSetup.playerRace;
    const savedByRace = loadJSON<Partial<RaceStrategies>>(RACE_STRATEGIES_STORAGE_KEY);
    const saved = savedByRace?.[race] ?? loadJSON<StrategyConfig>(STRATEGY_STORAGE_KEY);
    if (saved) {
      const strategy = normalizeStrategy(saved, race);
      set((state) => ({ playerStrategy: strategy, raceStrategies: { ...state.raceStrategies, [race]: strategy } }));
    }
  },
  loadDefaultStrategy: () => set((state) => {
    const race = state.localMatchSetup.playerRace;
    const strategy = createDefaultStrategy('Balanced Default', race);
    return { playerStrategy: strategy, raceStrategies: { ...state.raceStrategies, [race]: strategy } };
  }),

  localMatchSetup: INITIAL_MATCH_SETUP,
  setPlayerRace: (playerRace) =>
    set((state) => {
      const localMatchSetup = { ...state.localMatchSetup, playerRace };
      const raceStrategies = { ...state.raceStrategies, [state.localMatchSetup.playerRace]: state.playerStrategy };
      saveJSON(MATCH_SETUP_STORAGE_KEY, localMatchSetup);
      return { localMatchSetup, raceStrategies, playerStrategy: raceStrategies[playerRace] };
    }),
  setPlayerTeam: (playerTeam) =>
    set((state) => {
      const localMatchSetup = { ...state.localMatchSetup, playerTeam };
      saveJSON(MATCH_SETUP_STORAGE_KEY, localMatchSetup);
      return { localMatchSetup };
    }),
  setPlayerColor: (playerColor) =>
    set((state) => {
      const localMatchSetup = { ...state.localMatchSetup, playerColor };
      saveJSON(MATCH_SETUP_STORAGE_KEY, localMatchSetup);
      return { localMatchSetup };
    }),
  setMapId: (mapId) =>
    set((state) => {
      // A smaller map caps how many opponents fit — clamp down rather than
      // leaving a stale opponent count the map can no longer seat.
      const maxOpponents = Math.max(1, MAPS[mapId].maxPlayers - 1) as 1 | 2 | 3;
      const activeOpponentCount = Math.min(state.localMatchSetup.activeOpponentCount, maxOpponents) as 1 | 2 | 3;
      const localMatchSetup = { ...state.localMatchSetup, mapId, activeOpponentCount };
      saveJSON(MATCH_SETUP_STORAGE_KEY, localMatchSetup);
      return { localMatchSetup };
    }),
  setOpponentCount: (activeOpponentCount) =>
    set((state) => {
      const localMatchSetup = { ...state.localMatchSetup, activeOpponentCount };
      saveJSON(MATCH_SETUP_STORAGE_KEY, localMatchSetup);
      return { localMatchSetup };
    }),
  setOpponentRace: (index, race) =>
    set((state) => {
      const opponents = state.localMatchSetup.opponents.map((o, i) => (i === index ? { ...o, race } : o));
      const localMatchSetup = { ...state.localMatchSetup, opponents };
      saveJSON(MATCH_SETUP_STORAGE_KEY, localMatchSetup);
      return { localMatchSetup };
    }),
  setOpponentDifficulty: (index, aiDifficulty) =>
    set((state) => {
      const opponents = state.localMatchSetup.opponents.map((o, i) => (i === index ? { ...o, aiDifficulty } : o));
      const localMatchSetup = { ...state.localMatchSetup, opponents };
      saveJSON(MATCH_SETUP_STORAGE_KEY, localMatchSetup);
      return { localMatchSetup };
    }),
  setOpponentTeam: (index, team) =>
    set((state) => {
      const opponents = state.localMatchSetup.opponents.map((o, i) => (i === index ? { ...o, team } : o));
      const localMatchSetup = { ...state.localMatchSetup, opponents };
      saveJSON(MATCH_SETUP_STORAGE_KEY, localMatchSetup);
      return { localMatchSetup };
    }),
  setOpponentColor: (index, color) =>
    set((state) => {
      const opponents = state.localMatchSetup.opponents.map((o, i) => (i === index ? { ...o, color } : o));
      const localMatchSetup = { ...state.localMatchSetup, opponents };
      saveJSON(MATCH_SETUP_STORAGE_KEY, localMatchSetup);
      return { localMatchSetup };
    }),

  ...(() => {
    const script = loadJSON<string>(KEYBIND_SCRIPT_STORAGE_KEY) ?? DEFAULT_KEYBIND_SCRIPT;
    const { bindings, errors } = compileKeybinds(script);
    return { keybindScript: script, keybinds: bindings, keybindErrors: errors };
  })(),
  setKeybindScript: (script) => {
    const { bindings, errors } = compileKeybinds(script);
    saveJSON(KEYBIND_SCRIPT_STORAGE_KEY, script);
    set({ keybindScript: script, keybinds: bindings, keybindErrors: errors });
  },
  resetKeybindScript: () => {
    const { bindings, errors } = compileKeybinds(DEFAULT_KEYBIND_SCRIPT);
    saveJSON(KEYBIND_SCRIPT_STORAGE_KEY, DEFAULT_KEYBIND_SCRIPT);
    set({ keybindScript: DEFAULT_KEYBIND_SCRIPT, keybinds: bindings, keybindErrors: errors });
  },

  hud: createInitialHud(),
  setHud: (hud) => set({ hud }),

  pendingCoordinateInsert: false,
  beginCoordinateInsert: () => set({ pendingCoordinateInsert: true }),
  cancelCoordinateInsert: () => set({ pendingCoordinateInsert: false }),
  insertedCoordinate: null,
  resolveCoordinateInsert: (position) => set({ insertedCoordinate: position, pendingCoordinateInsert: false }),
  clearInsertedCoordinate: () => set({ insertedCoordinate: null }),

  goTo: (screen) => set({ screen }),
  matchStartToken: 0,
  startNewMatch: () =>
    set((s) => ({
      screen: 'match',
      matchStartToken: s.matchStartToken + 1,
      hud: createInitialHud(),
      selectedEntityIds: [],
      selectedEntitySnapshots: [],
      followEntityId: null,
      pendingCoordinateInsert: false,
      isPaused: false,
      simSpeed: 2,
      // A fresh local match overrides any save the Load Game screen queued up.
      pendingLoadedSave: null,
    })),

  pendingLoadedSave: null,
  setPendingLoadedSave: (save) => set({ pendingLoadedSave: save }),
  loadSavedMatch: (save) =>
    set((s) => ({
      screen: 'match',
      matchStartToken: s.matchStartToken + 1,
      hud: createInitialHud(),
      selectedEntityIds: [],
      selectedEntitySnapshots: [],
      followEntityId: null,
      pendingCoordinateInsert: false,
      isPaused: false,
      simSpeed: 2,
      pendingLoadedSave: save,
    })),

  selectedEntityIds: [],
  selectedEntitySnapshots: [],
  setSelectedEntities: (ids) => set((state) => ({
    selectedEntityIds: ids,
    selectedEntitySnapshots: ids.length === 0 ? [] : state.selectedEntitySnapshots,
    // Following a group selection (or deselecting) doesn't make sense —
    // only keep following if the same single unit is still the one selected.
    followEntityId: ids.length === 1 && ids[0] === state.followEntityId ? state.followEntityId : null,
  })),
  setSelectedEntitySnapshots: (entities) => set({ selectedEntitySnapshots: entities }),

  followEntityId: null,
  setFollowEntity: (id) => set({ followEntityId: id }),

  isPaused: false,
  togglePause: () => set((s) => ({ isPaused: !s.isPaused })),
  simSpeed: 2,
  setSimSpeed: (speed) => set({ simSpeed: speed }),

  cameraSettings: { ...DEFAULT_CAMERA_SETTINGS, ...(loadJSON<Partial<CameraSettings>>(CAMERA_SETTINGS_STORAGE_KEY) ?? {}) },
  setCameraSettings: (settings) =>
    set((state) => {
      const cameraSettings = { ...state.cameraSettings, ...settings };
      saveJSON(CAMERA_SETTINGS_STORAGE_KEY, cameraSettings);
      return { cameraSettings };
    }),
  resetCameraSettings: () => {
    saveJSON(CAMERA_SETTINGS_STORAGE_KEY, DEFAULT_CAMERA_SETTINGS);
    set({ cameraSettings: DEFAULT_CAMERA_SETTINGS });
  },
}));
