import { describe, expect, it } from 'vitest';
import { compile } from './script/compiler';
import { Interpreter } from './script/interpreter';
import { buildScriptApi } from './script/api';
import { Simulation } from '../simulation/Simulation';
import { defaultScriptForRace, opponentScriptForRace } from './strategies';

describe('Aether doctrine script', () => {
  it('player-side script compiles and runs several ticks with no runtime error', () => {
    const code = defaultScriptForRace('aether');
    const result = compile(code);
    expect(result.errors).toEqual([]);
    expect(result.program).not.toBeNull();

    const sim = new Simulation({ player: 'aether', enemy: 'aether' });
    const interpreter = new Interpreter();
    const api = buildScriptApi({ sim, owner: 'player', onAction: () => {}, onLog: () => {} });

    for (let i = 0; i < 60; i += 1) {
      sim.step(1);
      expect(() => interpreter.runProgram(result.program!, api, 5000)).not.toThrow();
    }
  });

  it('Aether vs. Aether actually plays a real match with no runtime error', () => {
    const sim = new Simulation({ player: 'aether', enemy: 'aether' });
    const playerInterpreter = new Interpreter();
    const enemyInterpreter = new Interpreter();
    const playerProgram = compile(defaultScriptForRace('aether')).program!;
    const enemyProgram = compile(opponentScriptForRace('aether', 'standard')).program!;
    const playerApi = buildScriptApi({ sim, owner: 'player', onAction: () => {}, onLog: () => {} });
    const enemyApi = buildScriptApi({ sim, owner: 'enemy', onAction: () => {}, onLog: () => {} });

    for (let second = 0; second < 240; second += 1) {
      sim.step(1);
      expect(() => playerInterpreter.runProgram(playerProgram, playerApi, 5000)).not.toThrow();
      expect(() => enemyInterpreter.runProgram(enemyProgram, enemyApi, 5000)).not.toThrow();
      if (sim.state.matchResult) break;
    }
  });
});
