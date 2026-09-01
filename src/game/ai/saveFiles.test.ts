import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteSaveFile, listSaveFiles, readSaveFile, renameSaveFile, writeSaveFile } from './saveFiles';

function installFakeLocalStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  });
}

describe('saveFiles', () => {
  beforeEach(() => installFakeLocalStorage());

  it('starts empty for a race with no saves', () => {
    expect(listSaveFiles('ironclad')).toEqual([]);
    expect(readSaveFile('ironclad', 'anything')).toBeNull();
  });

  it('writes and reads a file back by name', () => {
    writeSaveFile('ironclad', 'aggro', 'let x = 1;');
    const file = readSaveFile('ironclad', 'aggro');
    expect(file?.code).toBe('let x = 1;');
  });

  it('treats "name" and "name.txt" as the same file, case-insensitively', () => {
    writeSaveFile('ironclad', 'Aggro', 'v1');
    writeSaveFile('ironclad', 'aggro.txt', 'v2');
    expect(listSaveFiles('ironclad')).toHaveLength(1);
    expect(readSaveFile('ironclad', 'AGGRO')?.code).toBe('v2');
  });

  it('keeps different races\' files independent', () => {
    writeSaveFile('ironclad', 'build', 'ironclad code');
    writeSaveFile('aether', 'build', 'aether code');
    expect(readSaveFile('ironclad', 'build')?.code).toBe('ironclad code');
    expect(readSaveFile('aether', 'build')?.code).toBe('aether code');
  });

  it('deletes a file', () => {
    writeSaveFile('ironclad', 'temp', 'x');
    expect(deleteSaveFile('ironclad', 'temp')).toBe(true);
    expect(readSaveFile('ironclad', 'temp')).toBeNull();
    expect(deleteSaveFile('ironclad', 'temp')).toBe(false);
  });

  it('renames a file, refusing to clobber an existing name', () => {
    writeSaveFile('ironclad', 'a', '1');
    writeSaveFile('ironclad', 'b', '2');
    expect(renameSaveFile('ironclad', 'a', 'c')).toBe(true);
    expect(readSaveFile('ironclad', 'c')?.code).toBe('1');
    expect(readSaveFile('ironclad', 'a')).toBeNull();
    expect(renameSaveFile('ironclad', 'b', 'c')).toBe(false);
  });
});
