import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useAppStore } from '../../state/store';
import type { PlayerId } from '../../types/game';
import type { MatchView } from '../../game/matchView';
import { otherPlayer } from '../../game/simulation/Simulation';
import { createOpponentStrategy, defaultScriptForRace } from '../../game/ai/strategies';
import { compile } from '../../game/ai/script/compiler';
import { deleteSaveFile, listSaveFiles, readSaveFile, renameSaveFile, writeSaveFile, type SaveFile } from '../../game/ai/saveFiles';
import { clearMatchHistory, loadMatchHistory, summarizeMatchHistory } from '../../game/ai/matchMemory';
import { CodeEditor } from '../StrategyEditor/CodeEditor';
import { ScriptReference } from '../StrategyEditor/ScriptReference';
import { LiveVariablesBar } from './LiveVariablesBar';
import { useLiveScriptVariables } from './useLiveScriptVariables';
import { Button } from '../shared/Button';
import { CompileStatus } from '../shared/CompileStatus';
import './Terminal.css';

export interface TerminalProps {
  controller: MatchView;
  mySide: PlayerId;
  syncToLocalStrategy: boolean;
  open: boolean;
  onClose: () => void;
}

type LineKind = 'input' | 'output' | 'error' | 'success' | 'system';
interface TermLine {
  id: number;
  kind: LineKind;
  text: string;
}

interface EditingState {
  owner: PlayerId;
  /** null = an unsaved buffer with no filename yet — `save`/Ctrl+S needs a name. */
  fileName: string | null;
  code: string;
}

const RESERVED_NAMES = new Set(['starter', 'default']);

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, '0')}`;
}

function withLineNumbers(code: string): string {
  const lines = code.split('\n');
  const width = String(lines.length).length;
  return lines.map((line, i) => `${String(i + 1).padStart(width, ' ')}  ${line}`).join('\n');
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.length}]`;
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === 'string') return value === '' ? '""' : `"${value}"`;
  return String(value);
}

function fileLabel(name: string): string {
  return name.toLowerCase() === 'starter' || name.toLowerCase() === 'default' ? 'starter.txt' : `${name}.txt`;
}

// The three built-in doctrines (aether.txt, ironclad.txt, nullforge.txt) all
// share this "brain" vocabulary — brainGoal/phase are just numbers in the
// running script, this is what `status` shows a human instead.
const GOAL_LABELS: Record<number, string> = {
  1: 'Defend',
  2: 'Rebuild economy',
  3: 'Expand',
  4: 'Scout',
  5: 'Build up forces',
  6: 'Research',
  7: 'Attack',
  8: 'Recover',
  9: 'Mop up',
  10: 'Naval',
};
const PHASE_LABELS: Record<number, string> = {
  0: 'Idle / early game',
  1: 'Preparing',
  2: 'Attacking',
  3: 'Recovering',
  4: 'Grouping for attack',
};

/** `status`'s categorization is a display heuristic over whatever variable
 * names the running script happens to use — first matching pattern wins, and
 * anything that matches nothing lands in "Other". Not specific to the
 * built-in doctrines; a custom script's differently-named variables just all
 * fall into "Other", same as a flat dump would have shown them. */
const CATEGORY_RULES: [string, RegExp][] = [
  ['Threat & defense', /threat|defense|defence|danger|guard/i],
  ['Combat', /combat|formation|attack|raid|blocker|retreat|kite|skill|focus|objective|chase|cleanup|launch/i],
  ['Army', /army|frontline|ranged|\bair\b|naval|composition|desired|infantry|factory|barracks|production|grouping|staging/i],
  ['Economy', /economic|economy|income|resource|reserve|crystal|mine|mining|cargo|worker|shaper|assembler|fabricator/i],
  ['Expansion', /expansion|outpost|node/i],
];

const HELP_TEXT = `Commands:
  help                     show this list
  ls [enemy]                list saved files for this race
  cat [file] [enemy]        print a file's code (current buffer if no file given)
  edit [file] [enemy]       open the editor (current buffer if no file given)
  run <file> [enemy]        load a saved file (or "starter") and apply it live
  save [file] [enemy]       save the current buffer under a name
  rm <file> [enemy]         delete a saved file
  mv <old> <new> [enemy]    rename a saved file
  status [enemy]            show live script variables
  log [n]                   show the last n activity log entries (default 20)
  history [clear]           show, or clear, your saved match history for this race
  enemy reset               reset the opponent's code to its default AI
  clear                     clear the screen

"starter" always refers to the built-in default doctrine for the race in
play — it isn't a real file, so it can't be saved over.`;

let nextLineId = 0;

/**
 * The match screen's live AI editor, styled as a small in-game terminal
 * instead of a tabbed GUI panel: your AI code lives in named "files" you
 * ls/cat/edit/run/save, the same way you'd work at a shell. `edit` still
 * opens the real CodeMirror editor (with live values, coordinate-picking,
 * and the script reference) — the terminal is the way you navigate to it
 * and manage saves, not a replacement for actually writing code in it.
 */
export function Terminal({ controller, mySide, syncToLocalStrategy, open, onClose }: TerminalProps) {
  const playerStrategy = useAppStore((s) => s.playerStrategy);
  const setPlayerStrategy = useAppStore((s) => s.setPlayerStrategy);
  const activityLog = useAppStore((s) => s.hud.activityLog);
  const pendingCoordinateInsert = useAppStore((s) => s.pendingCoordinateInsert);
  const beginCoordinateInsert = useAppStore((s) => s.beginCoordinateInsert);
  const cancelCoordinateInsert = useAppStore((s) => s.cancelCoordinateInsert);
  const insertedCoordinate = useAppStore((s) => s.insertedCoordinate);
  const clearInsertedCoordinate = useAppStore((s) => s.clearInsertedCoordinate);

  const theirSide = otherPlayer(mySide);
  const myStrategy = controller.getStrategy(mySide);
  const theirStrategy = controller.getStrategy(theirSide);
  const theirCodeIsEditable = syncToLocalStrategy;

  const [lines, setLines] = useState<TermLine[]>([]);
  const [input, setInput] = useState('');
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyPos, setHistoryPos] = useState<number | null>(null);
  const [myFile, setMyFile] = useState<string | null>(null);
  const [theirFile, setTheirFile] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [saveNameDraft, setSaveNameDraft] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const editingLiveValues = useLiveScriptVariables(controller, editing?.owner ?? mySide);

  useEffect(() => {
    if (!open) return;
    setLines([]);
    print('system', `AVERA terminal — ${controller.sim.state.players[mySide].race} — type "help" to get started.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!editing) inputRef.current?.focus();
  }, [editing, lines]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines]);

  if (!open) return null;

  function print(kind: LineKind, text: string) {
    setLines((ls) => [...ls, { id: nextLineId++, kind, text }]);
  }

  function raceOf(owner: PlayerId) {
    return controller.sim.state.players[owner].race;
  }

  function applyLiveCode(owner: PlayerId, code: string, hardReset: boolean) {
    if (owner === mySide && syncToLocalStrategy) setPlayerStrategy({ ...playerStrategy, mode: 'code', code });
    controller.setCode(owner, code, hardReset);
  }

  // --- commands ---

  function cmdHelp() {
    print('output', HELP_TEXT);
  }

  function cmdLs(target: PlayerId) {
    const race = raceOf(target);
    const files = listSaveFiles(race);
    const current = target === mySide ? myFile : theirFile;
    const rows = [`  starter.txt${' '.repeat(Math.max(1, 14 - 'starter.txt'.length))}[built-in doctrine]`];
    for (const f of files) {
      const marker = f.name === current ? '*' : ' ';
      rows.push(`${marker} ${fileLabel(f.name)}${' '.repeat(Math.max(1, 16 - fileLabel(f.name).length))}saved ${new Date(f.updatedAt).toLocaleString()}`);
    }
    print('output', `${race} files:\n${rows.join('\n')}`);
  }

  function resolveCode(name: string | undefined, owner: PlayerId): { code: string; label: string } | null {
    const strategy = owner === mySide ? myStrategy : theirStrategy;
    if (!name) return { code: strategy.code, label: '(current buffer)' };
    if (RESERVED_NAMES.has(name.toLowerCase())) return { code: defaultScriptForRace(raceOf(owner)), label: 'starter.txt' };
    const file = readSaveFile(raceOf(owner), name);
    if (!file) return null;
    return { code: file.code, label: fileLabel(file.name) };
  }

  function cmdCat(name: string | undefined, owner: PlayerId) {
    const resolved = resolveCode(name, owner);
    if (!resolved) {
      print('error', `cat: ${name}: no such file`);
      return;
    }
    print('output', `── ${resolved.label} ──\n${withLineNumbers(resolved.code)}`);
  }

  /** Starts (or replaces) an editing session — the one place that sets
   * `editing`'s identity, so `saveNameDraft` is seeded exactly once per
   * session rather than via an effect keyed on `editing` (which would refire
   * — and clobber whatever the player just typed into the filename field —
   * on every single keystroke in the code editor, since handleEditorChange
   * has to give `editing` a new object identity to update its code). */
  function openEditor(state: EditingState) {
    setEditing(state);
    setSaveNameDraft(state.fileName ?? '');
    setSaveError(null);
  }

  function cmdEdit(name: string | undefined, owner: PlayerId) {
    if (owner !== mySide && !theirCodeIsEditable) {
      print('error', "read-only — this is your opponent's real code, over the network. Try `cat enemy`.");
      return;
    }
    if (!name) {
      const current = owner === mySide ? myFile : theirFile;
      openEditor({ owner, fileName: current, code: (owner === mySide ? myStrategy : theirStrategy).code });
      return;
    }
    const clean = name.trim();
    if (RESERVED_NAMES.has(clean.toLowerCase())) {
      openEditor({ owner, fileName: null, code: defaultScriptForRace(raceOf(owner)) });
      print('system', 'Opened the built-in starter doctrine as a new unsaved buffer — save it under a real name to keep it.');
      return;
    }
    const existing = readSaveFile(raceOf(owner), clean);
    if (existing) {
      openEditor({ owner, fileName: existing.name, code: existing.code });
    } else {
      openEditor({ owner, fileName: clean, code: (owner === mySide ? myStrategy : theirStrategy).code });
      print('system', `"${clean}" doesn't exist yet — starting it from the current buffer. Save to create it.`);
    }
  }

  function cmdRun(name: string | undefined, owner: PlayerId) {
    if (!name) {
      print('error', 'usage: run <file>');
      return;
    }
    if (owner !== mySide && !theirCodeIsEditable) {
      print('error', "read-only — this is your opponent's real code, over the network.");
      return;
    }
    const clean = name.trim();
    let code: string;
    if (RESERVED_NAMES.has(clean.toLowerCase())) {
      code = owner === mySide ? defaultScriptForRace(raceOf(owner)) : createOpponentStrategy('Aggressor AI', 'standard', raceOf(owner)).code;
    } else {
      const file = readSaveFile(raceOf(owner), clean);
      if (!file) {
        print('error', `run: ${clean}: no such file`);
        return;
      }
      code = file.code;
    }
    if (owner === mySide) setMyFile(RESERVED_NAMES.has(clean.toLowerCase()) ? null : clean);
    else setTheirFile(RESERVED_NAMES.has(clean.toLowerCase()) ? null : clean);
    applyLiveCode(owner, code, true);
    const compiled = compile(code);
    if (compiled.errors.length > 0) {
      const first = compiled.errors[0];
      print(
        'error',
        `Running ${fileLabel(clean)}${owner !== mySide ? ' (opponent)' : ''} — but it does not compile: ` +
          `line ${first.line}, col ${first.col}: ${first.message}` +
          (compiled.errors.length > 1 ? ` (+${compiled.errors.length - 1} more)` : ''),
      );
      return;
    }
    print('success', `Running ${fileLabel(clean)}${owner !== mySide ? ' (opponent)' : ''}.`);
  }

  function cmdSave(name: string | undefined, owner: PlayerId) {
    const current = owner === mySide ? myFile : theirFile;
    const target = (name?.trim() || current) ?? undefined;
    if (!target) {
      print('error', 'usage: save <file> — no current filename to save over');
      return;
    }
    if (RESERVED_NAMES.has(target.toLowerCase())) {
      print('error', `"${target}" is reserved for the built-in doctrine — pick another name.`);
      return;
    }
    const code = (owner === mySide ? myStrategy : theirStrategy).code;
    writeSaveFile(raceOf(owner), target, code);
    if (owner === mySide) setMyFile(target);
    else setTheirFile(target);
    print('success', `Saved ${fileLabel(target)}.`);
  }

  function cmdRm(name: string | undefined, owner: PlayerId) {
    if (!name) {
      print('error', 'usage: rm <file>');
      return;
    }
    if (deleteSaveFile(raceOf(owner), name)) {
      if (owner === mySide && myFile === name) setMyFile(null);
      if (owner === theirSide && theirFile === name) setTheirFile(null);
      print('success', `Removed ${fileLabel(name)}.`);
    } else {
      print('error', `rm: ${name}: no such file`);
    }
  }

  function cmdMv(oldName: string | undefined, newName: string | undefined, owner: PlayerId) {
    if (!oldName || !newName) {
      print('error', 'usage: mv <old> <new>');
      return;
    }
    if (RESERVED_NAMES.has(newName.toLowerCase())) {
      print('error', `"${newName}" is reserved for the built-in doctrine — pick another name.`);
      return;
    }
    if (renameSaveFile(raceOf(owner), oldName, newName)) {
      if (owner === mySide && myFile === oldName) setMyFile(newName);
      if (owner === theirSide && theirFile === oldName) setTheirFile(newName);
      print('success', `Renamed ${fileLabel(oldName)} → ${fileLabel(newName)}.`);
    } else {
      print('error', `mv: couldn't rename ${oldName} — it may not exist, or ${newName} is already taken.`);
    }
  }

  function cmdStatus(owner: PlayerId) {
    const vars = controller.getScriptVariables(owner);
    const entries = Object.entries(vars);
    const who = owner === mySide ? 'Your' : "Opponent's";
    if (entries.length === 0) {
      print('output', `${who} live variables: none (visual-rules strategy, nothing running yet, or not visible over the network).`);
      return;
    }

    // The three built-in doctrines (and anything derived from them) share
    // this vocabulary — this is a summary, not a hardcoded requirement, so a
    // custom script without them just skips straight to the categorized dump.
    const headline: string[] = [];
    if ('brainGoal' in vars) headline.push(`goal: ${GOAL_LABELS[Number(vars.brainGoal)] ?? String(vars.brainGoal)}`);
    if ('phase' in vars) headline.push(`phase: ${PHASE_LABELS[Number(vars.phase)] ?? String(vars.phase)}`);
    if ('emergencyActive' in vars) headline.push(`emergency: ${vars.emergencyActive ? 'YES' : 'no'}`);
    if ('economicCrisis' in vars) headline.push(`economy: ${vars.economicCrisis ? 'CRISIS' : vars.economicWarning ? 'warning' : 'ok'}`);
    if ('armyHealthScore' in vars) headline.push(`army health: ${(Number(vars.armyHealthScore) * 100).toFixed(0)}%`);
    if ('recentLosses' in vars) headline.push(`recent losses: ${formatValue(vars.recentLosses)}`);
    if ('incomeRate' in vars) headline.push(`income: ${Number(vars.incomeRate).toFixed(1)}/s`);

    const HEADLINE_KEYS = new Set(['brainGoal', 'phase', 'emergencyActive', 'economicCrisis', 'economicWarning', 'armyHealthScore', 'recentLosses', 'incomeRate']);
    const rest = entries.filter(([k]) => !HEADLINE_KEYS.has(k));
    const grouped = new Map<string, [string, unknown][]>();
    for (const [k, v] of rest) {
      const category = CATEGORY_RULES.find(([, re]) => re.test(k))?.[0] ?? 'Other';
      if (!grouped.has(category)) grouped.set(category, []);
      grouped.get(category)!.push([k, v]);
    }

    const width = Math.min(28, Math.max(...rest.map(([k]) => k.length)));
    const sections: string[] = [];
    if (headline.length > 0) sections.push(headline.join('  ·  '));
    for (const [category] of CATEGORY_RULES) {
      const items = grouped.get(category);
      if (!items || items.length === 0) continue;
      sections.push(`${category}:\n${items.map(([k, v]) => `  ${k.padEnd(width)}  ${formatValue(v)}`).join('\n')}`);
    }
    const other = grouped.get('Other');
    if (other && other.length > 0) {
      sections.push(`Other:\n${other.map(([k, v]) => `  ${k.padEnd(width)}  ${formatValue(v)}`).join('\n')}`);
    }

    print('output', `${who} status:\n${sections.join('\n\n')}`);
  }

  function cmdLog(nStr: string | undefined) {
    const n = nStr ? Math.max(1, parseInt(nStr, 10) || 20) : 20;
    const recent = activityLog.slice(-n);
    if (recent.length === 0) {
      print('output', 'No AI decisions logged yet.');
      return;
    }
    print('output', recent.map((e) => `  ${formatDuration(e.time)}  ${e.message}`).join('\n'));
  }

  function cmdHistory(sub: string | undefined) {
    const race = raceOf(mySide);
    if (sub === 'clear') {
      clearMatchHistory();
      print('success', 'Cleared saved match history (all races).');
      return;
    }
    const records = loadMatchHistory(race);
    const summary = summarizeMatchHistory(records);
    if (summary.matchesPlayed === 0) {
      print('output', `No recorded matches yet for ${race}. History is saved automatically at the end of local matches.`);
      return;
    }
    const streak = summary.currentWinStreak > 0 ? `W${summary.currentWinStreak}` : summary.currentLossStreak > 0 ? `L${summary.currentLossStreak}` : '—';
    const header = `${race} record: ${summary.matchesWon}W–${summary.matchesLost}L–${summary.matchesDrawn}D  (${(summary.winRate * 100).toFixed(0)}% win rate, streak ${streak}, avg ${formatDuration(summary.averageDurationSeconds)})`;
    const recentRows = [...records]
      .slice(-8)
      .reverse()
      .map((r) => `  ${new Date(r.timestamp).toLocaleDateString()}  ${r.outcome.toUpperCase().padEnd(5)} vs ${r.opponentRace.padEnd(10)} ${formatDuration(r.durationSeconds)}`)
      .join('\n');
    print('output', `${header}\nRecent matches:\n${recentRows}`);
  }

  // --- dispatch ---

  function runCommand(raw: string) {
    const trimmed = raw.trim();
    print('input', trimmed);
    if (!trimmed) return;
    setCommandHistory((h) => [...h, trimmed]);
    setHistoryPos(null);

    const args = trimmed.split(/\s+/);
    const cmd = args[0].toLowerCase();
    const isEnemy = args[args.length - 1]?.toLowerCase() === 'enemy';
    const positional = isEnemy ? args.slice(1, -1) : args.slice(1);
    const owner: PlayerId = isEnemy ? theirSide : mySide;

    switch (cmd) {
      case 'help':
        cmdHelp();
        break;
      case 'ls':
        cmdLs(owner);
        break;
      case 'cat':
        cmdCat(positional[0], owner);
        break;
      case 'edit':
        cmdEdit(positional[0], owner);
        break;
      case 'run':
        cmdRun(positional[0], owner);
        break;
      case 'save':
        cmdSave(positional[0], owner);
        break;
      case 'rm':
        cmdRm(positional[0], owner);
        break;
      case 'mv':
        cmdMv(positional[0], positional[1], owner);
        break;
      case 'status':
      case 'debug':
        cmdStatus(owner);
        break;
      case 'log':
        cmdLog(positional[0]);
        break;
      case 'history':
        cmdHistory(positional[0]);
        break;
      case 'enemy':
        if (positional[0] === 'reset') cmdRun('starter', theirSide);
        else print('error', 'usage: enemy reset — or append "enemy" to another command, e.g. "cat enemy"');
        break;
      case 'clear':
        setLines([]);
        break;
      default:
        print('error', `${cmd}: command not found — try "help"`);
    }
  }

  function onInputKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      runCommand(input);
      setInput('');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length === 0) return;
      const nextPos = historyPos === null ? commandHistory.length - 1 : Math.max(0, historyPos - 1);
      setHistoryPos(nextPos);
      setInput(commandHistory[nextPos]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyPos === null) return;
      const nextPos = historyPos + 1;
      if (nextPos >= commandHistory.length) {
        setHistoryPos(null);
        setInput('');
      } else {
        setHistoryPos(nextPos);
        setInput(commandHistory[nextPos]);
      }
    }
  }

  function closeEditor() {
    setEditing(null);
    setSaveError(null);
  }

  function handleEditorChange(code: string) {
    if (!editing) return;
    setEditing({ ...editing, code });
    applyLiveCode(editing.owner, code, false);
  }

  function handleEditorSave() {
    if (!editing) return;
    const name = saveNameDraft.trim();
    if (!name) {
      setSaveError('Enter a filename first.');
      return;
    }
    if (RESERVED_NAMES.has(name.toLowerCase())) {
      setSaveError('"starter"/"default" is reserved for the built-in doctrine.');
      return;
    }
    writeSaveFile(raceOf(editing.owner), name, editing.code);
    setEditing({ ...editing, fileName: name });
    if (editing.owner === mySide) setMyFile(name);
    else setTheirFile(name);
    setSaveError(null);
    print('success', `Saved ${fileLabel(name)}.`);
  }

  const insertText = insertedCoordinate ? `${Math.round(insertedCoordinate.x)}, ${Math.round(insertedCoordinate.y)}` : null;

  return (
    <div
      className="terminal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDownCapture={(e) => {
        if (e.key === 'Escape' && editing) {
          e.stopPropagation();
          e.preventDefault();
          closeEditor();
        }
      }}
    >
      <div className="terminal">
        <div className="terminal__bar">
          <span className="terminal__title">
            {editing ? `edit — ${editing.fileName ? fileLabel(editing.fileName) : '(unsaved)'}${editing.owner !== mySide ? ' — opponent' : ''}` : `${raceOf(mySide)} terminal`}
          </span>
          <button className="terminal__close" onClick={onClose} title="Close (Esc)">
            ✕
          </button>
        </div>

        {editing ? (
          <div className="terminal__editor">
            <div className="terminal__editor-toolbar">
              <Button variant="secondary" onClick={() => (pendingCoordinateInsert ? cancelCoordinateInsert() : beginCoordinateInsert())}>
                {pendingCoordinateInsert ? 'Click the map…' : '📍 Pick position'}
              </Button>
              <input
                className="terminal__save-name"
                value={saveNameDraft}
                onChange={(e) => setSaveNameDraft(e.target.value)}
                placeholder="filename"
                spellCheck={false}
              />
              <Button variant="primary" onClick={handleEditorSave}>
                💾 Save
              </Button>
              <Button variant="ghost" onClick={closeEditor}>
                Done (Esc)
              </Button>
              {saveError && <span className="terminal__save-error">{saveError}</span>}
              <CompileStatus code={editing.code} />
            </div>
            <LiveVariablesBar controller={controller} owner={editing.owner} />
            <div className="terminal__editor-row">
              <CodeEditor
                value={editing.code}
                onChange={handleEditorChange}
                insertAtCursor={insertText}
                onInsertHandled={clearInsertedCoordinate}
                liveValues={editingLiveValues}
              />
              <ScriptReference />
            </div>
          </div>
        ) : (
          <>
            <div className="terminal__scroll" ref={scrollRef}>
              {lines.map((line) => (
                <pre key={line.id} className={`terminal__line terminal__line--${line.kind}`}>
                  {line.kind === 'input' ? `$ ${line.text}` : line.text}
                </pre>
              ))}
            </div>
            <div className="terminal__prompt-row">
              <span className="terminal__prompt">$</span>
              <input
                ref={inputRef}
                className="terminal__input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onInputKeyDown}
                spellCheck={false}
                autoComplete="off"
                placeholder='type "help"'
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
