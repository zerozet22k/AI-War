import { describe, expect, it } from 'vitest';
import { Simulation } from '../../simulation/Simulation';
import { createBuilding, createUnit } from '../../simulation/entities';
import { compile } from './compiler';
import { ScriptEngine } from './ScriptEngine';
import { ADVANCED_EXAMPLE_SCRIPT, DEFAULT_SCRIPT } from './examples';
import type { StrategyConfig } from '../../../types/rules';
import { RACES } from '../../races';

// `new Simulation()` defaults the 'player' seat to ironclad — its builder,
// the fabricator, is what these cost assertions are checking against.
const IRONCLAD_BUILDER_COST = RACES.ironclad.units.fabricator.cost;

function strategyWithCode(code: string): StrategyConfig {
  return { id: 's1', name: 'test', mode: 'code', rules: [], code };
}

describe('compiler', () => {
  it('compiles a simple valid script with no errors', () => {
    const result = compile('let x = 1; if (x == 1) { log("hi"); }');
    expect(result.errors).toHaveLength(0);
    expect(result.program).not.toBeNull();
  });

  it('reports a syntax error with a line number', () => {
    const result = compile('if (resources() >= 100 {\n  train("builder");\n}');
    expect(result.program).toBeNull();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].line).toBe(1);
  });

  it('compiles both shipped example scripts cleanly', () => {
    expect(compile(DEFAULT_SCRIPT).errors).toHaveLength(0);
    expect(compile(ADVANCED_EXAMPLE_SCRIPT).errors).toHaveLength(0);
  });
});

describe('ScriptEngine', () => {
  it('does not evaluate anything before the fixed AI tick interval has accumulated', () => {
    const sim = new Simulation();
    const engine = new ScriptEngine();
    const strategy = strategyWithCode('train("builder");');

    const events = engine.update(sim, 'player', strategy, 0.02);
    expect(events).toHaveLength(0);
    expect(sim.getResources('player')).toBe(200);
  });

  it('runs the script once per tick and reports fired actions', () => {
    const sim = new Simulation();
    const engine = new ScriptEngine();
    const strategy = strategyWithCode('train("builder");');

    const events = engine.update(sim, 'player', strategy, 1);
    expect(events).toEqual([{ kind: 'action', text: 'Training Builder' }]);
    expect(sim.getResources('player')).toBe(200 - IRONCLAD_BUILDER_COST);
  });

  it('train/construct/unitCount/hasBuilding are generic over the type name — no fixed function per type', () => {
    const sim = new Simulation();
    sim.state.players.player.resources = 1000;
    const cc = sim.getCommandCenter('player')!;
    sim.state.buildings.push(createBuilding('barracks', 'player', { x: cc.position.x + 100, y: cc.position.y }));
    const engine = new ScriptEngine();
    const strategy = strategyWithCode(`
      log(unitCount("builder"));
      log(hasBuilding("barracks"));
      train("soldier");
    `);

    const events = engine.update(sim, 'player', strategy, 1);
    expect(events).toEqual([
      { kind: 'log', text: '1' },
      { kind: 'log', text: 'true' },
      { kind: 'action', text: 'Training Soldier' },
    ]);
  });

  it('constructAt places a building at an exact point, generic over type', () => {
    const sim = new Simulation();
    sim.state.players.player.resources = 1000;
    const cc = sim.getCommandCenter('player')!;
    const engine = new ScriptEngine();
    const strategy = strategyWithCode(`constructAt("turret", ${cc.position.x + 300}, ${cc.position.y});`);

    const events = engine.update(sim, 'player', strategy, 1);
    expect(events).toEqual([{ kind: 'action', text: 'Constructing Turret' }]);
    const turret = sim.getBuildings('player', 'turret')[0];
    expect(turret.position).toEqual({ x: cc.position.x + 300, y: cc.position.y });
  });

  it('rejects an unknown unit or building type name with a runtime error', () => {
    const sim = new Simulation();
    const engine = new ScriptEngine();
    const strategy = strategyWithCode('train("dragon");');

    const events = engine.update(sim, 'player', strategy, 1);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('error');
    expect(events[0].text).toMatch(/unknown .* unit/i);
  });

  it('persists top-level variables across ticks', () => {
    const sim = new Simulation();
    const engine = new ScriptEngine();
    const strategy = strategyWithCode('let count = 0; count = count + 1; log(count);');

    const first = engine.update(sim, 'player', strategy, 1);
    expect(first).toEqual([{ kind: 'log', text: '1' }]);

    const second = engine.update(sim, 'player', strategy, 1);
    expect(second).toEqual([{ kind: 'log', text: '2' }]);
  });

  it('respects if/else branching', () => {
    const sim = new Simulation();
    const engine = new ScriptEngine();
    const strategy = strategyWithCode('if (resources() >= 999999) { log("rich"); } else { log("poor"); }');

    const events = engine.update(sim, 'player', strategy, 1);
    expect(events).toEqual([{ kind: 'log', text: 'poor' }]);
  });

  it('runs a bounded while loop to completion', () => {
    const sim = new Simulation();
    const engine = new ScriptEngine();
    const strategy = strategyWithCode('let i = 0; while (i < 3) { log(i); i = i + 1; }');

    const events = engine.update(sim, 'player', strategy, 1);
    expect(events).toEqual([
      { kind: 'log', text: '0' },
      { kind: 'log', text: '1' },
      { kind: 'log', text: '2' },
    ]);
  });

  it('aborts a runaway infinite loop via the step budget instead of hanging', () => {
    const sim = new Simulation();
    const engine = new ScriptEngine();
    const strategy = strategyWithCode('while (true) { let x = 1; }');

    const events = engine.update(sim, 'player', strategy, 1);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('error');
    expect(events[0].text).toMatch(/step budget/i);
  });

  it('reports a compile error once, not every tick it recurs', () => {
    const sim = new Simulation();
    const engine = new ScriptEngine();
    const strategy = strategyWithCode('if (true { train("builder"); }');

    const first = engine.update(sim, 'player', strategy, 1);
    expect(first).toHaveLength(1);
    expect(first[0].kind).toBe('error');

    const second = engine.update(sim, 'player', strategy, 1);
    expect(second).toHaveLength(0);
  });

  it('reports an unknown-function runtime error', () => {
    const sim = new Simulation();
    const engine = new ScriptEngine();
    const strategy = strategyWithCode('doSomethingThatDoesNotExist();');

    const events = engine.update(sim, 'player', strategy, 1);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('error');
    expect(events[0].text).toMatch(/unknown function/i);
  });


  it('recompiles on every source change but keeps prior variable state — a live edit should not reset the running AI', () => {
    const sim = new Simulation();
    const engine = new ScriptEngine();
    const strategy = strategyWithCode('let count = 0; count = count + 1; log(count);');

    engine.update(sim, 'player', strategy, 1);
    engine.update(sim, 'player', strategy, 1);

    // Same variable, edited script (e.g. a comment added mid-match) — `let`
    // is a no-op once the name already exists in scope, so `count` keeps
    // its accumulated value instead of resetting to 0.
    strategy.code = 'let count = 0; count = count + 1; log(count); // edited live';
    const events = engine.update(sim, 'player', strategy, 1);
    expect(events).toEqual([{ kind: 'log', text: '3' }]);
  });
});

describe('user-defined functions', () => {
  it('declares and calls a function with parameters', () => {
    const sim = new Simulation();
    const engine = new ScriptEngine();
    const strategy = strategyWithCode(`
      function greet(name) {
        log(name);
      }
      greet("hi");
    `);

    const events = engine.update(sim, 'player', strategy, 1);
    expect(events).toEqual([{ kind: 'log', text: 'hi' }]);
  });

  it('returns a value usable in an expression', () => {
    const sim = new Simulation();
    const engine = new ScriptEngine();
    const strategy = strategyWithCode(`
      function double(n) {
        return n * 2;
      }
      log(double(21));
    `);

    const events = engine.update(sim, 'player', strategy, 1);
    expect(events).toEqual([{ kind: 'log', text: '42' }]);
  });

  it('keeps a local "let" inside a function from leaking into global scope', () => {
    const sim = new Simulation();
    const engine = new ScriptEngine();
    const strategy = strategyWithCode(`
      function useLocal() {
        let x = 5;
      }
      useLocal();
      log(x);
    `);

    const events = engine.update(sim, 'player', strategy, 1);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('error');
    expect(events[0].text).toMatch(/unknown variable "x"/i);
  });

  it('lets a function read and mutate a global variable', () => {
    const sim = new Simulation();
    const engine = new ScriptEngine();
    const strategy = strategyWithCode(`
      let count = 0;
      function bump() {
        count = count + 1;
      }
      bump();
      bump();
      log(count);
    `);

    const events = engine.update(sim, 'player', strategy, 1);
    expect(events).toEqual([{ kind: 'log', text: '2' }]);
  });

  it('aborts unbounded recursion via the call-depth guard', () => {
    const sim = new Simulation();
    const engine = new ScriptEngine();
    const strategy = strategyWithCode(`
      function loop() {
        loop();
      }
      loop();
    `);

    const events = engine.update(sim, 'player', strategy, 1);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('error');
    expect(events[0].text).toMatch(/call depth exceeded/i);
  });

  it('reports "return" used outside of a function as an error', () => {
    const sim = new Simulation();
    const engine = new ScriptEngine();
    const strategy = strategyWithCode('return 1;');

    const events = engine.update(sim, 'player', strategy, 1);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('error');
    expect(events[0].text).toMatch(/return.*outside of a function/i);
  });
});

describe('unit groups', () => {
  it('iterates a for-each loop over a list returned by a query', () => {
    const sim = new Simulation();
    const engine = new ScriptEngine();
    const strategy = strategyWithCode(`
      let total = 0;
      for (id in myUnits()) {
        total = total + 1;
      }
      log(total);
    `);

    // Fresh sim has exactly one unit (the starting builder).
    const events = engine.update(sim, 'player', strategy, 1);
    expect(events).toEqual([{ kind: 'log', text: '1' }]);
  });

  it('finds units near a point and reads their info', () => {
    const sim = new Simulation();
    const cc = sim.getCommandCenter('player')!;
    const soldier = createUnit('soldier', 'player', { x: cc.position.x + 20, y: cc.position.y });
    sim.state.units.push(soldier);

    const engine = new ScriptEngine();
    const strategy = strategyWithCode(`
      let found = unitsNear(${cc.position.x}, ${cc.position.y}, 50);
      for (id in found) {
        if (unitClass(id) == "infantry") {
          log(unitHp(id));
        }
      }
    `);

    const events = engine.update(sim, 'player', strategy, 1);
    expect(events).toEqual([{ kind: 'log', text: String(soldier.hp) }]);
  });

  it('moves a single unit found via a query, and count() reports list length', () => {
    const sim = new Simulation();
    const cc = sim.getCommandCenter('player')!;
    const soldier = createUnit('soldier', 'player', { x: cc.position.x, y: cc.position.y });
    sim.state.units.push(soldier);

    const engine = new ScriptEngine();
    const strategy = strategyWithCode(`
      let mine = myUnitsOfType("soldier");
      log(count(mine));
      for (id in mine) {
        moveUnitTo(id, ${cc.position.x + 300}, ${cc.position.y});
      }
    `);

    const events = engine.update(sim, 'player', strategy, 1);
    expect(events).toEqual([{ kind: 'log', text: '1' }]);
    expect(soldier.order).toEqual({ type: 'moveTo', position: { x: cc.position.x + 300, y: cc.position.y } });
  });

  it('never lets a script command a unit it does not own, even with a known id', () => {
    const sim = new Simulation();
    const enemyCC = sim.getCommandCenter('enemy')!;
    const enemyUnit = createUnit('soldier', 'enemy', { x: enemyCC.position.x, y: enemyCC.position.y });
    sim.state.units.push(enemyUnit);

    const engine = new ScriptEngine();
    // The id is embedded directly (not discovered via enemyUnitsNear()) since
    // this test is specifically about the ownership gate on moveUnitTo() —
    // a script having somehow learned an enemy unit's id (e.g. from an
    // earlier tick while it was visible) must still never be able to command
    // it, regardless of how the id was obtained.
    const strategy = strategyWithCode(`log(moveUnitTo("${enemyUnit.id}", 0, 0));`);

    const events = engine.update(sim, 'player', strategy, 1);
    expect(events).toEqual([{ kind: 'log', text: 'false' }]);
    expect(enemyUnit.order.type).not.toBe('moveTo');
  });

  it('reads a unit\'s combat stats — attack, range, speed, sight', () => {
    const sim = new Simulation();
    const cc = sim.getCommandCenter('player')!;
    const soldier = createUnit('soldier', 'player', { x: cc.position.x, y: cc.position.y });
    sim.state.units.push(soldier);

    const engine = new ScriptEngine();
    const strategy = strategyWithCode(`
      let mine = myUnitsOfType("soldier");
      for (id in mine) {
        log(unitAttack(id));
        log(unitAttackRange(id));
        log(unitSpeed(id));
        log(unitSight(id));
      }
    `);

    const events = engine.update(sim, 'player', strategy, 1);
    expect(events).toEqual([
      { kind: 'log', text: String(soldier.attack) },
      { kind: 'log', text: String(soldier.attackRange) },
      { kind: 'log', text: String(soldier.speed) },
      { kind: 'log', text: String(soldier.sight) },
    ]);
  });

  it('computes distances and range checks between arbitrary points', () => {
    const sim = new Simulation();
    const engine = new ScriptEngine();
    const strategy = strategyWithCode(`
      log(distanceBetween(0, 0, 3, 4));
      log(inRange(0, 0, 3, 4, 5));
      log(inRange(0, 0, 3, 4, 4));
    `);

    const events = engine.update(sim, 'player', strategy, 1);
    expect(events).toEqual([
      { kind: 'log', text: '5' },
      { kind: 'log', text: 'true' },
      { kind: 'log', text: 'false' },
    ]);
  });

  it('finds and reads its own buildings via myBuildingsNear/buildingX/Y/Type', () => {
    const sim = new Simulation();
    const cc = sim.getCommandCenter('player')!;
    sim.state.buildings.push(createBuilding('barracks', 'player', { x: cc.position.x + 50, y: cc.position.y }));

    const engine = new ScriptEngine();
    const strategy = strategyWithCode(`
      let found = myBuildingsNear(${cc.position.x}, ${cc.position.y}, 100);
      log(count(found));
      for (id in found) {
        if (buildingClass(id) == "barracks") {
          log(buildingX(id));
        }
      }
    `);

    const events = engine.update(sim, 'player', strategy, 1);
    expect(events).toEqual([
      { kind: 'log', text: '2' }, // Command Center + Barracks
      { kind: 'log', text: String(cc.position.x + 50) },
    ]);
  });

  it('only discovers a resource node once it has actually been scouted', () => {
    const sim = new Simulation();
    const farNode = sim.state.map.resourceNodes[6]; // one of the nodes next to the enemy's base — nowhere near the player's start
    // Nothing of the player's is anywhere near this node yet.
    const engine = new ScriptEngine();
    // radius=50, not "the whole map" — resourceNodesNear() only filters
    // candidates by distance, not by whether they're near THIS point once
    // already discovered by some other means, so an overly large radius
    // would also match any other node the player happens to already know
    // about (e.g. one within its own starting vision), defeating the point
    // of this test.
    const notYetScouted = strategyWithCode(`log(count(resourceNodesNear(${farNode.position.x}, ${farNode.position.y}, 50)));`);
    const before = engine.update(sim, 'player', notYetScouted, 1);
    expect(before).toEqual([{ kind: 'log', text: '0' }]);

    // A unit standing right on top of it "sees" it into the discovered set.
    const scout = createUnit('scout', 'player', { x: farNode.position.x, y: farNode.position.y });
    sim.state.units.push(scout);
    sim.step(1); // runs updateResourceDiscovery()

    const afterScoutStrategy = strategyWithCode(`
      let nodes = resourceNodesNear(${farNode.position.x}, ${farNode.position.y}, 50);
      log(count(nodes));
      for (id in nodes) {
        log(nodeRemaining(id));
      }
    `);
    const after = engine.update(sim, 'player', afterScoutStrategy, 1);
    expect(after).toEqual([
      { kind: 'log', text: '1' },
      { kind: 'log', text: String(farNode.remaining) },
    ]);
  });
});

describe('arrays', () => {
  it('supports literals, indexed reads, indexed writes, and append-via-length', () => {
    const sim = new Simulation();
    const engine = new ScriptEngine();
    const strategy = strategyWithCode(`
      let nums = [10, 20, 30];
      log(count(nums));
      log(nums[0]);
      log(nums[2]);
      nums[1] = 99;
      log(nums[1]);
      nums[count(nums)] = 40;
      log(count(nums));
      log(nums[3]);
    `);
    const events = engine.update(sim, 'player', strategy, 1);
    expect(events).toEqual([
      { kind: 'log', text: '3' },
      { kind: 'log', text: '10' },
      { kind: 'log', text: '30' },
      { kind: 'log', text: '99' },
      { kind: 'log', text: '4' },
      { kind: 'log', text: '40' },
    ]);
  });

  it('an array declared with "let" persists (and keeps mutations) across ticks, like any other global', () => {
    const sim = new Simulation();
    const engine = new ScriptEngine();
    const strategy = strategyWithCode(`
      let seen = [];
      if (count(seen) < 5) {
        seen[count(seen)] = gameTime();
      }
      log(count(seen));
    `);
    engine.update(sim, 'player', strategy, 1);
    engine.update(sim, 'player', strategy, 1);
    const events = engine.update(sim, 'player', strategy, 1);
    expect(events).toEqual([{ kind: 'log', text: '3' }]);
  });

  it('works as a loop target and can hold values built from expressions, not just literals', () => {
    const sim = new Simulation();
    const engine = new ScriptEngine();
    const strategy = strategyWithCode(`
      let total = 0;
      for (n in [1, 2, 3 + 4]) {
        total = total + n;
      }
      log(total);
    `);
    const events = engine.update(sim, 'player', strategy, 1);
    expect(events).toEqual([{ kind: 'log', text: '10' }]);
  });

  it('rejects an out-of-range read and a sparse (non-appending) write with a clear runtime error', () => {
    const sim = new Simulation();
    const readEvents = new ScriptEngine().update(sim, 'player', strategyWithCode('let a = [1]; log(a[5]);'), 1);
    expect(readEvents).toHaveLength(1);
    expect(readEvents[0].kind).toBe('error');
    expect(readEvents[0].text).toMatch(/out of range/);

    const writeEvents = new ScriptEngine().update(sim, 'player', strategyWithCode('let a = [1]; a[5] = 2;'), 1);
    expect(writeEvents).toHaveLength(1);
    expect(writeEvents[0].kind).toBe('error');
    expect(writeEvents[0].text).toMatch(/out of range/);
  });
});
