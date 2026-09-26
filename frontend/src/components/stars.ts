export interface Star {
  /** Start position as a fraction of the canvas width and height. */
  x: number;
  y: number;
  /** Side of the square in CSS px; bigger stars are nearer, so they drift faster. */
  size: 1 | 2 | 3 | 4;
  alpha: number;
  /** Leftward drift in CSS px per second. */
  speed: number;
}

const ALPHA: Record<Star['size'], readonly [number, number]> = {
  1: [0.25, 0.55],
  2: [0.3, 0.65],
  3: [0.45, 0.8],
  4: [0.7, 1],
};

/** A fixed sky from the mock-ups' Park–Miller generator, so every screen shows the same stars. */
export function makeStars(count = 500, seed = 42): Star[] {
  let state = seed;
  const next = () => (state = (state * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: count }, (): Star => {
    const roll = next();
    const size = roll < 0.5 ? 1 : roll < 0.82 ? 2 : roll < 0.95 ? 3 : 4;
    const [lo, hi] = ALPHA[size];
    return { x: next(), y: next(), size, alpha: lo + next() * (hi - lo), speed: size * (3 + size / 2) };
  });
}

/** The star's x in px after `t` seconds of drift, wrapped onto a canvas `width` px wide. */
export function starX(star: Star, width: number, t: number): number {
  const x = (star.x * width - star.speed * t) % width;
  return x < 0 ? x + width : x;
}
