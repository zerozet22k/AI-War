import { create } from 'zustand';
import { PLAYER_ID_LIST, RACE_ID_LIST, type Entity, type MatchResult, type MatchStats, type PlayerId, type RaceId, type ResearchType, type Vector2 } from '../types/game';
import type { StrategyConfig } from '../types/rules';
import type { ActivityLogEntry, MatchPhase } from '../game/matchController';
import { createDefaultStrategy, normalizeStrategy, type AiDifficulty } from '../game/ai/strategies';
import { loadJSON, saveJSON } from '../utils/storage';
import type { ScriptError } from '../game/ai/script/errors';
import { DEFAULT_KEYBIND_SCRIPT, compileKeybinds } from './keybindScript';
import { DEFAULT_MAP_ID, type MapId } from '../game/maps';

export type Screen = 'menu' | 'strategyEditor' | 'match' | 'settings' | 'multiplayerLobby' | 'apiReference';

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

export interface LocalMatchSetup {
  playerRace: RaceId;
  enemyRace: RaceId;
  aiDifficulty: AiDifficulty;
  mapId: MapId;
}

const DEFAULT_MATCH_SETUP: LocalMatchSetup = {
  playerRace: 'ironclad',
  enemyRace: 'aether',
  aiDifficulty: 'standard',
  mapId: DEFAULT_MAP_ID,
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
  setEnemyRace: (race: RaceId) => void;
  setAiDifficulty: (difficulty: AiDifficulty) => void;
  setMapId: (mapId: MapId) => void;

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
  setEnemyRace: (enemyRace) =>
    set((state) => {
      const localMatchSetup = { ...state.localMatchSetup, enemyRace };
      saveJSON(MATCH_SETUP_STORAGE_KEY, localMatchSetup);
      return { localMatchSetup };
    }),
  setAiDifficulty: (aiDifficulty) =>
    set((state) => {
      const localMatchSetup = { ...state.localMatchSetup, aiDifficulty };
      saveJSON(MATCH_SETUP_STORAGE_KEY, localMatchSetup);
      return { localMatchSetup };
    }),
  setMapId: (mapId) =>
    set((state) => {
      const localMatchSetup = { ...state.localMatchSetup, mapId };
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
