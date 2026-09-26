import { useEffect, useRef, useSyncExternalStore } from 'react';
import { makeStars, starX } from './stars';

const STARS = makeStars();
const FRAME_MS = 40;
const REDUCE_MOTION = '(prefers-reduced-motion: reduce)';

function subscribeMotion(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCE_MOTION);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

const prefersReducedMotion = () => window.matchMedia(REDUCE_MOTION).matches;

/**
 * Full-bleed canvas of about 500 square stars drifting left, nearer (bigger) ones faster.
 * Drawn once and kept still with `lowMotion` or when the OS asks for reduced motion.
 */
export function Starfield({ lowMotion = false }: { lowMotion?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduced = useSyncExternalStore(subscribeMotion, prefersReducedMotion, () => false);
  const still = lowMotion || reduced;

  useEffect(() => {
    const canvas = ref.current;
    const g = canvas?.getContext('2d', { alpha: false });
    if (!canvas || !g) return;
    const space = getComputedStyle(canvas).getPropertyValue('--c-space').trim() || '#05060d';
    const born = performance.now();
    let width = 0;
    let height = 0;
    let scale = 1;
    let frame = 0;
    let drawnAt = -Infinity;

    const draw = (now: number) => {
      const t = still ? 0 : (now - born) / 1000;
      g.globalAlpha = 1;
      g.fillStyle = space;
      g.fillRect(0, 0, canvas.width, canvas.height);
      g.fillStyle = '#ffffff';
      for (const star of STARS) {
        const side = star.size * scale;
        g.globalAlpha = star.alpha;
        g.fillRect(Math.round(starX(star, width, t) * scale), Math.round(star.y * height * scale), side, side);
      }
      drawnAt = now;
    };
    const resize = () => {
      scale = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      draw(performance.now());
    };
    const tick = (now: number) => {
      if (now - drawnAt >= FRAME_MS) draw(now);
      frame = requestAnimationFrame(tick);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    if (!still) frame = requestAnimationFrame(tick);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [still]);

  return <canvas ref={ref} className="starfield" aria-hidden="true" />;
}
