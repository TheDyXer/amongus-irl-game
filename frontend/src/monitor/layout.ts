/** Window placement on the monitor's 4-column × 2-row grid (the `cells` table of design/mockups/Main.dc.html). */
export interface Cell {
  col: string;
  row: string;
}

const CELLS: Record<1 | 2 | 3 | 4, readonly (readonly [col: string, row: string])[]> = {
  1: [['1 / 5', '1 / 3']],
  2: [['1 / 3', '1 / 3'], ['3 / 5', '1 / 3']],
  3: [['1 / 3', '1 / 2'], ['3 / 5', '1 / 2'], ['2 / 4', '2 / 3']],
  4: [['1 / 3', '1 / 2'], ['3 / 5', '1 / 2'], ['1 / 3', '2 / 3'], ['3 / 5', '2 / 3']],
};

/** Cells for `n` windows: 1 full, 2 side by side, 3 two on top and one centred below, 4 as 2×2;
 * 0 has none (the housing shows NO SIGNAL). */
export function layoutFor(n: 0 | 1 | 2 | 3 | 4): Cell[] {
  return n === 0 ? [] : CELLS[n].map(([col, row]) => ({ col, row }));
}
