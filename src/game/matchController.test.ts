import { describe, expect, it } from 'vitest';
import { MatchController } from './matchController';
import { createDefaultStrategy, createOpponentStrategy } from './ai/strategies';

function freshController() {
  return new MatchController({
    playerStrategy: createDefaultStrategy(),
    enemyStrategy: createOpponentStrategy(),
  });
}

describe('MatchController', () => {
  it('runs continuously — no periodic pause, both sides act every tick', () => {
    const controller = freshController();
    expect(controller.phase).toBe('running');
    for (let i = 0; i < 90; i += 1) controller.update(1);
    expect(controller.phase).toBe('running');
    expect(controller.sim.getGameTime()).toBeCloseTo(90, 0);
  });

  it('ends the match once a Command Center falls', () => {
    const controller = freshController();
    controller.sim.getCommandCenter('enemy')!.hp = 0;
    controller.update(0.1);
    expect(controller.phase).toBe('ended');
    expect(controller.sim.state.matchResult?.winner).toBe('player');
  });

  it('logs script actions to the activity log', () => {
    const controller = freshController();
    controller.update(1); // one AI tick — default strategies should fire at least one action immediately
    expect(controller.activityLog.length).toBeGreaterThan(0);
    expect(controller.activityLog[0].message).toMatch(/Script activated:/);
  });

  it('logs rule firings when a strategy explicitly uses visual mode', () => {
    const controller = new MatchController({
      playerStrategy: { ...createDefaultStrategy(), mode: 'visual' },
      enemyStrategy: createOpponentStrategy(),
    });
    controller.update(1);
    expect(controller.activityLog.some((e) => /Rule \d+ activated:/.test(e.message))).toBe(true);
  });

  it('tracks match statistics as units are created, gather resources, and buildings finish', () => {
    const controller = freshController();
    for (let i = 0; i < 400; i += 1) controller.update(0.1);

    const stats = controller.sim.getStats('player');
    expect(stats.unitsCreated).toBeGreaterThanOrEqual(1); // at least the starting builder
    expect(stats.resourcesGathered).toBeGreaterThan(0);
    expect(stats.buildingsConstructed).toBeGreaterThanOrEqual(1); // at least the starting Command Center
  });

  it("setCode hot-reloads a side's script (same mechanism a networked client uses)", () => {
    const controller = freshController();
    controller.setCode('player', 'log("via setCode");');
    controller.update(1);
    expect(controller.activityLog.some((e) => e.message === 'Script log: via setCode')).toBe(true);
  });

  describe('triggerFunction (keybind-triggered script functions)', () => {
    it("calls one of the script's own top-level functions on demand", () => {
      const controller = freshController();
      controller.setCode('player', 'function ping() { log("pong"); }');
      controller.update(1); // let the script compile via a normal tick first

      const result = controller.triggerFunction('player', 'ping');
      expect(result.success).toBe(true);
      expect(controller.activityLog.some((e) => e.message === 'Script log: pong')).toBe(true);
    });

    it('reports an error for an unknown function name', () => {
      const controller = freshController();
      controller.setCode('player', 'function ping() { log("pong"); }');
      controller.update(1);

      const result = controller.triggerFunction('player', 'notAFunction');
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/no function named/i);
    });

    it('refuses to trigger a function on a visual-mode (non-code) strategy', () => {
      const controller = new MatchController({
        playerStrategy: { ...createDefaultStrategy(), mode: 'visual' },
        enemyStrategy: createOpponentStrategy(),
      });
      const result = controller.triggerFunction('player', 'anything');
      expect(result.success).toBe(false);
    });

    it('keeps each side\'s functions independent — triggering "enemy" runs the enemy script, not the player\'s', () => {
      const controller = freshController();
      controller.setCode('player', 'function greet() { log("from player"); }');
      controller.setCode('enemy', 'function greet() { log("from enemy"); }');
      controller.update(1);

      controller.triggerFunction('enemy', 'greet');
      expect(controller.activityLog.some((e) => e.message === 'Aggressor AI — Script log: from enemy')).toBe(true);
      expect(controller.activityLog.some((e) => e.message.includes('from player'))).toBe(false);
    });
  });
});
