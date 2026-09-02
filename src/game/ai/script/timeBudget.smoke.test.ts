import { describe, expect, it } from 'vitest';
import { compile } from './compiler';
import { Interpreter, TimeBudgetExceededError, type Value } from './interpreter';

// Self-contained: exercises only the interpreter's new wall-clock deadline
// check in isolation, independent of Simulation/buildScriptApi, so it isn't
// affected by anything else in the broader (currently broken) test suite.
describe('Interpreter wall-clock deadline', () => {
  it('aborts a slow-but-not-step-heavy script once its deadline passes', () => {
    const { program, errors } = compile(`
      let i = 0;
      while (i < 200) {
        busyWait();
        i = i + 1;
      }
    `);
    expect(errors).toEqual([]);

    const interpreter = new Interpreter();
    const api = { busyWait: () => { const start = Date.now(); while (Date.now() - start < 1) { /* spin ~1ms */ } return 0; } };

    expect(() => interpreter.runProgram(program!, api, 1_000_000, 5)).toThrow(TimeBudgetExceededError);
  });

  it('does not throw when no deadline is given, even for a slow script', () => {
    const { program, errors } = compile(`
      let i = 0;
      while (i < 10) {
        busyWait();
        i = i + 1;
      }
    `);
    expect(errors).toEqual([]);

    const interpreter = new Interpreter();
    const api = { busyWait: () => { const start = Date.now(); while (Date.now() - start < 1) { /* spin ~1ms */ } return 0; } };

    expect(() => interpreter.runProgram(program!, api, 1_000_000)).not.toThrow();
  });

  it('does not throw when the deadline is generous relative to actual work', () => {
    const { program, errors } = compile(`log(1);`);
    expect(errors).toEqual([]);

    const interpreter = new Interpreter();
    const events: Value[] = [];
    const api = { log: (v: Value) => { events.push(v); return 0; } };

    expect(() => interpreter.runProgram(program!, api, 1_000_000, 50)).not.toThrow();
    expect(events).toEqual([1]);
  });

  it('callNamed also honors the deadline', () => {
    const { program, errors } = compile(`
      function slow() {
        let i = 0;
        while (i < 200) {
          busyWait();
          i = i + 1;
        }
      }
    `);
    expect(errors).toEqual([]);

    const interpreter = new Interpreter();
    const api = { busyWait: () => { const start = Date.now(); while (Date.now() - start < 1) { /* spin ~1ms */ } return 0; } };
    interpreter.runProgram(program!, api, 1_000_000);

    expect(() => interpreter.callNamed('slow', [], api, 1_000_000, 5)).toThrow(TimeBudgetExceededError);
  });
});
