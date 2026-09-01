import type { RaceId } from '../../types/game';
import type { AiDifficulty } from './strategies';
import { loadJSON, saveJSON } from '../../utils/storage';

const MATCH_HISTORY_STORAGE_KEY = 'ai-war.matchHistory.v1';
/** Oldest records fall off once history grows past this — plenty for any
 * winRate()/streak query a script would reasonably want, without letting
 * localStorage grow unbounded over a long play history. */
const MAX_RECORDS = 200;

export type MatchOutcome = 'win' | 'loss' | 'draw';

export interface MatchRecord {
  race: RaceId;
  opponentRace: RaceId;
  outcome: MatchOutcome;
  durationSeconds: number;
  difficulty: AiDifficulty | null;
  timestamp: number;
  unitsCreated: number;
  unitsLost: number;
  resourcesGathered: number;
  buildingsConstructed: number;
}

export interface MatchHistorySummary {
  matchesPlayed: number;
  matchesWon: number;
  matchesLost: number;
  matchesDrawn: number;
  winRate: number;
  lastOutcome: MatchOutcome | null;
  lastDurationSeconds: number;
  averageDurationSeconds: number;
  currentWinStreak: number;
  currentLossStreak: number;
}

const EMPTY_SUMMARY: MatchHistorySummary = {
  matchesPlayed: 0,
  matchesWon: 0,
  matchesLost: 0,
  matchesDrawn: 0,
  winRate: 0,
  lastOutcome: null,
  lastDurationSeconds: 0,
  averageDurationSeconds: 0,
  currentWinStreak: 0,
  currentLossStreak: 0,
};

function loadAllRecords(): MatchRecord[] {
  return loadJSON<MatchRecord[]>(MATCH_HISTORY_STORAGE_KEY) ?? [];
}

/** All recorded matches played as `race`, oldest first. */
export function loadMatchHistory(race: RaceId): MatchRecord[] {
  return loadAllRecords().filter((r) => r.race === race);
}

/** Appends one finished match to the persisted history (every race's matches
 * share one storage key; each record carries its own `race`). */
export function recordMatchResult(record: MatchRecord): void {
  const all = loadAllRecords();
  all.push(record);
  if (all.length > MAX_RECORDS) all.splice(0, all.length - MAX_RECORDS);
  saveJSON(MATCH_HISTORY_STORAGE_KEY, all);
}

export function clearMatchHistory(): void {
  saveJSON(MATCH_HISTORY_STORAGE_KEY, []);
}

/** Aggregates a race's history into the numbers scripts actually query —
 * computed fresh each call rather than cached, since it's cheap (a few
 * hundred records at most, see MAX_RECORDS) and always reflects the latest
 * recorded match. */
export function summarizeMatchHistory(records: MatchRecord[]): MatchHistorySummary {
  if (records.length === 0) return EMPTY_SUMMARY;

  let won = 0;
  let lost = 0;
  let drawn = 0;
  let totalDuration = 0;
  for (const r of records) {
    if (r.outcome === 'win') won += 1;
    else if (r.outcome === 'loss') lost += 1;
    else drawn += 1;
    totalDuration += r.durationSeconds;
  }

  let winStreak = 0;
  let lossStreak = 0;
  for (let i = records.length - 1; i >= 0; i -= 1) {
    if (records[i].outcome === 'win') {
      if (lossStreak > 0) break;
      winStreak += 1;
    } else if (records[i].outcome === 'loss') {
      if (winStreak > 0) break;
      lossStreak += 1;
    } else break; // a draw ends either streak
  }

  const last = records[records.length - 1];
  return {
    matchesPlayed: records.length,
    matchesWon: won,
    matchesLost: lost,
    matchesDrawn: drawn,
    winRate: won / records.length,
    lastOutcome: last.outcome,
    lastDurationSeconds: last.durationSeconds,
    averageDurationSeconds: totalDuration / records.length,
    currentWinStreak: winStreak,
    currentLossStreak: lossStreak,
  };
}
