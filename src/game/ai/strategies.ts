import type { Rule, StrategyConfig } from '../../types/rules';
import { makeId } from '../../utils/id';
import { DEFAULT_SCRIPT } from './script/examples';
import type { RaceId } from '../../types/game';
import { RACES } from '../races';
import ironcladDoctrine from './defaults/ironclad.txt?raw';
import aetherDoctrine from './defaults/aether.txt?raw';
import nullforgeDoctrine from './defaults/nullforge.txt?raw';

function rule(priority: number, condition: Rule['condition'], action: Rule['action']): Rule {
  return { id: makeId('rule'), enabled: true, priority, condition, action };
}

/** Fills in `mode`/`code` for a strategy saved before those fields existed —
 * `loadJSON<StrategyConfig>` only asserts the type, it doesn't guarantee an
 * old localStorage entry actually has every field, so this input type
 * reflects that mode/code may genuinely be missing at runtime. */
type MaybeLegacyStrategy = Omit<StrategyConfig, 'mode' | 'code'> & Partial<Pick<StrategyConfig, 'mode' | 'code'>>;

export function normalizeStrategy(strategy: MaybeLegacyStrategy, race: RaceId = 'ironclad'): StrategyConfig {
  return { mode: 'code', code: defaultScriptForRace(race), ...strategy };
}

/** A balanced, sensible default the player can load into the strategy editor and tweak. */
export function createDefaultStrategy(name = 'Balanced Default', race: RaceId = 'ironclad'): StrategyConfig {
  return {
    id: makeId('strategy'),
    name,
    mode: 'code',
    code: defaultScriptForRace(race),
    rules: [
      rule(1, { type: 'command_center_under_attack' }, { type: 'defend_command_center' }),
      rule(2, { type: 'builder_count_below', value: 4 }, { type: 'train_builder' }),
      rule(3, { type: 'resource_at_least', value: 200 }, { type: 'construct_barracks' }),
      rule(4, { type: 'resource_at_least', value: 300 }, { type: 'construct_factory' }),
      rule(5, { type: 'resource_at_least', value: 125 }, { type: 'construct_turret' }),
      rule(6, { type: 'resource_at_least', value: 75 }, { type: 'train_soldier' }),
      rule(7, { type: 'resource_at_least', value: 150 }, { type: 'train_tank' }),
      rule(8, { type: 'resource_at_least', value: 60 }, { type: 'train_scout' }),
      rule(9, { type: 'game_time_above', value: 8 }, { type: 'scout_the_map' }),
      rule(10, { type: 'enemy_detected' }, { type: 'attack_nearest_enemy' }),
      rule(11, { type: 'army_strength_at_least', value: 6 }, { type: 'attack_enemy_command_center' }),
      rule(12, { type: 'game_time_above', value: 5 }, { type: 'gather_resources' }),
    ],
  };
}

/** The opponent's actual AI — this is what runs (mode: 'code' below). The
 * `rules` list further down stays populated too, satisfying the
 * StrategyConfig shape and keeping RuleEngine's own tests meaningful, but
 * it's inert at runtime: code vs. code, no visual-rules fallback anymore. */
const OPPONENT_SCRIPT = `// Aggressor AI
if (commandCenterUnderAttack()) {
  defendCommandCenter();
}
if (unitCount("builder") < 3) {
  train("builder");
}
if (resources() >= 180 && !hasBuilding("barracks")) {
  construct("barracks");
}
if (resources() >= 75 && unitCount("soldier") < 5) {
  train("soldier");
}
if (resources() >= 110 && unitCount("rocketeer") < 4) {
  train("rocketeer");
}
if (resources() >= 100 && unitCount("marksman") < 2) {
  train("marksman");
}
if (resources() >= 280 && !hasBuilding("factory")) {
  construct("factory");
}
if (resources() >= 150 && unitCount("tank") < 4) {
  train("tank");
}
if (resources() >= 210 && gameTime() > 30 && unitCount("artillery") < 3) {
  train("artillery");
}
if (resources() >= 180 && gameTime() > 38 && unitCount("aircraft") < 4) {
  train("aircraft");
}
if (resources() >= 120 && !hasBuilding("turret")) {
  construct("turret");
}
if (resources() >= 220 && gameTime() > 18 && !hasBuilding("researchLab")) {
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
if (resources() >= 280 && gameTime() > 32 && !hasBuilding("shipyard")) {
  construct("shipyard");
}
if (resources() >= 125 && unitCount("support") < 2) {
  train("support");
}
if (resources() >= 240 && hasResearch("aerialEngineering") && unitCount("bomber") < 3) {
  train("bomber");
}
if (resources() >= 190 && hasBuilding("shipyard") && unitCount("frigate") < 4) {
  train("frigate");
}
if (resources() >= 360 && hasResearch("navalEngineering") && unitCount("dreadnought") < 2) {
  train("dreadnought");
}
if (resources() >= 250 && hasResearch("navalEngineering") && unitCount("submarine") < 3) {
  train("submarine");
}
if (resources() >= 200 && gameTime() > 16) {
  let scoutedNodes = knownResourceNodes();
  for (id in scoutedNodes) {
    if (!nodeCovered(id)) {
      expandToNode(id);
    } else if (minersAtNode(id) < 3) {
      mineNode(id, 3);
    }
  }
}
if (gameTime() > 6) {
  scoutMap();
}
if (armyStrength() >= 3) {
  attackNearestEnemy();
}
if (armyStrength() >= 5) {
  attackEnemyCommandCenter();
}
if (gameTime() > 4) {
  gatherResources();
}
`;

export const AI_DIFFICULTY_LIST = ['cadet', 'standard', 'relentless'] as const;
export type AiDifficulty = (typeof AI_DIFFICULTY_LIST)[number];

export const AI_DIFFICULTY_LABEL: Record<AiDifficulty, { name: string; description: string }> = {
  cadet: { name: 'Cadet', description: 'Builds slowly and waits for a larger force.' },
  standard: { name: 'Commander', description: 'Balanced pressure with a mixed army.' },
  relentless: { name: 'Relentless', description: 'Expands early and attacks with smaller squads.' },
};

const OPPONENT_SCRIPTS: Record<AiDifficulty, string> = {
  cadet: OPPONENT_SCRIPT
    .replace('// Aggressor AI', '// Cadet AI')
    .replace('gameTime() > 6', 'gameTime() > 16')
    .replace('armyStrength() >= 3', 'armyStrength() >= 6')
    .replace('armyStrength() >= 5', 'armyStrength() >= 9')
    .replace('gameTime() > 30', 'gameTime() > 55')
    .replace('gameTime() > 38', 'gameTime() > 65'),
  standard: OPPONENT_SCRIPT,
  relentless: OPPONENT_SCRIPT
    .replace('// Aggressor AI', '// Relentless AI')
    .replace('unitCount("builder") < 3', 'unitCount("builder") < 5')
    .replace('gameTime() > 30', 'gameTime() > 20')
    .replace('gameTime() > 38', 'gameTime() > 26')
    .replace('gameTime() > 16', 'gameTime() > 10')
    .replace('gameTime() > 6', 'gameTime() > 3')
    .replace('armyStrength() >= 3', 'armyStrength() >= 2')
    .replace('armyStrength() >= 5', 'armyStrength() >= 4'),
};

const RACE_DOCTRINE_SCRIPTS: Record<RaceId, string> = {
  ironclad: ironcladDoctrine,
  aether: aetherDoctrine,
  nullforge: nullforgeDoctrine,
};

function withRaceIdentity(script: string, race: RaceId, role: 'player' | 'opponent'): string {
  const manifest = RACES[race];
  let result = `// ${manifest.name} ${role === 'player' ? 'command script' : 'computer commander'}\n${script}`;
  for (const unit of Object.values(manifest.units)) {
    result = result.replaceAll(`"${unit.archetype}"`, `"${unit.name}"`);
  }
  for (const building of Object.values(manifest.buildings)) {
    result = result.replaceAll(`"${building.archetype}"`, `"${building.name}"`);
  }
  return result;
}

export function defaultScriptForRace(race: RaceId): string {
  return withRaceIdentity(RACE_DOCTRINE_SCRIPTS[race], race, 'player');
}

export function opponentScriptForRace(race: RaceId, difficulty: AiDifficulty): string {
  let doctrine = RACE_DOCTRINE_SCRIPTS[race];
  if (difficulty === 'cadet') {
    doctrine = doctrine
      .replaceAll('gameTime() > ', 'gameTime() > 10 + ')
      .replaceAll('armyStrength() >= ', 'armyStrength() >= 3 + ');
  } else if (difficulty === 'relentless') {
    doctrine = doctrine
      .replaceAll('gameTime() > ', 'gameTime() + 7 > ')
      .replaceAll('armyStrength() >= ', 'armyStrength() + 2 >= ');
  }
  return withRaceIdentity(`// ${AI_DIFFICULTY_LABEL[difficulty].name} doctrine\n${doctrine}`, race, 'opponent');
}

/** The built-in computer opponent's strategy: a bit more aggressive and militaristic. */
export function createOpponentStrategy(name = 'Aggressor AI', difficulty: AiDifficulty = 'standard', race: RaceId = 'aether'): StrategyConfig {
  return {
    id: makeId('strategy'),
    name,
    mode: 'code',
    code: opponentScriptForRace(race, difficulty),
    rules: [
      rule(1, { type: 'command_center_under_attack' }, { type: 'defend_command_center' }),
      rule(2, { type: 'builder_count_below', value: 3 }, { type: 'train_builder' }),
      rule(3, { type: 'resource_at_least', value: 180 }, { type: 'construct_barracks' }),
      rule(4, { type: 'resource_at_least', value: 75 }, { type: 'train_soldier' }),
      rule(5, { type: 'resource_at_least', value: 280 }, { type: 'construct_factory' }),
      rule(6, { type: 'resource_at_least', value: 150 }, { type: 'train_tank' }),
      rule(7, { type: 'resource_at_least', value: 120 }, { type: 'construct_turret' }),
      rule(8, { type: 'game_time_above', value: 6 }, { type: 'scout_the_map' }),
      rule(9, { type: 'army_strength_at_least', value: 3 }, { type: 'attack_nearest_enemy' }),
      rule(10, { type: 'army_strength_at_least', value: 5 }, { type: 'attack_enemy_command_center' }),
      rule(11, { type: 'game_time_above', value: 4 }, { type: 'gather_resources' }),
    ],
  };
}
