import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { compile } from './script/compiler';
import { Interpreter } from './script/interpreter';
import { buildScriptApi } from './script/api';
import { Simulation } from '../simulation/Simulation';
import { opponentScriptForRace } from './strategies';

const MAX_STEPS_PER_TICK = 1_000_000;
const FIXED_DT = 1 / 60;

describe('aether_me.txt grouping/marching trace', () => {
  it('traces phase/grouping/marching state through the first attack cycle', () => {
    const code = readFileSync('aether_me.txt', 'utf-8');
    const result = compile(code);
    expect(result.errors).toEqual([]);

    const sim = new Simulation({ player: 'aether', enemy: 'aether' });
    const playerInterpreter = new Interpreter();
    const enemyInterpreter = new Interpreter();
    const enemyProgram = compile(opponentScriptForRace('aether', 'standard')).program!;
    const playerApi = buildScriptApi({ sim, owner: 'player', onAction: () => {}, onLog: () => {} });
    const enemyApi = buildScriptApi({ sim, owner: 'enemy', onAction: () => {}, onLog: () => {} });

    const scope = (playerInterpreter as unknown as { scope: { get: (n: string) => unknown } }).scope;
    let lastPhase = -1;
    let sawGrouping = false;
    let sawMarching = false;
    let ticksInGrouping = 0;
    let ticksInMarching = 0;

    const totalSteps = Math.round(900 / FIXED_DT);
    for (let i = 0; i < totalSteps; i += 1) {
      sim.step(FIXED_DT);
      try { playerInterpreter.runProgram(result.program!, playerApi, MAX_STEPS_PER_TICK); } catch { /* keep going */ }
      try { enemyInterpreter.runProgram(enemyProgram, enemyApi, MAX_STEPS_PER_TICK); } catch { /* keep going */ }

      const phase = scope.get('phase') as number;
      if (phase !== lastPhase) {
        console.log(`t=${(i * FIXED_DT).toFixed(1)}s phase ${lastPhase} -> ${phase}`);
        lastPhase = phase;
      }
      if (phase === 4) {
        sawGrouping = true;
        ticksInGrouping += 1;
        if (ticksInGrouping % 30 === 1) {
          const groupingWave = scope.get('groupingWave') as string[];
          const groupingMinimum = scope.get('groupingMinimum');
          const groupingReadySince = scope.get('groupingReadySince');
          const stagingX = scope.get('stagingX');
          const stagingY = scope.get('stagingY');
          const positions = groupingWave.map((id) => {
            const u = sim.getUnits('player').find((unit) => unit.id === id);
            return u ? `${u.raceUnitId}@(${Math.round(u.position.x)},${Math.round(u.position.y)})` : `${id}=DEAD`;
          });
          console.log(
            `  [grouping] t=${(i * FIXED_DT).toFixed(1)}s wave=${groupingWave.length}/${groupingMinimum} readySince=${groupingReadySince} staging=(${stagingX},${stagingY})`,
          );
          console.log(`    units: ${positions.join(' | ')}`);
        }
      }
      if (phase === 2) {
        sawMarching = true;
        ticksInMarching += 1;
        if (ticksInMarching % 20 === 1) {
          const marchingWave = scope.get('marchingWave') as string[];
          const marchingHeld = scope.get('marchingHeld') as string[];
          const marchingAnchor = scope.get('marchingAnchor');
          const marchingRegrouping = scope.get('marchingRegrouping');
          const objectiveX = scope.get('objectiveX');
          const objectiveY = scope.get('objectiveY');
          const anchorUnit = sim.getUnits('player').find((u) => u.id === marchingAnchor);
          let maxSep = 0;
          if (anchorUnit) {
            for (const id of marchingWave) {
              const u = sim.getUnits('player').find((unit) => unit.id === id);
              if (u) {
                const d = Math.hypot(u.position.x - anchorUnit.position.x, u.position.y - anchorUnit.position.y);
                if (d > maxSep) maxSep = d;
              }
            }
          }
          console.log(
            `  [marching] t=${(i * FIXED_DT).toFixed(1)}s wave=${marchingWave.length} held=${marchingHeld.length} regrouping=${marchingRegrouping} maxSep=${Math.round(maxSep)} anchor=${marchingAnchor}${anchorUnit ? `(${anchorUnit.raceUnitId}@${Math.round(anchorUnit.position.x)},${Math.round(anchorUnit.position.y)} spd=${anchorUnit.speed})` : ''} objective=(${objectiveX},${objectiveY})`,
          );
        }
      }
      if (sawGrouping && sawMarching && ticksInMarching > 300) break;
    }
    console.log('sawGrouping:', sawGrouping, 'sawMarching:', sawMarching);
    console.log('FINAL STATE:');
    console.log('  phase=', scope.get('phase'), 'brainGoal=', scope.get('brainGoal'));
    console.log('  armyHealthScore=', scope.get('armyHealthScore'), 'recentLosses=', scope.get('recentLosses'));
    console.log('  regroupUntil=', scope.get('regroupUntil'), 'gameTime=', sim.getGameTime());
    console.log('  mainArmyCount=', playerInterpreter.callNamed('mainArmyCount', [], playerApi, 5000));
    console.log('  resources=', sim.getResources('player'), 'reserveResources=', scope.get('reserveResources'));
    console.log('  regroupActive=', scope.get('regroupActive'), 'homeDanger=', scope.get('homeDanger'), 'fullHomeDefense=', scope.get('fullHomeDefense'));
    console.log('  scoreAttack=', scope.get('scoreAttack'), 'scoreRecover=', scope.get('scoreRecover'), 'scoreBuild=', scope.get('scoreBuild'), 'scoreTech=', scope.get('scoreTech'), 'scoreEconomy=', scope.get('scoreEconomy'));
    console.log('  units:', sim.getUnits('player').map((u) => `${u.raceUnitId}:${u.order.type}:hp${(u.hp/u.maxHp).toFixed(2)}`));
    console.log('  buildings:', sim.getBuildings('player').map((b) => b.type));
  });
});
