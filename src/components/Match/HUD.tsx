import { useAppStore } from '../../state/store';
import type { PlayerId } from '../../types/game';
import { FullscreenButton } from '../shared/FullscreenButton';
import './HUD.css';

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, '0')}`;
}

export interface HUDProps {
  networked?: boolean;
  /** Opens the Esc pause overlay (Restart / Main Menu / Leave Match live
   * there now, not as always-visible buttons — see MatchScreen.tsx). */
  onOpenPause?: () => void;
  viewSide?: PlayerId;
}

export function HUD({ networked = false, onOpenPause, viewSide = 'player' }: HUDProps) {
  const hud = useAppStore((s) => s.hud);
  const isPaused = useAppStore((s) => s.isPaused);
  const togglePause = useAppStore((s) => s.togglePause);
  const simSpeed = useAppStore((s) => s.simSpeed);
  const setSimSpeed = useAppStore((s) => s.setSimSpeed);

  const ended = hud.matchPhase === 'ended';
  const opponents = hud.activePlayers.filter((owner) => owner !== viewSide);
  const opponentUnits = opponents.reduce((sum, owner) => sum + hud.unitCounts[owner], 0);
  const opponentResources = opponents.reduce((sum, owner) => sum + hud.resources[owner], 0);

  return (
    <div className="hud-wrap">
      <div className="hud">
        <div className="hud__side hud__side--player">
          <span className="hud__owner-dot hud__owner-dot--player" />
          <span className="hud__resources">{Math.floor(hud.resources[viewSide])}</span>
          <span className="hud__label">resources</span>
          <span className="hud__divider" />
          <span className="hud__resources">{hud.unitCounts[viewSide]}</span>
          <span className="hud__label">units</span>
        </div>

        <div className="hud__center">
          <span className="hud__match-time">{formatDuration(hud.matchDuration)}</span>
        </div>

        <div className="hud__side hud__side--enemy">
          <span className="hud__label">units</span>
          <span className="hud__resources">{opponentUnits}</span>
          <span className="hud__divider" />
          <span className="hud__label">resources</span>
          <span className="hud__resources">{Math.floor(opponentResources)}</span>
          <span className="hud__owner-dot hud__owner-dot--enemy" />
        </div>

        <div className="hud-toolbar__group">
          <FullscreenButton />
          {!networked && (
            <button
              className="hud-toolbar__btn"
              onClick={togglePause}
              disabled={ended}
              title={isPaused ? 'Resume simulation' : 'Pause simulation'}
            >
              {isPaused ? '▶' : '⏸'}
            </button>
          )}
          {!networked && (
            <div className="hud-toolbar__speeds" role="group" aria-label="Simulation speed">
              {[1, 2, 4].map((speed) => (
                <button
                  key={speed}
                  className={`hud-toolbar__speed ${simSpeed === speed ? 'hud-toolbar__speed--active' : ''}`}
                  onClick={() => setSimSpeed(speed)}
                  disabled={ended}
                >
                  {speed}x
                </button>
              ))}
            </div>
          )}
          <button className="hud-toolbar__btn hud-toolbar__btn--icon" onClick={onOpenPause} title="Menu (Esc)">
            ☰
          </button>
        </div>
      </div>
    </div>
  );
}
