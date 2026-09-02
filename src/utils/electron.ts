// Present only inside the packaged desktop app (see electron/preload.cjs) —
// undefined for the plain web build, where there's no OS process to quit.
declare global {
  interface Window {
    electronApp?: { exit: () => void };
  }
}

export function isElectronApp(): boolean {
  return typeof window !== 'undefined' && window.electronApp !== undefined;
}

export function exitGame(): void {
  window.electronApp?.exit();
}
