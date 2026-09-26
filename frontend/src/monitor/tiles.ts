import type { CamTile } from '../api/types';

/** Slots whose window went from live to lost between two views (each edge hisses once on Security). */
export function lostEdges(prev: readonly CamTile[], next: readonly CamTile[]): number[] {
  const live = new Set(prev.filter((tile) => tile.status === 'live').map((tile) => tile.slot));
  return next.filter((tile) => tile.status === 'lost' && live.has(tile.slot)).map((tile) => tile.slot);
}

/** m:ss of the time left, rounded up so the clock shows 0:00 only once time is up. */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
