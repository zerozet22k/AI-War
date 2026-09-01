# Race packs, units, buildings, and animation frames

Faction content is data-driven. Each race owns a packaged manifest and its
own individual PNG frames:

```text
src/assets/races/aether/
  aether.race.json
  sprites/
    units/shaper/idle-a.png
    units/shaper/idle-b.png
    units/shaper/move-a.png
    ...
    buildings/heartspire/production-a.png
    buildings/memoryBloom/research-a.png
```

The Ironclad layout is identical under `src/assets/races/ironclad/`.
`MainScene` discovers these files at build time and reads identity, size,
asset path, and animation behavior from the race manifest. Do not add sprite
paths, entity-size `if` statements, or atlas rows to Phaser.

## Identity, class, and archetype are different

A race manifest is an open roster keyed by real faction IDs:

```json
"shaper": {
  "name": "Shaper",
  "shortName": "Shaper",
  "class": "builder",
  "archetype": "builder",
  "size": 38,
  "asset": "sprites/units/shaper",
  "animation": "support"
}
```

- The key (`shaper`) is the stable race-local ID used by saved/network state.
- `name` is the real display/script name.
- `class` is an open faction-facing category. It can be a new string without
  changing Phaser or TypeScript.
- `archetype` selects reusable simulation behavior/stats from
  `src/game/constants.ts`. A new class can reuse an existing archetype; a
  genuinely new mechanic needs a new archetype handler there.

Races do not have to implement every archetype. Generic AI requests for a
missing archetype fail cleanly. A race can also contain additional entries.
The script API accepts the race ID, display name, class, or archetype, so all
of these are valid when the selected race provides the match:

```js
train("Shaper");
train("shaper");
unitCount("builder");
unitCount("infantry");
construct("Memory Bloom");
```

## Unit animation files

Every unit directory contains eight separate transparent PNGs:

```text
idle-a.png
idle-b.png
move-a.png
move-b.png
windup.png
action.png
recovery.png
destroyed.png
```

The race manifest maps named states to these frames and selects an animation
class (`foot`, `ground`, `air`, `naval`, or `support`) with its own FPS.
Phaser selects idle/move/fire from actual simulation state; builders use the
action frames while gathering/building, support units while healing, and
combat units during their real cooldown window. Destroyed frames linger and
fade instead of disappearing immediately.

## Building animation files

Each structure directory contains:

```text
idle-a.png
idle-b.png
production-a.png
production-b.png
research-a.png
research-b.png
damaged.png
destroyed.png
```

Production frames run only while a unit is queued. Research frames run only
while the research queue is active. Damage/destruction use authored frames.

## Splitting generated source sheets

Large generated sheets are source material only; the game loads the separate
frames. After replacing a source sheet, rebuild all padded, isolated frames:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/split-race-sprites.ps1
```

The splitter uses overlapping crops so wings, wakes, fins, and muzzle effects
are not clipped at mathematical grid edges. It then runs
`scripts/clean-sprite-frames.ps1`, which removes adjacent-cell bleed and
low-alpha generated backgrounds. The scripts validate that all writes stay
inside `src/assets/races`.

## Adding gameplay behavior

For a unit that reuses an archetype, add only its manifest entry and eight
frames. For a genuinely new archetype, add it to `UNIT_TYPE_LIST` in
`src/types/game.ts`, then fill the compiler-enforced records in
`src/game/constants.ts` (cost, build time, stats, producer, and research
requirement if any). Add simulation logic only when its behavior is truly
new.

Buildings follow the same pattern with `BUILDING_TYPE_LIST`, building stats,
cost/build time, and a race-manifest entry. Run `npm run build` after changes.
