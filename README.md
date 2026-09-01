# AI WAR (Prototype)

**AEVRA** — a code-vs-code RTS prototype: you write your side's AI as a small script, the built-in opponent's AI is a script too (visible and read-only once a match starts), and the two scripts fight continuously on a small symmetrical map.

This repo is the standalone browser prototype, split out once active development moved to a separate Unreal Engine project. `tools/` holds scripts for an optional Blender/Hunyuan3D-2mini image-to-3D asset pipeline for that Unreal project; it isn't used by the web prototype below. `.tools/` holds the local, gitignored dependencies for that pipeline (Python venv, Blender, model weights) and isn't part of the shipped project.

## Stack

Vite + React + TypeScript + Phaser 3 (game canvas/simulation) + CodeMirror 6 (the code editor) + Zustand (shared UI/game state) + Vitest (logic tests) + a Node/WebSocket authoritative multiplayer server. You can play locally against the built-in AI or create/join a two-player LAN match. There is no auth or public matchmaking yet.

## Getting started

```bash
npm install
npm run dev      # start the dev server (prints a local URL to open)
npm run server   # start the multiplayer WebSocket server on port 8787
npm test         # run the Vitest suite (simulation + AI logic)
npm run build    # type-check (tsc -b) and produce a production build in dist/
npm run typecheck:server # type-check the Node multiplayer server
```

For multiplayer, run both `npm run dev -- --host` and `npm run server` on the host machine, then open the Vite URL from two browsers (or two machines on the same LAN). Choose **Multiplayer**, create a room, and share its five-character code. Port 8787 must be reachable from both clients.

## How to play

1. **Main Menu** — start a local match with your currently loaded AI, create/join a multiplayer match, or open the editor first.
2. **Your AI** (pre-match editor) — write your AI as code. See [Scripting language](#scripting-language) below. Save to your browser (localStorage), or load the shipped default/advanced example scripts to start from something that already works.
3. **Match** — both you and the computer opponent start with 1 Command Center, 1 Builder, and 200 resources. Both AIs gather resources, construct buildings, research upgrades, train units, activate race-specific skills, and fight continuously. Strategy scripts react at 20 Hz while movement and combat run at 60 Hz.
4. **The live code panel** is docked at the bottom of the match screen the whole time, collapsible down to a thin bar. **Your Code** is live — edit it mid-match and it hot-reloads within about a second (the running `MatchController`'s strategy object is mutated directly; `ScriptEngine` recompiles whenever the code changes). **Enemy Code** is the same view, read-only, so you can actually see what you're fighting. **Activity Log** and **Selected** (info on whatever unit/building you last clicked) are the other two tabs.
5. **Continuous battle** — there are no command phases or manual strategic interventions. Gathering, production, movement, defense, and attacks all come from the AI code you write.
6. **Settings** (gear icon, or your bound key) — keybinds are code too now: a small script (`bind(key, action);`) instead of a settings form. See [Scripting language](#scripting-language).
7. **Victory** uses StarCraft-style elimination: a commander remains alive while any building is standing; units alone cannot prevent defeat. The end-of-match overlay reports match duration, units created/lost, buildings constructed, and resources gathered.

## Scripting language

Both the AI and the keybinds run on the same small, deliberately limited language of our own — not real JavaScript, and never `eval`'d. It's lexed, parsed, and interpreted by a hand-written tree-walking interpreter (`src/game/ai/script/`) that only ever calls into a fixed, safe function table — there is no path from a script to anything else in the browser.

```js
// Runs once per second. "let" only sets a variable the first time it runs —
// after that it's a no-op, so a variable can hold memory across ticks. Use
// plain assignment (x = value;) to change one, including to reset it.
function push(minStrength) {
  if (armyStrength() >= minStrength) {
    attackEnemyCommandCenter();
  }
}

if (commandCenterUnderAttack()) {
  defendCommandCenter();
}
if (resources() >= 200) {
  constructBarracksAt(baseX() + 100, baseY());
}
push(6);
```

- **Syntax:** `let`/`var`, plain assignment, `if`/`else`, `while`, `for (id in list) { ... }`, `function name(a, b) { ... return expr; }`, the usual arithmetic/comparison/logical operators, `//` comments, string literals (for `log(...)`).
- **Functions:** a script can define its own (params, return values, a fresh local scope per call distinct from the persistent global scope, a call-depth guard against runaway recursion — no hoisting, define before use).
- **Positions:** everything is plain numbers, so x/y math is just arithmetic — `baseX()/baseY()`, `enemyBaseX()/enemyBaseY()`, `nearestEnemyX()/nearestEnemyY()`, and `*At(x, y)` siblings of the build/rally/attack actions. The code panel's "📍 Pick position" button inserts a clicked map coordinate at your cursor.
- **Unit groups:** queries like `myUnits()`, `myUnitsOfType("soldier")`, `unitsNear(x, y, r)`, `enemyUnitsNear(x, y, r)` return a list of unit ids to loop over with `for`; `unitX/unitY/unitHp/unitType/unitExists(id)` read one, `moveUnitTo/attackUnitTo(id, x, y)` command one — ownership-checked in `Simulation`, so you can inspect a scouted enemy unit but never command it.
- **Safety:** a script re-runs from the top once per AI tick (20 Hz) with a 5,000-step budget and a 100-deep call-depth limit; either aborts that tick with a reported error instead of hanging the game. Compile errors show as inline squiggles (`@codemirror/lint`, fed from our own compiler) and a live "✓ Compiles cleanly / ✗ N errors" status; runtime errors surface once (not every tick) in the Activity Log.
- **Keybinds** reuse the same compiler with a tiny one-shot API — `bind("1", "attack_now");` — run once (not per-tick) to produce a key → action map.
- **Reference:** the in-editor "Language Reference" panel lists the full function table (`src/game/ai/script/api.ts`); "Load Default Script" and "Load Advanced Example" are working starting points.

## Controls

| Action | Control |
| --- | --- |
| Select a visible unit or building | Click it on the map |
| Deselect | Click empty ground |
| Pan the larger battlefield | WASD / arrow keys, or right-drag the map |
| Zoom the battlefield | Mouse wheel over the map |
| Insert a map coordinate into your code | "📍 Pick position" in the code panel, then click the map |
| Pause / Resume, speed, restart, menu | Toolbar above the map |
| Expand/collapse the code panel | ▼/▲ button, bottom-left |
| Settings / keybinds | Gear icon, or your bound key (default `K`) |

## Project layout

```
src/
  types/            Shared TypeScript types (game state, match stats, AI strategy schema, intervention commands)
  game/
    constants.ts    Unit/building costs, stats, timers
    simulation/      Framework-free simulation engine (Simulation.ts) + map generation + entity factories
    ai/              Default + opponent strategies, rule engine (kept for its own tests, no longer reachable from the UI)
      script/        The scripting language: lexer, parser, interpreter, host API, ScriptEngine
    intervention/    Legacy intervention helpers retained for compatibility
    phaser/          Phaser 3 scene (renders units/buildings, entity selection, fixed-timestep loop) and the React wrapper
    matchController.ts   Drives the continuous battle, AI activity log, and match statistics
    matchView.ts     Shared rendering/UI interface implemented by local and remote match controllers
  net/              WebSocket protocol/client, snapshot-backed remote controller, multiplayer Zustand state
  state/            Zustand store (screens, HUD snapshot, selection, pause/speed), keybindScript.ts (keybind compiler)
  components/       React UI: main menu, multiplayer lobby, code editor, match HUD/overlays/AiCodePanel, keybind editor
server/             Authoritative WebSocket room server; runs Simulation + MatchController at a fixed timestep
```

The simulation and language runtime are plain TypeScript with no Phaser/React dependency, so the same `Simulation`, `ScriptEngine`, and `MatchController` run either in the browser for local play or on the authoritative server for multiplayer. Network clients send only code edits and intervention commands and render server snapshots through `RemoteMatchController`.

The live game loop runs on a fixed 1/60s timestep, accumulated from real frame time and scaled by the speed control, so gameplay outcomes don't depend on the browser's actual render frame rate.

## Current limitations

This is a single-stage prototype, not a finished game:

- **Multiplayer is LAN-oriented.** Rooms are in memory, have no auth or matchmaking, and do not survive a server restart. There is no reconnect/resume support; if either socket disconnects, the room stops.
- **Snapshots are rendered directly.** There is no interpolation or latency reconciliation yet, so movement can look choppy on a slow connection.
- **Movement is direct-line, not pathfound.** Units move straight toward their target and only separate softly on top of each other; they don't route around buildings or obstacles.
- **One large fog-of-war map, two AI-controlled sides.** The layout, unit roster, and building set are fixed; there's no map selection, unit upgrades, or tech tree yet.
- **Neither AI is adaptive.** A script has no memory of what worked last match and doesn't learn — behavior is entirely what you (or the opponent's default script) wrote beforehand.
- **The scripting language is intentionally small.** One flat variable scope per frame (global, or one function call — no block scoping/shadowing beyond that), no closures, no arrays/objects beyond the unit-id lists queries return, and no `break`/`continue` (a loop is stopped early by pushing its own counter past its bound — see the Advanced Example). The editor also reports only the first syntax error per compile, not every error at once.
- **No audio**, and all visuals are flat colored shapes with text labels — no sprite art or animation.
- **Balance is approximate.** Costs, build times, and combat stats are reasonable starting values, not tuned through playtesting.

## Planned next

- **Production-ready multiplayer** — authenticated players, public/private matchmaking, reconnect/resume, protocol validation/rate limiting, and persistent match history.
- **Richer unit queries** — more find-by-criteria queries and possibly named control groups, building on the unit-groups API above.

### Multiplayer architecture

- `server/room.ts` owns one `MatchController` per two-player room and steps it at the same fixed 1/60s rate as local play.
- The host is assigned the internal `player` side and the guest the `enemy` side. Each client receives the same authoritative snapshot and uses its assigned side to label "you," route code edits/commands, and calculate victory.
- The wire protocol accepts only room lifecycle messages, code updates, and intervention commands. AI scripts still execute exclusively through the bounded interpreter on the server.
- The server broadcasts state snapshots at 10 Hz. `RemoteMatchController` implements the same `MatchView` interface as the local controller, so Phaser and the React match UI do not need separate rendering paths.
