/** The script-mode equivalent of createDefaultStrategy()'s rule list — same
 * brain, written as code, so switching from Visual to Code mode always has a
 * sensible, working starting point instead of a blank editor. */
export const DEFAULT_SCRIPT = `// Balanced Default (code mode)
// This runs several times per second. Variables declared here persist between ticks.

if (commandCenterUnderAttack()) {
  defendCommandCenter();
}

if (unitCount("builder") < 4) {
  train("builder");
}

if (resources() >= 200 && !hasBuilding("barracks")) {
  construct("barracks");
}

if (resources() >= 300 && !hasBuilding("factory")) {
  construct("factory");
}

if (resources() >= 125 && !hasBuilding("turret")) {
  construct("turret");
}

if (resources() >= 220 && gameTime() > 22 && !hasBuilding("researchLab")) {
  construct("researchLab");
}

if (hasBuilding("researchLab") && !hasResearch("advancedBallistics")) {
  research("advancedBallistics");
}
if (hasResearch("advancedBallistics") && !hasResearch("aerialEngineering")) {
  research("aerialEngineering");
}
if (hasResearch("aerialEngineering") && !hasResearch("navalEngineering")) {
  research("navalEngineering");
}

if (resources() >= 280 && gameTime() > 38 && !hasBuilding("shipyard")) {
  construct("shipyard");
}

if (resources() >= 75 && unitCount("soldier") < 6) {
  train("soldier");
}

if (resources() >= 110 && unitCount("rocketeer") < 3) {
  train("rocketeer");
}

if (resources() >= 100 && unitCount("marksman") < 3) {
  train("marksman");
}

if (resources() >= 150 && unitCount("tank") < 4) {
  train("tank");
}

if (resources() >= 210 && gameTime() > 35 && unitCount("artillery") < 3) {
  train("artillery");
}

if (resources() >= 180 && gameTime() > 42 && unitCount("aircraft") < 3) {
  train("aircraft");
}

if (resources() >= 125 && unitCount("support") < 2) {
  train("support");
}

if (resources() >= 240 && hasResearch("aerialEngineering") && unitCount("bomber") < 2) {
  train("bomber");
}

if (resources() >= 190 && hasBuilding("shipyard") && unitCount("frigate") < 3) {
  train("frigate");
}
if (resources() >= 360 && hasResearch("navalEngineering") && unitCount("dreadnought") < 2) {
  train("dreadnought");
}
if (resources() >= 250 && hasResearch("navalEngineering") && unitCount("submarine") < 2) {
  train("submarine");
}

if (resources() >= 60 && unitCount("scout") < 2) {
  train("scout");
}

// A resource node only becomes gatherable once an Outpost (or the Command
// Center) covers it. expandToNode() finds a legal nearby construction spot;
// mineNode() then keeps three Builders assigned to each active deposit.
if (resources() >= 220 && gameTime() > 20) {
  let scoutedNodes = knownResourceNodes();
  for (id in scoutedNodes) {
    if (!nodeCovered(id)) {
      expandToNode(id);
    } else if (minersAtNode(id) < 3) {
      mineNode(id, 3);
    }
  }
}

if (gameTime() > 8) {
  scoutMap();
}

if (enemyDetected()) {
  attackNearestEnemy();
}

if (armyStrength() >= 6) {
  attackEnemyCommandCenter();
}

if (gameTime() > 5) {
  gatherResources();
}
`;

/** A second example built around user-defined functions, to show off what a
 * flat IF/THEN rule list can't express.
 *
 * Two scoping rules matter here: the script has one flat *global* variable
 * scope, shared across every tick — "let" only sets a variable's value the
 * *first* time it runs, so it can hold persistent memory (techUps below);
 * after that, use plain assignment. A function's own "let"s are different —
 * each call gets a brand new local scope, so a variable declared inside a
 * function (like "attempts" in trainSoldiers below) is fresh every single
 * call, with no manual reset needed. Functions must be defined before
 * they're called (no hoisting), and there's still no "break" statement, so a
 * loop is stopped early by pushing its own counter past its bound. */
export const ADVANCED_EXAMPLE_SCRIPT = `// Advanced example: user-defined functions + persistent global state.

let techUps = 0; // persists across ticks — only ever set to 0 once, on tick 1

function techUp() {
  if (!hasBuilding("barracks") && resources() >= 150) {
    if (construct("barracks")) {
      techUps = techUps + 1;
      log("Teched up: Barracks built");
    }
  } else if (hasBuilding("barracks") && !hasBuilding("factory") && resources() >= 250) {
    if (construct("factory")) {
      techUps = techUps + 1;
      log("Teched up: Factory built");
    }
  }
}

// Try to queue up to "maxAttempts" soldiers this tick, stopping the moment
// training fails. "attempts" is local to this call, so it starts at 0 fresh
// every single time this function runs — no reset-by-hand needed.
function trainSoldiers(maxAttempts) {
  let attempts = 0;
  while (attempts < maxAttempts && resources() >= 75) {
    if (train("soldier")) {
      attempts = attempts + 1;
    } else {
      attempts = maxAttempts;
    }
  }
}

function armyReadyToPush(minStrength) {
  return armyStrength() >= minStrength;
}

techUp();

if (unitCount("builder") < 3) {
  train("builder");
} else {
  gatherResources();
}

trainSoldiers(3);

if (resources() >= 150 && unitCount("tank") < 4) {
  train("tank");
}

if (armyReadyToPush(8) && techUps >= 2) {
  attackEnemyCommandCenter();
} else if (armyReadyToPush(3)) {
  attackNearestEnemy();
}
`;
