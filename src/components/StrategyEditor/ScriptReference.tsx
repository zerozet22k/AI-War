import { useMemo, useState } from 'react';
import { BUILDING_TYPE_LIST, RESEARCH_TYPE_LIST, UNIT_TYPE_LIST } from '../../types/game';
import { RACES } from '../../game/races';
import './ScriptReference.css';

interface FnDoc {
  sig: string;
  desc: string;
}

const QUERIES_NUMBER: FnDoc[] = [
  { sig: 'resources()', desc: 'Current resource total' },
  { sig: 'gameTime()', desc: 'Seconds of active match time elapsed' },
  { sig: 'unitCount("Lancer")', desc: 'How many units match a race name, id, class, or archetype' },
  { sig: 'units()', desc: 'Total unit count' },
  { sig: 'armyStrength()', desc: 'Combined combat power' },
  { sig: 'buildingCount("outpost")', desc: 'How many buildings match a race name, id, class, or archetype' },
  { sig: 'resourcesGathered()', desc: 'Total crystals deposited this match' },
  { sig: 'unitsCreated() / unitsLost()', desc: 'Your production and casualty totals' },
  { sig: 'buildingsConstructed()', desc: 'Completed structures this match' },
  { sig: 'mapWidth() / mapHeight()', desc: 'Playable world dimensions' },
  { sig: 'mapExploredRatio()', desc: '0 to 1 — how much of the map you have ever seen' },
];

const QUERIES_BOOL: FnDoc[] = [
  { sig: 'enemyDetected()', desc: 'An enemy is within sight' },
  { sig: 'commandCenterUnderAttack()', desc: 'HQ was hit recently' },
  { sig: 'hasBuilding("barracks")', desc: 'At least one of that building exists' },
  { sig: 'buildingNear("outpost", x, y, r)', desc: 'A completed or unfinished matching building is nearby' },
  { sig: 'isWaterAt(x, y)', desc: 'Whether the map terrain at a point is water' },
  { sig: 'enemyBaseFound()', desc: "Whether a scout has ever actually seen the enemy's Command Center (enemyBaseX/Y() harmlessly fall back to your own base until then)" },
];

const ACTIONS: FnDoc[] = [
  { sig: 'train("Worldspine")', desc: `Queue by real race-unit name/id, or reusable archetype — ${UNIT_TYPE_LIST.map((type) => `"${type}"`).join(', ')}` },
  { sig: 'train("Worldspine", buildingId)', desc: 'Same, but queued at one specific building (from myBuildingsOfType(...)) instead of an auto-picked producer' },
  {
    sig: 'construct("barracks")',
    desc: `Build a structure at an auto-picked spot — ${BUILDING_TYPE_LIST.filter((type) => type !== 'commandCenter').map((type) => `"${type}"`).join(', ')}`,
  },
  { sig: 'research("navalEngineering")', desc: `Queue research — ${RESEARCH_TYPE_LIST.map((type) => `"${type}"`).join(', ')}` },
  { sig: 'research("navalEngineering", buildingId)', desc: 'Same, but queued at one specific lab building instead of an auto-picked producer' },
  { sig: 'hasResearch("navalEngineering")', desc: 'Whether that technology has completed' },
  { sig: 'gatherResources()', desc: 'Send idle Builders to gather' },
  { sig: 'mineNode(id, 3)', desc: 'Assign enough available Builders for 3 total miners at a covered crystal node' },
  { sig: 'expandToNode(id)', desc: 'Build your race Outpost at a valid position covering a discovered crystal node' },
  { sig: 'defendCommandCenter()', desc: 'Hold position around HQ' },
  { sig: 'attackNearestEnemy()', desc: 'Attack the closest enemy' },
  { sig: 'attackEnemyCommandCenter()', desc: "Attack the enemy's HQ" },
  { sig: 'retreatToBase()', desc: 'Pull units back to base' },
  { sig: 'scoutMap()', desc: 'Send your dedicated Scout(s) exploring, or one idle unit if you have none' },
  { sig: 'scoutUnit(id)', desc: 'Send any one specific unit of yours out scouting — use this to press spare combat units into service too' },
];

const POSITIONS: FnDoc[] = [
  { sig: 'baseX() / baseY()', desc: 'Your Command Center position' },
  { sig: 'enemyBaseX() / enemyBaseY()', desc: "Enemy's Command Center position" },
  { sig: 'nearestEnemyX() / nearestEnemyY()', desc: 'Nearest known enemy position' },
  { sig: 'isValidBuildSpot(x, y)', desc: 'Whether a point is buildable' },
  { sig: 'constructAt("turret", x, y)', desc: 'Build that type at an exact point' },
  { sig: 'rallyAt(x, y)', desc: 'Rally units to a point' },
  { sig: 'attackAt(x, y)', desc: 'Attack-move to a point' },
];

const UNIT_GROUPS: FnDoc[] = [
  { sig: 'myUnits()', desc: 'List of all your unit ids' },
  { sig: 'myUnitsOfType("Warden")', desc: 'List filtered by real name/id, class, or archetype' },
  { sig: 'myUnitsOfTypes("Lancer", "Ruptor", "Seer")', desc: 'Combine several unit types into one list' },
  { sig: 'combatUnits()', desc: 'All your non-Builder units with an attack' },
  { sig: 'damagedUnits(0.5)', desc: 'Your units below the supplied health ratio' },
  { sig: 'unitsWithOrder("gather")', desc: 'Your units currently performing that order' },
  { sig: 'idleUnits()', desc: 'List of your idle unit ids' },
  { sig: 'unitsNear(x, y, r)', desc: 'Your units within radius r' },
  { sig: 'enemyUnitsNear(x, y, r)', desc: 'Enemy units within radius r' },
  { sig: 'visibleEnemyUnits()', desc: 'All enemy units currently inside your vision' },
  { sig: 'visibleEnemyBuildings()', desc: 'All enemy buildings currently inside your vision' },
  { sig: 'enemyBuildingsNear(x, y, r)', desc: 'Visible enemy buildings within radius r' },
  { sig: 'knownEnemyBuildings()', desc: 'Every enemy building you have ever seen, even ones no longer in sight — remembered until you look at that spot again and find it gone' },
  { sig: 'knownEnemyBuildingX(id) / knownEnemyBuildingY(id)', desc: 'Last-known position of a remembered building' },
  { sig: 'knownEnemyBuildingType(id) / knownEnemyBuildingClass(id)', desc: "That remembered building's type/class" },
  { sig: 'knownEnemyBuildingAge(id)', desc: 'Seconds since that memory was last refreshed — 0 if currently visible' },
  { sig: 'count(list)', desc: 'How many ids are in a list' },
  { sig: 'unitX(id) / unitY(id)', desc: "A unit's position" },
  { sig: 'unitHp(id) / unitMaxHp(id)', desc: "A unit's health" },
  { sig: 'unitType(id)', desc: "A unit's type, as a string" },
  { sig: 'unitExists(id)', desc: 'Whether that id is still alive' },
  { sig: 'unitAttack(id)', desc: "A unit's attack damage" },
  { sig: 'unitAttackRange(id)', desc: "A unit's attack range" },
  { sig: 'unitSpeed(id)', desc: "A unit's movement speed" },
  { sig: 'unitSight(id)', desc: "A unit's sight radius" },
  { sig: 'unitCargo(id)', desc: 'Crystals currently carried by a Builder' },
  { sig: 'unitHealthRatio(id)', desc: 'Health from 0 to 1, avoiding manual HP arithmetic' },
  { sig: 'unitOrder(id) / unitDomain(id)', desc: 'Current order and movement domain strings' },
  { sig: 'unitIsIdle(id) / unitIsGathering(id)', desc: 'Convenient unit-state checks' },
  { sig: 'unitSkills(id)', desc: 'List of race-defined skill ids available to that unit' },
  { sig: 'unitSkillReady(id, skillId)', desc: 'Whether a skill can activate now' },
  { sig: 'unitSkillCooldown(id, skillId)', desc: 'Seconds remaining before the skill is ready' },
  { sig: 'totalAttack(list) / totalHealth(list)', desc: 'Sum stats across one of your unit lists' },
  { sig: 'closestUnitTo(list, x, y)', desc: 'Closest id from one of your unit lists' },
  { sig: 'weakestUnit(list)', desc: 'Lowest health-ratio id from one of your unit lists' },
  { sig: 'nearestEnemyUnitTo(x, y, r)', desc: 'Closest currently visible enemy unit, or an empty string' },
  { sig: 'distanceBetween(x1, y1, x2, y2)', desc: 'Distance between two points' },
  { sig: 'inRange(x1, y1, x2, y2, r)', desc: 'Whether two points are within r of each other' },
  { sig: 'moveUnitTo(id, x, y)', desc: 'Move one unit (yours only)' },
  { sig: 'attackUnitTo(id, x, y)', desc: 'Attack-move one unit (yours only)' },
  { sig: 'attackUnit(id, targetId)', desc: 'Order one unit to attack a specific visible enemy' },
  { sig: 'useUnitSkill(id, skillId)', desc: 'Activate a ready unit skill; combat skills also support autocast' },
  { sig: 'defendUnitAt(id, x, y) / retreatUnit(id)', desc: 'Defend a point or retreat one unit' },
  { sig: 'gatherUnitAt(id, nodeId)', desc: 'Send one of your Builders to a covered crystal node' },
  { sig: 'stopUnit(id)', desc: 'Clear one unit’s current order' },
  { sig: 'moveUnitsTo(list, x, y)', desc: 'Move an entire id list; returns number commanded' },
  { sig: 'attackUnitsTo(list, x, y)', desc: 'Attack-move an entire id list' },
  { sig: 'defendUnitsAt(list, x, y)', desc: 'Make an entire id list defend a point' },
  { sig: 'retreatUnits(list) / stopUnits(list)', desc: 'Retreat or stop an entire id list' },
];

const BUILDINGS_AND_NODES: FnDoc[] = [
  { sig: 'myBuildings()', desc: 'List of all your building ids' },
  { sig: 'myBuildingsOfType("outpost")', desc: 'List filtered by type' },
  { sig: 'myBuildingsNear(x, y, r)', desc: 'Your buildings within radius r' },
  { sig: 'buildingX(id) / buildingY(id)', desc: "A building's position" },
  { sig: 'buildingType(id)', desc: "A building's type, as a string" },
  { sig: 'buildingExists(id)', desc: 'Whether that id still stands' },
  { sig: 'buildingHp(id) / buildingMaxHp(id)', desc: "A building's current and maximum health" },
  { sig: 'buildingProgress(id)', desc: 'Construction progress from 0 to 1' },
  { sig: 'buildingUnderConstruction(id)', desc: 'Whether construction is still in progress' },
  { sig: 'buildingHealthRatio(id)', desc: 'Building health from 0 to 1' },
  { sig: 'buildingQueueLength(id)', desc: 'Number of units queued at this building' },
  { sig: 'buildingProductionProgress(id)', desc: 'Current production progress from 0 to 1' },
  { sig: 'buildingResearchProgress(id)', desc: 'Current research progress from 0 to 1' },
  {
    sig: 'resourceNodesNear(x, y, r)',
    desc: "Scouted resource nodes within radius r — a node only appears once you've seen it",
  },
  { sig: 'knownResourceNodes()', desc: 'Every crystal node discovered so far' },
  { sig: 'nearestKnownNode(x, y)', desc: 'Nearest non-depleted known node id, or an empty string' },
  { sig: 'richestKnownNode()', desc: 'Known node with the most crystals remaining' },
  { sig: 'nodeX(id) / nodeY(id)', desc: "A resource node's position" },
  { sig: 'nodeRemaining(id)', desc: 'How much that node has left' },
  { sig: 'nodeExists(id)', desc: "Whether that id is a node you've discovered" },
  { sig: 'nodeCovered(id)', desc: 'Whether a completed Command Center or Outpost activates this node' },
  { sig: 'minersAtNode(id)', desc: 'Builders currently assigned to this node' },
];

const MATCH_MEMORY: FnDoc[] = [
  { sig: 'matchesPlayed()', desc: 'Past matches played as this race, saved on this device' },
  { sig: 'matchesWon() / matchesLost()', desc: 'Past win/loss totals for this race' },
  { sig: 'winRate()', desc: 'matchesWon() / matchesPlayed(), 0 if none yet' },
  { sig: 'lastMatchWon()', desc: 'Whether the most recent match was a win' },
  { sig: 'lastMatchDuration()', desc: 'Seconds the most recent match lasted' },
  { sig: 'averageMatchDuration()', desc: 'Average match length across all past matches' },
  { sig: 'currentWinStreak() / currentLossStreak()', desc: 'Consecutive wins or losses ending with the most recent match' },
];

const DEBUG: FnDoc[] = [{ sig: 'log("message")', desc: 'Print to the AI activity log' }];

const MATH: FnDoc[] = [
  { sig: 'min(a, b) / max(a, b)', desc: 'Return the smaller or larger number' },
  { sig: 'abs(value)', desc: 'Absolute value' },
  { sig: 'floor(value) / ceil(value)', desc: 'Round down or up' },
  { sig: 'clamp(value, low, high)', desc: 'Constrain a number to a range' },
];

const SYNTAX: FnDoc[] = [
  { sig: 'let x = 1;', desc: 'Declare (once — after that it persists; a repeat let is a no-op)' },
  { sig: 'x = x + 1;', desc: 'Assign' },
  { sig: 'if (a) { ... } else { ... }', desc: 'Branch' },
  { sig: 'while (a) { ... }', desc: 'Loop (bounded — no infinite loops)' },
  { sig: 'for (id in myUnits()) { ... }', desc: 'Loop over an id list' },
  { sig: 'function name(a, b) { return a + b; }', desc: 'Define once, call anywhere below it' },
  { sig: '&& || ! == != < <= > >=', desc: 'Logic & comparison' },
  { sig: 'let a = [1, 2, 3];', desc: 'Array literal — holds numbers, strings, bools, or ids from a host function, mixed if you want' },
  { sig: 'a[0] / a[i] = value;', desc: 'Read or write one element by index (0-based)' },
  { sig: 'a[count(a)] = value;', desc: 'Append — writing exactly at the current length grows the array by one' },
];

const SECTIONS: { title: string; items: FnDoc[] }[] = [
  { title: 'Numbers', items: QUERIES_NUMBER },
  { title: 'Booleans', items: QUERIES_BOOL },
  { title: 'Actions (return success)', items: ACTIONS },
  { title: 'Positions', items: POSITIONS },
  { title: 'Unit groups', items: UNIT_GROUPS },
  { title: 'Buildings & resource nodes', items: BUILDINGS_AND_NODES },
  { title: 'Math helpers', items: MATH },
  { title: 'Match memory', items: MATCH_MEMORY },
  { title: 'Debug', items: DEBUG },
  { title: 'Syntax', items: SYNTAX },
];

function Section({ title, items }: { title: string; items: FnDoc[] }) {
  if (items.length === 0) return null;
  return (
    <div className="script-reference__section">
      <div className="script-reference__section-title">{title}</div>
      {items.map((item) => (
        <div key={item.sig} className="script-reference__item">
          <code>{item.sig}</code>
          <span>{item.desc}</span>
        </div>
      ))}
    </div>
  );
}

export interface ScriptReferenceProps {
  /** Wider, multi-column layout for the dedicated reference page (see
   * ApiReferencePage) instead of the narrow sidebar squeezed next to a code
   * editor (StrategyEditor, Terminal's edit view). */
  fullPage?: boolean;
}

export function ScriptReference({ fullPage = false }: ScriptReferenceProps = {}) {
  const [query, setQuery] = useState('');

  const filteredSections = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter((item) => item.sig.toLowerCase().includes(q) || item.desc.toLowerCase().includes(q)),
    }));
  }, [query]);

  const noMatches = query.trim() !== '' && filteredSections.every((s) => s.items.length === 0);

  return (
    <aside className={`script-reference${fullPage ? ' script-reference--full-page' : ''}`}>
      {!fullPage && <div className="script-reference__title">Language Reference</div>}
      <input
        className="script-reference__search"
        type="text"
        placeholder="Search functions…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {!query && (
        <p className="script-reference__blurb">
          Runs several times per second. Every action function returns <code>true</code> if it actually fired. Declare a variable once
          with <code>let</code> — after that it's a no-op, so it can hold memory across ticks; use plain assignment (
          <code>x = value;</code>) to change it.
        </p>
      )}

      {noMatches ? (
        <p className="script-reference__empty">No matches for "{query}".</p>
      ) : (
        <div className={fullPage ? 'script-reference__sections-grid' : undefined}>
          {filteredSections.map((s) => <Section key={s.title} title={s.title} items={s.items} />)}
        </div>
      )}
    </aside>
  );
}
