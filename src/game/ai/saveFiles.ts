import type { RaceId } from '../../types/game';
import { loadJSON, saveJSON } from '../../utils/storage';

const SAVE_FILES_STORAGE_KEY = 'ai-war.saveFiles.v1';

export interface SaveFile {
  name: string;
  code: string;
  updatedAt: number;
}

type SaveFilesByRace = Partial<Record<RaceId, SaveFile[]>>;

/** A save's `name` is its identity within a race, the same way a filename
 * is within a directory — case-insensitive, and any trailing ".txt" a
 * caller typed is stripped so "aggro" and "aggro.txt" are the same file. */
function normalizeName(name: string): string {
  return name.trim().replace(/\.txt$/i, '');
}

function loadAll(): SaveFilesByRace {
  return loadJSON<SaveFilesByRace>(SAVE_FILES_STORAGE_KEY) ?? {};
}

function saveAll(all: SaveFilesByRace): void {
  saveJSON(SAVE_FILES_STORAGE_KEY, all);
}

/** All of a race's saved files, alphabetical by name. */
export function listSaveFiles(race: RaceId): SaveFile[] {
  const files = loadAll()[race] ?? [];
  return [...files].sort((a, b) => a.name.localeCompare(b.name));
}

export function readSaveFile(race: RaceId, name: string): SaveFile | null {
  const target = normalizeName(name).toLowerCase();
  return (loadAll()[race] ?? []).find((f) => f.name.toLowerCase() === target) ?? null;
}

/** Creates the file if it doesn't exist for this race, otherwise overwrites it in place. */
export function writeSaveFile(race: RaceId, name: string, code: string): SaveFile {
  const cleanName = normalizeName(name);
  const all = loadAll();
  const files = all[race] ?? [];
  const file: SaveFile = { name: cleanName, code, updatedAt: Date.now() };
  const index = files.findIndex((f) => f.name.toLowerCase() === cleanName.toLowerCase());
  const next = index === -1 ? [...files, file] : files.map((f, i) => (i === index ? file : f));
  saveAll({ ...all, [race]: next });
  return file;
}

export function deleteSaveFile(race: RaceId, name: string): boolean {
  const target = normalizeName(name).toLowerCase();
  const all = loadAll();
  const files = all[race] ?? [];
  const next = files.filter((f) => f.name.toLowerCase() !== target);
  if (next.length === files.length) return false;
  saveAll({ ...all, [race]: next });
  return true;
}

/** Fails (returns false) rather than clobbering if `newName` is already taken. */
export function renameSaveFile(race: RaceId, oldName: string, newName: string): boolean {
  const from = normalizeName(oldName).toLowerCase();
  const to = normalizeName(newName);
  const all = loadAll();
  const files = all[race] ?? [];
  if (files.some((f) => f.name.toLowerCase() === to.toLowerCase())) return false;
  const index = files.findIndex((f) => f.name.toLowerCase() === from);
  if (index === -1) return false;
  const next = files.map((f, i) => (i === index ? { ...f, name: to, updatedAt: Date.now() } : f));
  saveAll({ ...all, [race]: next });
  return true;
}
