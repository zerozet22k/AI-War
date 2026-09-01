import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearMatchHistory, loadMatchHistory, recordMatchResult, summarizeMatchHistory } from './matchMemory';

// The test environment is plain Node (see vite.config.ts), which has no
// `localStorage` — utils/storage.ts's loadJSON/saveJSON degrade to silent
// no-ops without it (by design, for SSR/private-browsing safety), which
// would make every test here trivially pass on empty data. A minimal
// in-memory stand-in is enough to exercise the real read/write path.
function installFakeLocalStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  });
}

function record(overrides: Partial<Parameters<typeof recordMatchResult>[0]> = {}) {
  recordMatchResult({
    race: 'ironclad',
    opponentRace: 'aether',
    outcome: 'win',
    durationSeconds: 300,
    difficulty: 'standard',
    timestamp: Date.now(),
    unitsCreated: 10,
    unitsLost: 2,
    resourcesGathered: 500,
    buildingsConstructed: 4,
    ...overrides,
  });
}

describe('matchMemory', () => {
  beforeEach(() => {
    installFakeLocalStorage();
    clearMatchHistory();
  });

  it('starts empty with a zeroed summary', () => {
    expect(loadMatchHistory('ironclad')).toEqual([]);
    const summary = summarizeMatchHistory(loadMatchHistory('ironclad'));
    expect(summary.matchesPlayed).toBe(0);
    expect(summary.winRate).toBe(0);
    expect(summary.lastOutcome).toBeNull();
  });

  it('only counts matches for the queried race', () => {
    record({ race: 'ironclad', outcome: 'win' });
    record({ race: 'aether', outcome: 'loss' });
    expect(loadMatchHistory('ironclad')).toHaveLength(1);
    expect(loadMatchHistory('aether')).toHaveLength(1);
    expect(loadMatchHistory('nullforge')).toHaveLength(0);
  });

  it('computes winRate, matchesWon/Lost, and lastOutcome', () => {
    record({ outcome: 'win' });
    record({ outcome: 'loss' });
    record({ outcome: 'win' });
    const summary = summarizeMatchHistory(loadMatchHistory('ironclad'));
    expect(summary.matchesPlayed).toBe(3);
    expect(summary.matchesWon).toBe(2);
    expect(summary.matchesLost).toBe(1);
    expect(summary.winRate).toBeCloseTo(2 / 3);
    expect(summary.lastOutcome).toBe('win');
  });

  it('tracks a current win streak and resets it on a loss', () => {
    record({ outcome: 'win' });
    record({ outcome: 'win' });
    record({ outcome: 'win' });
    expect(summarizeMatchHistory(loadMatchHistory('ironclad')).currentWinStreak).toBe(3);

    record({ outcome: 'loss' });
    const summary = summarizeMatchHistory(loadMatchHistory('ironclad'));
    expect(summary.currentWinStreak).toBe(0);
    expect(summary.currentLossStreak).toBe(1);
  });

  it('averages match duration across the race\'s history', () => {
    record({ durationSeconds: 100 });
    record({ durationSeconds: 300 });
    const summary = summarizeMatchHistory(loadMatchHistory('ironclad'));
    expect(summary.averageDurationSeconds).toBe(200);
    expect(summary.lastDurationSeconds).toBe(300);
  });

  it('caps stored history so it cannot grow without bound', () => {
    for (let i = 0; i < 250; i += 1) record({ timestamp: i });
    const all = loadMatchHistory('ironclad');
    expect(all.length).toBeLessThanOrEqual(200);
    // the oldest records are the ones dropped, not the newest
    expect(all[all.length - 1].timestamp).toBe(249);
  });
});
