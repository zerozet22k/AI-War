import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { PhaserGame } from '../../game/phaser/PhaserGame';
import { MatchController } from '../../game/matchController';
import { createOpponentStrategy } from '../../game/ai/strategies';
import { PLAYER_ID_LIST, type PlayerId } from '../../types/game';
import type { StrategyConfig } from '../../types/rules';
import { useAppStore } from '../../state/store';
import { useMultiplayerStore } from '../../net/multiplayerStore';
import { findKeyForAction, formatKeyCode } from '../../state/keybindScript';
import { HUD } from './HUD';
import { Terminal } from './Terminal';
import { SelectedEntityPanel } from './SelectedEntityPanel';
import { Button } from '../shared/Button';
import { gameAudio } from '../../game/audio/GameAudio';
import { raceThemeStyle } from '../../game/raceVisuals';
import { captureSave } from '../../game/saveGame';
import './MatchScreen.css';

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, '0')}`;
}

export function MatchScreen() {
  const playerStrategy = useAppStore((s) => s.playerStrategy);
  const matchStartToken = useAppStore((s) => s.matchStartToken);
  const hud = useAppStore((s) => s.hud);
  const goTo = useAppStore((s) => s.goTo);
  const keybinds = useAppStore((s) => s.keybinds);
  const selectedEntities = useAppStore((s) => s.selectedEntitySnapshots);
  const localMatchSetup = useAppStore((s) => s.localMatchSetup);
  const pendingLoadedSave = useAppStore((s) => s.pendingLoadedSave);

  const mpController = useMultiplayerStore((s) => s.controller);
  const mpSide = useMultiplayerStore((s) => s.side);
  const mpMapId = useMultiplayerStore((s) => s.mapId);
  const mpDisconnectedPlayers = useMultiplayerStore((s) => s.disconnectedPlayers);
  const leaveMatch = useMultiplayerStore((s) => s.leaveMatch);

  const isNetworked = mpController !== null;
  const mySide = isNetworked ? (mpSide ?? 'player') : 'player';

  // Local single-player: own and step a real MatchController, recreated
  // whenever a fresh match starts. Ignored when networked (mpController wins).
  // Up to 3 AI-controlled opponent slots (enemy, player3, player4), each
  // with its own race/difficulty/team/color chosen in the lobby.
  const activeOpponentSlots = PLAYER_ID_LIST.slice(1, 1 + localMatchSetup.activeOpponentCount);
  const localOpponentStrategies = useMemo(
    () => Object.fromEntries(activeOpponentSlots.map((slot, i) => {
      const o = localMatchSetup.opponents[i];
      return [slot, createOpponentStrategy(`${o.aiDifficulty} ${o.race} AI`, o.aiDifficulty, o.race)];
    })) as Partial<Record<PlayerId, StrategyConfig>>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [matchStartToken, localMatchSetup.activeOpponentCount, ...localMatchSetup.opponents.flatMap((o) => [o.race, o.aiDifficulty])],
  );
  const localController = useMemo(() => {
    // A save picked from the Load Game screen resumes that exact match
    // instead of building a fresh one from the lobby's current setup —
    // see saveGame.ts. Cleared by startNewMatch(), so a later "Play with
    // AI" click falls straight back to the normal fresh path below.
    if (pendingLoadedSave) {
      const save = pendingLoadedSave;
      return new MatchController({
        playerStrategy: save.strategies.player!,
        enemyStrategy: save.strategies.enemy ?? save.strategies.player!,
        strategies: save.strategies,
        activePlayers: save.activePlayers,
        races: save.races,
        lobby: save.lobby,
        mapId: save.mapId,
        aiDifficulty: save.aiDifficulty ?? undefined,
        recordHistoryForPlayer: true,
        resume: { simState: save.simState, phase: save.phase, activityLog: save.activityLog },
      });
    }
    return new MatchController({
      playerStrategy,
      enemyStrategy: localOpponentStrategies.enemy!,
      strategies: localOpponentStrategies,
      activePlayers: ['player', ...activeOpponentSlots],
      races: {
        player: localMatchSetup.playerRace,
        ...Object.fromEntries(activeOpponentSlots.map((slot, i) => [slot, localMatchSetup.opponents[i].race])),
      },
      lobby: {
        player: { team: localMatchSetup.playerTeam, color: localMatchSetup.playerColor },
        ...Object.fromEntries(activeOpponentSlots.map((slot, i) => [slot, { team: localMatchSetup.opponents[i].team, color: localMatchSetup.opponents[i].color }])),
      },
      mapId: localMatchSetup.mapId,
      aiDifficulty: localMatchSetup.opponents[0].aiDifficulty,
      recordHistoryForPlayer: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchStartToken, pendingLoadedSave, localOpponentStrategies, localMatchSetup.playerRace, localMatchSetup.playerTeam, localMatchSetup.playerColor, localMatchSetup.mapId]);

  const controller = mpController ?? localController;
  // The command center is always present from turn one, so it reliably tells
  // us which race mySide is playing in both local and networked matches —
  // no separate "my race" state to keep in sync with the sim.
  const myRace = useMemo(
    () => controller.sim.getBuildings(mySide)[0]?.race ?? localMatchSetup.playerRace,
    [controller, mySide, localMatchSetup.playerRace],
  );
  const themeStyle = useMemo(() => raceThemeStyle(myRace), [myRace]);

  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  // The game view fills the whole screen; the code editor is a toggled
  // overlay on top of it rather than a permanently-docked panel.
  const [codeOpen, setCodeOpen] = useState(false);
  // Esc always opens this — Restart / Main Menu / Leave Match live here now,
  // not as always-visible buttons. Hardcoded below, not routed through the
  // keybind script, so it can't be rebound away from this purpose.
  const [pauseOpen, setPauseOpen] = useState(false);
  const [audioMuted, setAudioMuted] = useState(() => gameAudio.isMuted());

  // Global keybind handling. `keybinds` maps a normalized KeyboardEvent.code
  // to either a reserved UI action ('toggle_settings', 'toggle_strategy_editor')
  // or, for anything else, the name of a function in your own AI script —
  // pressing that key calls it immediately via MatchController.triggerFunction(),
  // live, any time during the match (see state/keybindScript.ts).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === 'Escape') {
        if (codeOpen) {
          setCodeOpen(false);
          return;
        }
        const active = document.activeElement;
        if (active?.closest('.cm-editor, input, textarea')) return;
        setPauseOpen((v) => !v);
        return;
      }
      const active = document.activeElement;
      if (active?.closest('.cm-editor, input, textarea')) return; // typing in the code editor shouldn't fire keybinds

      // Pause/speed controls are hardcoded (like Escape above), not routed
      // through the rebindable keybind script — they mirror the HUD's own
      // buttons, which are likewise hidden for networked matches (a stopped
      // match ignores pause/speed regardless, so no "match ended" guard needed).
      if (!isNetworked) {
        if (e.code === 'Space') {
          e.preventDefault(); // Space also "clicks" the last-focused HUD button by default
          useAppStore.getState().togglePause();
          return;
        }
        if (e.code === 'Digit1') {
          useAppStore.getState().setSimSpeed(1);
          return;
        }
        if (e.code === 'Digit2') {
          useAppStore.getState().setSimSpeed(2);
          return;
        }
        if (e.code === 'Digit3' || e.code === 'Digit4') {
          useAppStore.getState().setSimSpeed(4);
          return;
        }
      }

      const boundAction = keybinds[e.code];
      if (!boundAction) return;
      if (boundAction === 'toggle_settings') {
        if (isNetworked) return;
        goTo('settings');
        return;
      }
      if (boundAction === 'toggle_strategy_editor') {
        setCodeOpen((v) => !v);
        return;
      }
      const result = controller.triggerFunction(mySide, boundAction);
      setToast(result.message);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keybinds, isNetworked, controller, mySide, codeOpen]);

  const ended = hud.matchPhase === 'ended' || hud.matchResult;
  const won = hud.matchResult?.winners.includes(mySide) ?? false;
  const draw = hud.matchResult ? hud.matchResult.winners.length === 0 : false;
  const codeKey = findKeyForAction(keybinds, 'toggle_strategy_editor');
  const codeKeyHint = codeKey ? formatKeyCode(codeKey) : null;
  // "Restart" re-runs the lobby's current setup from scratch — meaningless
  // for a resumed save (there's no fresh seed to restart from, only the
  // save itself, which is what Load Game is for), so it's hidden then.
  const isLoadedMatch = !isNetworked && pendingLoadedSave !== null;

  function exitToMenu() {
    if (isNetworked) leaveMatch();
    useAppStore.getState().setPendingLoadedSave(null);
    goTo('menu');
  }

  function restartLocalMatch() {
    setPauseOpen(false);
    setCodeOpen(false);
    setToast(null);
    useAppStore.getState().startNewMatch();
  }

  const [saveOpen, setSaveOpen] = useState(false);
  const [saveLabel, setSaveLabel] = useState('');

  function confirmSave() {
    const label = saveLabel.trim() || `Save — ${new Date().toLocaleString()}`;
    captureSave(controller, {
      mapId: isNetworked ? (mpMapId ?? localMatchSetup.mapId) : localMatchSetup.mapId,
      aiDifficulty: isNetworked ? null : (pendingLoadedSave?.aiDifficulty ?? localMatchSetup.opponents[0]?.aiDifficulty ?? null),
      networked: isNetworked,
      label,
    });
    setSaveOpen(false);
    setSaveLabel('');
    setToast('Game saved.');
  }

  return (
    <div className="match-screen" style={themeStyle as CSSProperties}>
      <HUD networked={isNetworked} viewSide={mySide} onOpenPause={() => setPauseOpen((v) => !v)} />
      <div
        className="match-screen__stage"
        // Right-click drags the camera (see MainScene). Phaser only
        // suppresses the browser's own context menu while the pointer is
        // exactly over the canvas — a fast right-drag can end the gesture
        // over one of the DOM buttons overlaid on this stage (audio/terminal
        // toggle, HUD), where that canvas-scoped suppression doesn't reach.
        onContextMenu={(e) => e.preventDefault()}
      >
        <PhaserGame key={isNetworked ? 'mp' : matchStartToken} controller={controller} viewSide={mySide} />
        <div className="match-screen__camera-help">WASD / arrows: pan · Right-drag: pan · Wheel: zoom</div>
        <button
          className="match-screen__audio-toggle"
          onClick={() => setAudioMuted(gameAudio.toggleMuted())}
          title={audioMuted ? 'Enable game sounds' : 'Mute game sounds'}
          aria-label={audioMuted ? 'Enable game sounds' : 'Mute game sounds'}
        >
          {audioMuted ? '🔇' : '🔊'}
        </button>

        {!codeOpen && !ended && (
          <button
            className="match-screen__code-toggle"
            onClick={() => setCodeOpen(true)}
            title={`Open the AI terminal${codeKeyHint ? ` (${codeKeyHint})` : ''}`}
          >
            {'>_ Terminal'}
          </button>
        )}

        {selectedEntities.length > 0 && !ended && (
          <div className="match-screen__selected-panel">
            <SelectedEntityPanel mySide={mySide} />
          </div>
        )}

        {isNetworked && mpDisconnectedPlayers.length > 0 && !ended && (
          <div className="match-screen__toast match-screen__toast--warning">A commander disconnected; their AI is still running.</div>
        )}

        {toast && !ended && <div className="match-screen__toast">{toast}</div>}

        {pauseOpen && !ended && (
          <div className="match-screen__end-overlay" onMouseDown={(e) => e.target === e.currentTarget && setPauseOpen(false)}>
            <div className="match-screen__end-panel">
              <h2>Paused</h2>
              {saveOpen ? (
                <div className="match-screen__save-form">
                  <input
                    className="match-screen__save-input"
                    value={saveLabel}
                    onChange={(e) => setSaveLabel(e.target.value)}
                    placeholder={`Save — ${new Date().toLocaleString()}`}
                    aria-label="Save name"
                    autoFocus
                  />
                  <div className="match-screen__end-actions">
                    <Button variant="primary" onClick={confirmSave}>Confirm Save</Button>
                    <Button variant="ghost" onClick={() => setSaveOpen(false)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="match-screen__end-actions">
                  <Button variant="primary" onClick={() => setPauseOpen(false)}>
                    Resume
                  </Button>
                  <Button variant="secondary" onClick={() => setSaveOpen(true)}>
                    💾 Save Game
                  </Button>
                  {isNetworked ? (
                    <Button variant="secondary" onClick={exitToMenu}>
                      Leave Match
                    </Button>
                  ) : (
                    <>
                      {!isLoadedMatch && (
                        <Button variant="secondary" onClick={restartLocalMatch}>
                          ⟳ Restart
                        </Button>
                      )}
                      <Button variant="secondary" onClick={() => goTo('settings')}>
                        Settings
                      </Button>
                      <Button variant="ghost" onClick={exitToMenu}>
                        Main Menu
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {ended && hud.matchResult && (
          <div className="match-screen__end-overlay">
            <div className="match-screen__end-panel">
              <h2>{draw ? 'Match Over' : won ? 'Victory!' : 'Defeat'}</h2>
              <p>{hud.matchResult.reason}</p>

              <div className="match-screen__end-stats">
                <div className="match-screen__stat">
                  <span className="match-screen__stat-label">Match Duration</span>
                  <span className="match-screen__stat-value">{formatDuration(hud.matchDuration)}</span>
                </div>
                <div className="match-screen__stat">
                  <span className="match-screen__stat-label">Units Created</span>
                  <span className="match-screen__stat-value">{hud.stats[mySide].unitsCreated}</span>
                </div>
                <div className="match-screen__stat">
                  <span className="match-screen__stat-label">Units Lost</span>
                  <span className="match-screen__stat-value">{hud.stats[mySide].unitsLost}</span>
                </div>
                <div className="match-screen__stat">
                  <span className="match-screen__stat-label">Buildings Constructed</span>
                  <span className="match-screen__stat-value">{hud.stats[mySide].buildingsConstructed}</span>
                </div>
                <div className="match-screen__stat">
                  <span className="match-screen__stat-label">Resources Gathered</span>
                  <span className="match-screen__stat-value">{hud.stats[mySide].resourcesGathered}</span>
                </div>
              </div>

              <div className="match-screen__end-actions">
                {isNetworked ? (
                  <Button variant="primary" onClick={exitToMenu}>
                    Leave Match
                  </Button>
                ) : (
                  <>
                    <Button variant="primary" onClick={restartLocalMatch}>
                      Restart
                    </Button>
                    <Button variant="secondary" onClick={() => goTo('strategyEditor')}>
                      Edit Strategy
                    </Button>
                    <Button variant="ghost" onClick={exitToMenu}>
                      Main Menu
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <Terminal controller={controller} mySide={mySide} syncToLocalStrategy={!isNetworked} open={codeOpen} onClose={() => setCodeOpen(false)} />
    </div>
  );
}
