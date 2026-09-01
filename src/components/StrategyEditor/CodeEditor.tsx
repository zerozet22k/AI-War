import { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import { oneDark } from '@codemirror/theme-one-dark';
import { compile } from '../../game/ai/script/compiler';
import { liveValuesExtension, setLiveValues } from './liveValuesExtension';
import './CodeEditor.css';

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  /** When this changes to a non-null string, it's inserted at the current
   * cursor position (used by the map-click position-assist button) — then
   * the caller should clear it back to null via onInsertHandled. */
  insertAtCursor?: string | null;
  onInsertHandled?: () => void;
  /** Current values of the running script's top-level variables (see
   * ScriptEngine.variables()) — when given, every `let` declaration in the
   * editor is annotated inline with its live value. */
  liveValues?: Record<string, unknown>;
}

/** Feeds our own compiler's errors back into CodeMirror as diagnostics —
 * this is real feedback from the same compile step ScriptEngine uses, not a
 * generic JS linter (our language isn't JS; @codemirror/lang-javascript is
 * only used here for its tokenizer/highlighting, which is a close enough
 * approximation for a C/JS-like grammar). */
const scriptLinter = linter((view) => {
  const diagnostics: Diagnostic[] = [];
  const result = compile(view.state.doc.toString());
  const lineCount = view.state.doc.lines;

  for (const err of result.errors) {
    const lineNumber = Math.min(Math.max(err.line, 1), lineCount);
    const line = view.state.doc.line(lineNumber);
    const from = Math.min(line.from + Math.max(err.col - 1, 0), line.to);
    diagnostics.push({ from, to: Math.min(from + 1, line.to), severity: 'error', message: err.message });
  }

  return diagnostics;
});

export function CodeEditor({ value, onChange, readOnly = false, insertAtCursor, onInsertHandled, liveValues }: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!hostRef.current) return;

    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        javascript(),
        oneDark,
        scriptLinter,
        lintGutter(),
        liveValuesExtension(),
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString());
        }),
        EditorView.theme({
          // Transparent, not oneDark's opaque default — the editor sits on
          // the code panel's own translucent background (see AiCodePanel.css)
          // so a live match stays visible behind it while you're editing.
          '&': { height: '100%', fontSize: '13px', backgroundColor: 'transparent' },
          '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
          '.cm-gutters': { backgroundColor: 'transparent', border: 'none' },
          '.cm-activeLine': { backgroundColor: 'rgba(255, 255, 255, 0.06)' },
          '.cm-activeLineGutter': { backgroundColor: 'transparent' },
        }),
      ],
    });

    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Created once per mount; `readOnly` is fixed for a given panel instance
    // (Your Code vs. Enemy Code are always separate CodeEditor elements), and
    // later external value changes (e.g. "Load Example") are synced by the
    // effect below instead of recreating the whole editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync value changes that come from outside the editor (buttons, not
  // typing) without disturbing the user's cursor position while they type.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  // Push the latest live values into the editor as they arrive — this is
  // display-only, so it deliberately doesn't touch the document or the
  // user's cursor/selection the way an edit would.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !liveValues) return;
    view.dispatch({ effects: setLiveValues.of(liveValues) });
  }, [liveValues]);

  // Insert text at the current cursor position (map-click position assist).
  useEffect(() => {
    const view = viewRef.current;
    if (!view || insertAtCursor == null) return;
    const pos = view.state.selection.main.head;
    view.dispatch({ changes: { from: pos, insert: insertAtCursor }, selection: { anchor: pos + insertAtCursor.length } });
    view.focus();
    onInsertHandled?.();
  }, [insertAtCursor, onInsertHandled]);

  return <div className="code-editor" ref={hostRef} />;
}
