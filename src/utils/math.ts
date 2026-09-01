import type { Vector2 } from '../types/game';

export function distance(a: Vector2, b: Vector2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function moveToward(from: Vector2, to: Vector2, maxDist: number): Vector2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= maxDist || dist === 0) {
    return { x: to.x, y: to.y };
  }
  const ratio = maxDist / dist;
  return { x: from.x + dx * ratio, y: from.y + dy * ratio };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function randomInRect(width: number, height: number, margin = 40): Vector2 {
  return {
    x: margin + Math.random() * (width - margin * 2),
    y: margin + Math.random() * (height - margin * 2),
  };
}
