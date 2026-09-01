import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';

/** Dispatch this to push a fresh snapshot of live variable values into the
 * editor — see CodeEditor's liveValues prop. */
export const setLiveValues = StateEffect.define<Record<string, unknown>>();

function formatLiveValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.length}]`;
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === 'string') return value === '' ? '""' : `"${value}"`;
  return String(value);
}

class LiveValueWidget extends WidgetType {
  constructor(private readonly text: string) {
    super();
  }

  eq(other: LiveValueWidget): boolean {
    return other.text === this.text;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-live-value';
    span.textContent = this.text;
    return span;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

// Matches a top-level `let name = ...;` declaration — the same shape the
// script language actually uses for persistent variables (see interpreter.ts:
// a `let` only initializes once per scope, which is what lets it hold memory
// across ticks). Only whole-line declarations are annotated; a `let` buried
// inside a function body isn't scored against the global variables snapshot.
const LET_DECLARATION = /^(\s*)let\s+([A-Za-z_$][\w$]*)\s*=/;

function buildDecorations(state: EditorState, values: Record<string, unknown>): DecorationSet {
  if (Object.keys(values).length === 0) return Decoration.none;
  const widgets = [];
  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    const match = LET_DECLARATION.exec(line.text);
    if (!match) continue;
    const name = match[2];
    if (!(name in values)) continue;
    const widget = new LiveValueWidget(`// = ${formatLiveValue(values[name])}`);
    widgets.push(Decoration.widget({ widget, side: 1 }).range(line.to));
  }
  return Decoration.set(widgets, true);
}

interface LiveValuesFieldState {
  values: Record<string, unknown>;
  decorations: DecorationSet;
}

const liveValuesField = StateField.define<LiveValuesFieldState>({
  create() {
    return { values: {}, decorations: Decoration.none };
  },
  update(current, tr) {
    let values = current.values;
    for (const effect of tr.effects) {
      if (effect.is(setLiveValues)) values = effect.value;
    }
    if (!tr.docChanged && values === current.values) return current;
    return { values, decorations: buildDecorations(tr.state, values) };
  },
  provide: (field) => EditorView.decorations.of((view) => view.state.field(field).decorations),
});

/** Annotates every top-level `let` declaration with its live current value
 * (fed in via dispatching setLiveValues) — a script's persistent memory,
 * shown right next to the code that declares it, not just the source text. */
export function liveValuesExtension(): Extension {
  return [
    liveValuesField,
    EditorView.baseTheme({
      '.cm-live-value': {
        marginLeft: '1ch',
        color: 'var(--race-primary, #60a5fa)',
        opacity: '0.85',
        fontStyle: 'italic',
        pointerEvents: 'none',
        animation: 'cm-live-value-in 0.3s ease-out',
      },
      '@keyframes cm-live-value-in': {
        from: { opacity: '0' },
        to: { opacity: '0.85' },
      },
    }),
  ];
}
