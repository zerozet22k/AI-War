import { useMemo } from 'react';
import { useAppStore } from '../../state/store';
import { compileKeybinds, formatKeyCode } from '../../state/keybindScript';
import { CodeEditor } from '../StrategyEditor/CodeEditor';
import { Button } from '../shared/Button';
import './KeybindEditor.css';

const RESERVED_ACTIONS = [
  { id: 'toggle_settings', label: 'Toggle this settings screen' },
  { id: 'toggle_strategy_editor', label: 'Toggle the AI code panel (in a match)' },
];

export function KeybindEditor({ onClose }: { onClose: () => void }) {
  const keybindScript = useAppStore((s) => s.keybindScript);
  const setKeybindScript = useAppStore((s) => s.setKeybindScript);
  const resetKeybindScript = useAppStore((s) => s.resetKeybindScript);
  const keybinds = useAppStore((s) => s.keybinds);
  const cameraSettings = useAppStore((s) => s.cameraSettings);
  const setCameraSettings = useAppStore((s) => s.setCameraSettings);
  const resetCameraSettings = useAppStore((s) => s.resetCameraSettings);

  const compileStatus = useMemo(() => compileKeybinds(keybindScript), [keybindScript]);

  return (
    <div className="keybind-editor">
      <header>
        <div>
          <h1>Settings</h1>
          <p className="keybind-editor__subtitle">
            Keybinds are code, same as your AI. Call <code>bind(key, action)</code> once per binding — a later call for the
            same key overwrites an earlier one.
          </p>
        </div>
        <Button variant="ghost" onClick={onClose}>
          ← Back
        </Button>
      </header>

      <section className="keybind-editor__camera">
        <div className="keybind-editor__camera-header">
          <h2>Camera &amp; Mouse</h2>
          <Button variant="ghost" onClick={resetCameraSettings}>
            Reset
          </Button>
        </div>
        <div className="keybind-editor__camera-row">
          <label htmlFor="camera-pan-speed">Pan speed</label>
          <input
            id="camera-pan-speed"
            type="range"
            min={0.25}
            max={3}
            step={0.05}
            value={cameraSettings.panSpeed}
            onChange={(e) => setCameraSettings({ panSpeed: Number(e.target.value) })}
          />
          <span className="keybind-editor__camera-value">{cameraSettings.panSpeed.toFixed(2)}x</span>
        </div>
        <p className="keybind-editor__hint">WASD/arrows, edge-of-screen panning, and right-click drag all scale with this.</p>
        <div className="keybind-editor__camera-row">
          <label htmlFor="camera-zoom-speed">Zoom speed</label>
          <input
            id="camera-zoom-speed"
            type="range"
            min={0.25}
            max={3}
            step={0.05}
            value={cameraSettings.zoomSpeed}
            onChange={(e) => setCameraSettings({ zoomSpeed: Number(e.target.value) })}
          />
          <span className="keybind-editor__camera-value">{cameraSettings.zoomSpeed.toFixed(2)}x</span>
        </div>
        <p className="keybind-editor__hint">How fast the scroll wheel zooms in/out.</p>
      </section>

      <h2 className="keybind-editor__section-title">Keybinds</h2>
      <div className="keybind-editor__toolbar">
        <Button variant="secondary" onClick={resetKeybindScript}>
          Reset to Defaults
        </Button>
        <span className={`keybind-editor__status keybind-editor__status--${compileStatus.errors.length > 0 ? 'error' : 'ok'}`}>
          {compileStatus.errors.length > 0 ? `✗ ${compileStatus.errors.length} error${compileStatus.errors.length > 1 ? 's' : ''}` : '✓ Compiles cleanly'}
        </span>
      </div>

      <div className="keybind-editor__body">
        <CodeEditor value={keybindScript} onChange={setKeybindScript} />

        <aside className="keybind-editor__reference">
          <div className="keybind-editor__reference-title">Reference</div>

          <div className="keybind-editor__reference-section">
            <div className="keybind-editor__reference-label">Key names</div>
            <p>"0"–"9", "a"–"z", "space", "enter", "tab" — "escape" isn't bindable, it always opens the pause menu</p>
          </div>

          <div className="keybind-editor__reference-section">
            <div className="keybind-editor__reference-label">Reserved UI actions</div>
            {RESERVED_ACTIONS.map((a) => (
              <div key={a.id} className="keybind-editor__action-row">
                <code>{a.id}</code>
                <span>{a.label}</span>
              </div>
            ))}
            <p className="keybind-editor__hint">
              Anything else is treated as the name of a function your own AI script defines — pressing that key calls it live.
            </p>
          </div>

          <div className="keybind-editor__reference-section">
            <div className="keybind-editor__reference-label">Currently bound</div>
            {Object.keys(keybinds).length === 0 && <p className="keybind-editor__empty">Nothing bound yet.</p>}
            {Object.entries(keybinds).map(([code, action]) => (
              <div key={code} className="keybind-editor__action-row">
                <code>{formatKeyCode(code)}</code>
                <span>{action}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
