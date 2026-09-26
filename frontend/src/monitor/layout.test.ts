import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { layoutFor, type Cell } from './layout';

/** The grid squares a cell covers, as "col,row" strings. */
function squares({ col, row }: Cell): string[] {
  const [c0, c1] = col.split(' / ').map(Number);
  const [r0, r1] = row.split(' / ').map(Number);
  const out: string[] = [];
  for (let c = c0; c < c1; c++) for (let r = r0; r < r1; r++) out.push(`${c},${r}`);
  return out;
}

describe('layoutFor', () => {
  it('matches the mock-up cells table', () => {
    assert.deepEqual(layoutFor(0), []);
    assert.deepEqual(layoutFor(1), [{ col: '1 / 5', row: '1 / 3' }]);
    assert.deepEqual(layoutFor(2), [
      { col: '1 / 3', row: '1 / 3' },
      { col: '3 / 5', row: '1 / 3' },
    ]);
    assert.deepEqual(layoutFor(3), [
      { col: '1 / 3', row: '1 / 2' },
      { col: '3 / 5', row: '1 / 2' },
      { col: '2 / 4', row: '2 / 3' },
    ]);
    assert.deepEqual(layoutFor(4), [
      { col: '1 / 3', row: '1 / 2' },
      { col: '3 / 5', row: '1 / 2' },
      { col: '1 / 3', row: '2 / 3' },
      { col: '3 / 5', row: '2 / 3' },
    ]);
  });

  it('gives each window its own part of the 4 × 2 grid', () => {
    for (const n of [1, 2, 3, 4] as const) {
      const cells = layoutFor(n);
      assert.equal(cells.length, n);
      const used = cells.flatMap(squares);
      assert.equal(new Set(used).size, used.length, `windows overlap for ${n}`);
      for (const sq of used) {
        const [c, r] = sq.split(',').map(Number);
        assert.ok(c >= 1 && c <= 4 && r >= 1 && r <= 2, `${sq} is outside the grid for ${n}`);
      }
    }
  });

  it('fills the whole screen for 1, 2 and 4 windows and centres the third below', () => {
    for (const n of [1, 2, 4] as const) assert.equal(layoutFor(n).flatMap(squares).length, 8);
    assert.deepEqual(squares(layoutFor(3)[2]), ['2,2', '3,2']);
  });

  it('gives every window the same size once there are two or more', () => {
    for (const n of [2, 3, 4] as const) {
      const sizes = layoutFor(n).map((cell) => squares(cell).length);
      assert.deepEqual(sizes, Array(n).fill(sizes[0]));
    }
  });
});
