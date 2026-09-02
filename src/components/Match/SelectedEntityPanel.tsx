import { useAppStore } from '../../state/store';
import type { Entity, PlayerId } from '../../types/game';
import { RACES, buildingName, unitEntryForArchetype, unitName } from '../../game/races';
import { ProgressBar } from '../shared/ProgressBar';
import {
  RESEARCH_BY_BUILDING,
  RESEARCH_DESCRIPTION,
  RESEARCH_DURATION,
  RESEARCH_NAME,
  RESEARCH_PREREQUISITE,
  RESOURCE_GARRISON_RADIUS,
  UNIT_RESEARCH_REQUIREMENT,
  UNITS_PRODUCED_BY,
} from '../../game/constants';
import { entityPortraitUrl, raceEmblemUrl } from '../../game/raceVisuals';
import './SelectedEntityPanel.css';

const ORDER_LABEL: Record<string, string> = {
  idle: 'Idle',
  gather: 'Gathering resources',
  moveTo: 'Moving',
  attackMove: 'Attacking',
  attackTarget: 'Attacking a target',
  build: 'Building',
  defend: 'Defending',
  retreat: 'Retreating to base',
  scout: 'Scouting',
};

export interface SelectedEntityPanelProps {
  /** Which side is "you" — a multiplayer guest is 'enemy', so the entity
   * whose color happens to be red is actually theirs, not the opponent's. */
  mySide?: PlayerId;
}

export function SelectedEntityPanel({ mySide = 'player' }: SelectedEntityPanelProps) {
  const entities = useAppStore((s) => s.selectedEntitySnapshots);
  const setSelectedEntities = useAppStore((s) => s.setSelectedEntities);
  const completedResearchByOwner = useAppStore((s) => s.hud.completedResearch);
  const followEntityId = useAppStore((s) => s.followEntityId);
  const setFollowEntity = useAppStore((s) => s.setFollowEntity);

  if (entities.length === 0) {
    return <div className="selected-entity-panel selected-entity-panel--empty">Click a unit or building on the map to inspect it — drag to select a group.</div>;
  }

  if (entities.length > 1) {
    return <SelectedGroupPanel entities={entities} mySide={mySide} onClear={() => setSelectedEntities([])} onFocus={(id) => setSelectedEntities([id])} />;
  }

  const entity = entities[0];
  const hpRatio = entity.maxHp > 0 ? entity.hp / entity.maxHp : 0;
  const isUnit = entity.kind === 'unit';
  const race = RACES[entity.race];
  const displayName = isUnit ? unitName(entity.race, entity.type) : buildingName(entity.race, entity.type);
  const definition = isUnit ? race.units[entity.raceUnitId] : race.buildings[entity.raceBuildingId];
  const skillDefinitions = isUnit ? race.units[entity.raceUnitId]?.skills ?? [] : [];
  const productionOptions = !isUnit
    ? UNITS_PRODUCED_BY[entity.type].flatMap((unitType) => {
      const entry = unitEntryForArchetype(entity.race, unitType);
      return entry ? [{ unitType, ...entry }] : [];
    })
    : [];
  const researchOptions = !isUnit ? RESEARCH_BY_BUILDING[entity.type] : [];
  const completedResearch = completedResearchByOwner[entity.owner] ?? [];
  const isFollowing = isUnit && followEntityId === entity.id;

  return (
    <div className={`selected-entity-panel selected-entity-panel--${entity.owner}`}>
      <div className="selected-entity-panel__identity">
        <div className={`selected-entity-panel__portrait selected-entity-panel__portrait--${entity.kind}`}>
          <img src={entityPortraitUrl(entity)} alt={`${displayName} portrait`} draggable={false} />
        </div>
        <div className="selected-entity-panel__identity-copy">
          <div className="selected-entity-panel__header">
            <span className="selected-entity-panel__title">{displayName}</span>
            {isUnit && (
              <button
                className={`selected-entity-panel__follow${isFollowing ? ' selected-entity-panel__follow--active' : ''}`}
                onClick={() => setFollowEntity(isFollowing ? null : entity.id)}
                title={isFollowing ? 'Stop following this unit' : 'Keep the camera centered on this unit'}
                aria-pressed={isFollowing}
              >
                {isFollowing ? '◉ Following' : '◎ Follow'}
              </button>
            )}
            <button className="selected-entity-panel__close" onClick={() => setSelectedEntities([])} title="Deselect" aria-label="Deselect entity">
              ×
            </button>
          </div>
          <div className={`selected-entity-panel__owner selected-entity-panel__owner--${entity.owner}`}>
            <img src={raceEmblemUrl(entity.race)} alt="" aria-hidden="true" draggable={false} />
            <span>{entity.owner === mySide ? 'Your' : 'Opponent'} {race.name}</span>
          </div>
          <span className="selected-entity-panel__class">{definition.class}</span>
        </div>
      </div>

      <div className="selected-entity-panel__row">
        <span>HP</span>
        <span>
          {Math.max(0, Math.round(entity.hp))} / {entity.maxHp}
        </span>
      </div>
      <ProgressBar ratio={hpRatio} color={hpRatio > 0.5 ? '#22c55e' : hpRatio > 0.25 ? '#f59e0b' : '#ef4444'} height={6} />

      {isUnit ? (
        <>
          <div className="selected-entity-panel__row">
            <span>Attack</span>
            <span>{entity.attack || '—'}</span>
          </div>
          <div className="selected-entity-panel__row">
            <span>Range</span>
            <span>{entity.attackRange || '—'}</span>
          </div>
          <div className="selected-entity-panel__row">
            <span>Damage / Armor</span>
            <span>{entity.damageTypes.join(' + ')} / {entity.armorType}</span>
          </div>
          <div className="selected-entity-panel__row">
            <span>Domain</span>
            <span>{entity.movementDomain} → {entity.targetDomains.join(', ')}</span>
          </div>
          <div className="selected-entity-panel__row">
            <span>Speed</span>
            <span>{entity.speed}</span>
          </div>
          <div className="selected-entity-panel__row">
            <span>Order</span>
            <span>{ORDER_LABEL[entity.order.type] ?? entity.order.type}</span>
          </div>
          {entity.type === 'builder' ? (
            <div className="selected-entity-panel__row">
              <span>Crystal cargo</span>
              <span>{entity.carriedResources}</span>
            </div>
          ) : null}
          {skillDefinitions.length > 0 ? (
            <section className="selected-entity-panel__options">
              <h4>Unit skills</h4>
              {skillDefinitions.map((skill) => {
                const state = entity.skills.find((candidate) => candidate.id === skill.id);
                const active = (state?.activeRemaining ?? 0) > 0;
                const cooldown = state?.cooldownRemaining ?? 0;
                return (
                  <div className={`selected-entity-panel__option${active ? ' selected-entity-panel__option--active' : ''}`} key={skill.id}>
                    <div className="selected-entity-panel__option-title">
                      <strong>{skill.name}</strong>
                      <span>{active ? `${state!.activeRemaining.toFixed(1)}s active` : cooldown > 0 ? `${cooldown.toFixed(1)}s` : 'Ready'}</span>
                    </div>
                    <p>{skill.description}</p>
                    <code>useUnitSkill(id, "{skill.id}")</code>
                  </div>
                );
              })}
            </section>
          ) : null}
        </>
      ) : (
        <>
          {entity.type === 'outpost' || entity.type === 'commandCenter' ? (
            <>
              <div className="selected-entity-panel__row">
                <span>Economy role</span>
                <span>Crystal drop-off</span>
              </div>
              <div className="selected-entity-panel__row">
                <span>Mining coverage</span>
                <span>{RESOURCE_GARRISON_RADIUS}</span>
              </div>
            </>
          ) : null}
          {entity.attack ? (
            <div className="selected-entity-panel__row">
              <span>Attack</span>
              <span>
                {entity.attack} @ {entity.attackRange}
              </span>
            </div>
          ) : null}
          {entity.underConstruction ? (
            <>
              <div className="selected-entity-panel__row">
                <span>Construction</span>
                <span>{Math.round(entity.constructionProgress * 100)}%</span>
              </div>
              <ProgressBar ratio={entity.constructionProgress} color="#60a5fa" height={6} />
            </>
          ) : entity.researchQueue.length > 0 ? (
            <>
              <div className="selected-entity-panel__row">
                <span>Researching</span>
                <span>{RESEARCH_NAME[entity.researchQueue[0].researchType]}</span>
              </div>
              <ProgressBar ratio={entity.researchQueue[0].progress} color="#22d3ee" height={6} />
            </>
          ) : entity.productionQueue.length > 0 ? (
            <>
              <div className="selected-entity-panel__row">
                <span>Producing</span>
                <span>
                  {unitName(entity.race, entity.productionQueue[0].unitType)} ({entity.productionQueue.length} queued)
                </span>
              </div>
              <ProgressBar ratio={entity.productionQueue[0].progress} color="#a855f7" height={6} />
            </>
          ) : (
            <div className="selected-entity-panel__row">
              <span>Status</span>
              <span>Idle</span>
            </div>
          )}
          {productionOptions.length > 0 ? (
            <section className="selected-entity-panel__options">
              <h4>Production options</h4>
              {productionOptions.map(({ id, unitType, definition: unit }) => {
                const requirement = UNIT_RESEARCH_REQUIREMENT[unitType];
                const locked = !!requirement && !completedResearch.includes(requirement);
                return (
                  <div className={`selected-entity-panel__option${locked ? ' selected-entity-panel__option--locked' : ''}`} key={id}>
                    <div className="selected-entity-panel__option-title">
                      <strong>{unit.name}</strong>
                      <span>{unit.cost} crystals</span>
                    </div>
                    <p>
                      {unit.class}
                      {requirement ? ` · ${locked ? '🔒 Locked — requires' : '✓ Unlocked by'} ${RESEARCH_NAME[requirement]}` : ''}
                    </p>
                    <code>train("{id}")</code>
                  </div>
                );
              })}
            </section>
          ) : null}
          {researchOptions.length > 0 ? (
            <section className="selected-entity-panel__options">
              <h4>Research options</h4>
              {researchOptions.map((research) => {
                const done = completedResearch.includes(research);
                const prerequisite = RESEARCH_PREREQUISITE[research];
                const locked = !done && !!prerequisite && !completedResearch.includes(prerequisite);
                const status = done
                  ? '✓ Completed'
                  : locked
                    ? '🔒 Locked'
                    : `${RACES[entity.race].researchCosts[research]} · ${RESEARCH_DURATION[research]}s`;
                return (
                <div
                  className={`selected-entity-panel__option${done ? ' selected-entity-panel__option--done' : ''}${locked ? ' selected-entity-panel__option--locked' : ''}`}
                  key={research}
                >
                  <div className="selected-entity-panel__option-title">
                    <strong>{RESEARCH_NAME[research]}</strong>
                    <span>{status}</span>
                  </div>
                  <p>
                    {RESEARCH_DESCRIPTION[research]}
                    {locked ? ` · Requires ${RESEARCH_NAME[prerequisite]}` : ''}
                  </p>
                  {!done && !locked && <code>research("{research}")</code>}
                </div>
                );
              })}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

interface SelectedGroupPanelProps {
  entities: Entity[];
  mySide: PlayerId;
  onClear: () => void;
  onFocus: (id: string) => void;
}

/** A drag-selected group's read-only summary: aggregate HP/attack plus a
 * breakdown by unit/building type. Clicking a row switches to the normal
 * single-entity detail view for one example of that type. */
function SelectedGroupPanel({ entities, mySide, onClear, onFocus }: SelectedGroupPanelProps) {
  const owners = new Set(entities.map((e) => e.owner));
  const ownerClass = owners.size === 1 ? entities[0].owner : undefined;
  const totalHp = entities.reduce((sum, e) => sum + e.hp, 0);
  const totalMaxHp = entities.reduce((sum, e) => sum + e.maxHp, 0);
  const totalAttack = entities.reduce((sum, e) => sum + (e.attack || 0), 0);
  const hpRatio = totalMaxHp > 0 ? totalHp / totalMaxHp : 0;

  const groups = new Map<string, { count: number; name: string; sample: Entity }>();
  for (const entity of entities) {
    const key = entity.kind === 'unit' ? `unit:${entity.race}:${entity.raceUnitId}` : `building:${entity.race}:${entity.raceBuildingId}`;
    const name = entity.kind === 'unit' ? unitName(entity.race, entity.type) : buildingName(entity.race, entity.type);
    const existing = groups.get(key);
    if (existing) existing.count += 1;
    else groups.set(key, { count: 1, name, sample: entity });
  }

  return (
    <div className={`selected-entity-panel${ownerClass ? ` selected-entity-panel--${ownerClass}` : ''}`}>
      <div className="selected-entity-panel__header">
        <span className="selected-entity-panel__title">
          {entities.length} selected {owners.size === 1 ? `(${owners.has(mySide) ? 'yours' : "opponent's"})` : '(mixed)'}
        </span>
        <button className="selected-entity-panel__close" onClick={onClear} title="Deselect" aria-label="Deselect group">
          ×
        </button>
      </div>

      <div className="selected-entity-panel__row">
        <span>Total HP</span>
        <span>{Math.round(totalHp)} / {Math.round(totalMaxHp)}</span>
      </div>
      <ProgressBar ratio={hpRatio} color={hpRatio > 0.5 ? '#22c55e' : hpRatio > 0.25 ? '#f59e0b' : '#ef4444'} height={6} />
      {totalAttack > 0 && (
        <div className="selected-entity-panel__row">
          <span>Total attack</span>
          <span>{totalAttack}</span>
        </div>
      )}

      <div className="selected-entity-panel__group-list">
        {[...groups.entries()].map(([key, { count, name, sample }]) => (
          <button key={key} className="selected-entity-panel__group-item" onClick={() => onFocus(sample.id)}>
            <img src={entityPortraitUrl(sample)} alt="" draggable={false} />
            <span className="selected-entity-panel__group-item-name">{name}</span>
            <span className="selected-entity-panel__group-item-count">×{count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
