import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CamTile } from '../api/types';
import { formatClock, lostEdges } from './tiles';

const tile = (slot: number, status: CamTile['status']): CamTile => ({ slot, gen: 1, room: 'ADMIN', status });

describe('lostEdges', () => {
  it('reports the slots that went from live to lost', () => {
    const prev = [tile(1, 'live'), tile(2, 'live'), tile(3, 'lost')];
    const next = [tile(1, 'lost'), tile(2, 'live'), tile(3, 'lost')];
    assert.deepEqual(lostEdges(prev, next), [1]);
  });

  it('ignores windows that were already lost, new windows and closed windows', () => {
    assert.deepEqual(lostEdges([tile(1, 'lost')], [tile(1, 'lost')]), []);
    assert.deepEqual(lostEdges([], [tile(2, 'lost')]), []);
    assert.deepEqual(lostEdges([tile(3, 'live')], []), []);
  });

  it('reports every slot that dropped at once', () => {
    assert.deepEqual(lostEdges([tile(2, 'live'), tile(4, 'live')], [tile(2, 'lost'), tile(4, 'lost')]), [2, 4]);
  });
});

describe('formatClock', () => {
  it('shows minutes and zero-padded seconds, rounding up', () => {
    assert.equal(formatClock(84_000), '1:24');
    assert.equal(formatClock(600_000), '10:00');
    assert.equal(formatClock(9_001), '0:10');
    assert.equal(formatClock(1), '0:01');
  });

  it('never goes below zero', () => {
    assert.equal(formatClock(0), '0:00');
    assert.equal(formatClock(-5_000), '0:00');
  });
});
