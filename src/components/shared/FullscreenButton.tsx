import { useEffect, useState } from 'react';

export function FullscreenButton() {
  const [fullscreen, setFullscreen] = useState(() => document.fullscreenElement !== null);

  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);

  if (!document.fullscreenEnabled) return null;

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    } catch {
      // Browsers may reject fullscreen when another modal or browser UI owns
      // focus. The next direct click can try again safely.
    }
  }

  return (
    <button
      type="button"
      className="fullscreen-button"
      onClick={toggleFullscreen}
      aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
      title={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
    >
      {fullscreen ? '⤢ Exit Fullscreen' : '⛶ Fullscreen'}
    </button>
  );
}
