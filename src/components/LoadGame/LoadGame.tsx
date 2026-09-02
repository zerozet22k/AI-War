import { useState } from 'react';
import { useAppStore } from '../../state/store';
import { deleteSave, listSaves, loadSave, type SaveSlotMeta } from '../../game/saveGame';
import { RACES } from '../../game/races';
import { MAPS } from '../../game/maps';
import { Button } from '../shared/Button';
import './LoadGame.css';

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, '0')}`;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString();
}

export function LoadGame() {
  const goTo = useAppStore((s) => s.goTo);
  const loadSavedMatch = useAppStore((s) => s.loadSavedMatch);
  const setPendingLoadedSave = useAppStore((s) => s.setPendingLoadedSave);
  const [saves, setSaves] = useState<SaveSlotMeta[]>(() => listSaves());

  function resumeSolo(meta: SaveSlotMeta) {
    const data = loadSave(meta.id);
    if (!data) return;
    loadSavedMatch(data);
  }

  function hostAsMultiplayer(meta: SaveSlotMeta) {
    const data = loadSave(meta.id);
    if (!data) return;
    setPendingLoadedSave(data);
    goTo('multiplayerLobby');
  }

  function remove(id: string) {
    if (!window.confirm('Delete this save? This cannot be undone.')) return;
    deleteSave(id);
    setSaves(listSaves());
  }

  return (
    <div className="load-game">
      <div className="load-game__panel">
        <header className="load-game__header">
          <h1>Load Game</h1>
          <Button variant="ghost" onClick={() => goTo('menu')}>← Back to Menu</Button>
        </header>

        {saves.length === 0 ? (
          <p className="load-game__empty">No saved games yet — save one from the pause menu during a match.</p>
        ) : (
          <div className="load-game__list">
            {saves.map((save) => (
              <div className="load-game__row" key={save.id}>
                <div className="load-game__info">
                  <strong>{save.label}</strong>
                  <span className="load-game__meta">
                    {RACES[save.playerRace].name} · {MAPS[save.mapId].name} · {formatDuration(save.matchDuration)} played
                    {save.networked ? ' · captured from a networked match' : ''}
                  </span>
                  <span className="load-game__date">{formatDate(save.savedAt)}</span>
                </div>
                <div className="load-game__row-actions">
                  <Button variant="primary" onClick={() => resumeSolo(save)}>▶ Resume (Solo)</Button>
                  <Button variant="secondary" onClick={() => hostAsMultiplayer(save)}>🌐 Host as Multiplayer</Button>
                  <Button variant="ghost" onClick={() => remove(save.id)}>✕ Delete</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
