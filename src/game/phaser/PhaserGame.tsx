import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { MainScene } from './MainScene';
import { VIEW_HEIGHT, VIEW_WIDTH } from '../constants';
import type { MatchView } from '../matchView';
import type { PlayerId } from '../../types/game';

export interface PhaserGameProps {
  controller: MatchView;
  viewSide: PlayerId;
}

/** Mounts a Phaser 3 canvas rendering the given MatchView — a local
 * MatchController (which the caller also steps via this same instance) or a
 * networked RemoteMatchController (snapshot-driven, update() is a no-op).
 * The caller owns constructing/stepping the controller; this component only
 * renders it. */
export function PhaserGame({ controller, viewSide }: PhaserGameProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;

    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: hostRef.current,
      backgroundColor: '#141b24',
      scene: [],
      render: { antialias: true },
      // Right-click drags the camera (see MainScene's pointermove handler) —
      // without this, every right-click also popped up the browser's own
      // context menu on top of the game, killing the drag gesture.
      disableContextMenu: true,
      // RESIZE mode fills whatever size the host div actually is — the game
      // view is a fullscreen stage now, not a fixed letterboxed canvas, so
      // it should grow/shrink with the browser window and the code overlay.
      scale: {
        mode: Phaser.Scale.RESIZE,
        width: VIEW_WIDTH,
        height: VIEW_HEIGHT,
      },
    });
    game.scene.add('main', MainScene, true, { controller, viewSide });
    gameRef.current = game;

    // Phaser's own RESIZE-mode detection can miss layout changes that
    // aren't accompanied by a window 'resize' event (e.g. a flex sibling
    // appearing/disappearing) — watch the host div directly so the canvas
    // never gets stuck at a stale size.
    const resizeObserver = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box && box.width > 0 && box.height > 0) game.scale.resize(box.width, box.height);
    });
    resizeObserver.observe(hostRef.current);

    return () => {
      resizeObserver.disconnect();
      game.destroy(true);
      gameRef.current = null;
    };
    // Intentionally run once per mount — a fresh match gets a fresh <PhaserGame key=.../>.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="phaser-host" ref={hostRef} />;
}
