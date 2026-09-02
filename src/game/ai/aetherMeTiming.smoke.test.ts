import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { compile } from './script/compiler';
import { Interpreter } from './script/interpreter';
import { buildScriptApi } from './script/api';
import { Simulation } from '../simulation/Simulation';
import { opponentScriptForRace } from './strategies';

const MAX_STEPS_PER_TICK = 1_000_000;
const FIXED_DT = 1 / 60;
const AI_TICK_INTERVAL = 0.05;

describe('aether_me.txt per-tick wall-clock cost', () => {
  it('measures real runProgram() duration under a full match, including combat', () => {
    const code = readFileSync('aether_me.txt', 'utf-8');
    const result = compile(code);
    expect(result.errors).toEqual([]);

    const sim = new Simulation({ player: 'aether', enemy: 'aether' });
    const playerInterpreter = new Interpreter();
    const enemyInterpreter = new Interpreter();
    const enemyProgram = compile(opponentScriptForRace('aether', 'standard')).program!;
    const playerApi = buildScriptApi({ sim, owner: 'player', onAction: () => {}, onLog: () => {} });
    const enemyApi = buildScriptApi({ sim, owner: 'enemy', onAction: () => {}, onLog: () => {} });

    const durations: number[] = [];
    let aiAccumulator = 0;
    const totalSteps = Math.round(500 / FIXED_DT);
    for (let i = 0; i < totalSteps; i += 1) {
      sim.step(FIXED_DT);
      aiAccumulator += FIXED_DT;
      if (aiAccumulator >= AI_TICK_INTERVAL) {
        aiAccumulator %= AI_TICK_INTERVAL;
        const start = performance.now();
        try { playerInterpreter.runProgram(result.program!, playerApi, MAX_STEPS_PER_TICK); } catch { /* keep going */ }
        durations.push(performance.now() - start);
        try { enemyInterpreter.runProgram(enemyProgram, enemyApi, MAX_STEPS_PER_TICK); } catch { /* keep going */ }
      }
    }

    durations.sort((a, b) => a - b);
    const p50 = durations[Math.floor(durations.length * 0.5)];
    const p95 = durations[Math.floor(durations.length * 0.95)];
    const p99 = durations[Math.floor(durations.length * 0.99)];
    const max = durations[durations.length - 1];
    const mean = durations.reduce((a, b) => a + b, 0) / durations.length;
    console.log(`ticks measured: ${durations.length}`);
    console.log(`mean=${mean.toFixed(3)}ms p50=${p50.toFixed(3)}ms p95=${p95.toFixed(3)}ms p99=${p99.toFixed(3)}ms max=${max.toFixed(3)}ms`);
    console.log('top 10 slowest ticks (ms):', durations.slice(-10).map((d) => d.toFixed(3)));
  });
});
