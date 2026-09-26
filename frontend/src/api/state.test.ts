import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { errorCode, pairPollDelay } from './http';
import { INITIAL, backoffDelay, closeOutcome, newId, parseServerMsg, reduce, retryPlan, viewLang, viewVolume } from './state';
import type { GmView, ServerMsg, View } from './types';

const mid = () => 0.5;

describe('backoff', () => {
  it('doubles from 0.5 s and caps at 8 s', () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5, 12].map((n) => backoffDelay(n, mid)), [500, 1000, 2000, 4000, 8000, 8000, 8000]);
  });

  it('jitters by at most 30 % either way', () => {
    assert.equal(backoffDelay(0, () => 0), 350);
    assert.equal(backoffDelay(0, () => 1), 650);
    assert.equal(backoffDelay(9, () => 0), 5600);
    assert.equal(backoffDelay(9, () => 1), 10400);
  });

  it('keeps growing while connections fail or drop quickly', () => {
    let attempt = 0;
    const delays: number[] = [];
    for (const connectedMs of [null, null, 3000, null, 9999, null]) {
      const plan = retryPlan(attempt, connectedMs, mid);
      delays.push(plan.delay);
      attempt = plan.attempt;
    }
    assert.deepEqual(delays, [500, 1000, 2000, 4000, 8000, 8000]);
  });

  it('starts over after 10 s connected', () => {
    assert.deepEqual(retryPlan(6, 10_000, mid), { delay: 500, attempt: 1 });
    assert.deepEqual(retryPlan(6, 60_000, mid), { delay: 500, attempt: 1 });
  });
});

describe('close codes', () => {
  it('stops for good on 4401 and 4409 only', () => {
    assert.equal(closeOutcome(4401), 'auth');
    assert.equal(closeOutcome(4409), 'replaced');
    for (const code of [1000, 1001, 1006, 1008, 1012, 4400, 4403, 4408]) assert.equal(closeOutcome(code), 'retry');
  });
});

describe('messages', () => {
  const gm = { kind: 'gm', settings: { lang: 'hu', volume: 40, cams_enabled: true, torch_blink: true } } as GmView;

  it('parses JSON text frames with a type tag only', () => {
    assert.equal(parseServerMsg('not json'), null);
    assert.equal(parseServerMsg('"state"'), null);
    assert.equal(parseServerMsg('{"now": 1}'), null);
    assert.equal(parseServerMsg(new ArrayBuffer(4)), null);
    assert.deepEqual(parseServerMsg('{"t":"pong","now":5}'), { t: 'pong', now: 5 });
  });

  it('takes the view and the clock offset from state', () => {
    const view: View = { kind: 'hello', lang: 'en' };
    const next = reduce(INITIAL, { t: 'state', now: 10_500, v: view }, 10_000);
    assert.equal(next.view, view);
    assert.equal(next.offset, 500);
    assert.equal(next.lastError, null);
  });

  it('corrects the offset from pong by half the round trip', () => {
    const next = reduce(INITIAL, { t: 'pong', now: 5_000 }, 2_100, 1_900);
    assert.equal(next.offset, 3_000);
    const same = reduce(next, { t: 'pong', now: 5_100 }, 2_200, 1_900);
    assert.equal(same, next);
  });

  it('keeps errors with their ref', () => {
    const next = reduce(INITIAL, { t: 'error', code: 'err.forbidden', ref: 'abc' }, 0);
    assert.deepEqual(next.lastError, { code: 'err.forbidden', ref: 'abc' });
    const again = reduce(next, { t: 'error', code: 'err.forbidden', ref: null }, 0);
    assert.notEqual(again.lastError, next.lastError);
    assert.deepEqual(again.lastError, { code: 'err.forbidden', ref: null });
  });

  it('leaves the state alone for events and unknown messages', () => {
    const s = reduce(INITIAL, { t: 'state', now: 1, v: gm }, 1);
    assert.equal(reduce(s, { t: 'event', e: { type: 'paired', view: 'security' } }, 2), s);
    assert.equal(reduce(s, { t: 'later' } as unknown as ServerMsg, 2), s);
  });

  it('reads lang and volume from any view', () => {
    assert.equal(viewLang(gm), 'hu');
    assert.equal(viewVolume(gm), 40);
    assert.equal(viewLang({ kind: 'pairing', status: 'closed', code: null, expires_at: null, lang: 'hu' }), 'hu');
    assert.equal(viewVolume({ kind: 'hello', lang: 'en' }), null);
  });

  it('makes short action ids', () => {
    const ids = new Set(Array.from({ length: 200 }, newId));
    assert.equal(ids.size, 200);
    for (const id of ids) assert.match(id, /^[0-9a-z]{8}$/);
  });
});

describe('http helpers', () => {
  it('maps error bodies to err codes', () => {
    assert.equal(errorCode({ detail: 'err.pin_wrong' }), 'err.pin_wrong');
    assert.equal(errorCode({ detail: 'Not Found' }), 'err.bad_request');
    assert.equal(errorCode({ detail: [{ msg: 'x' }] }), 'err.bad_request');
    assert.equal(errorCode(null), 'err.bad_request');
  });

  it('paces pairing polls under 10 per minute', () => {
    assert.equal(pairPollDelay([], 0), 3000);
    const nine = Array.from({ length: 9 }, (_, i) => i * 3000);
    assert.equal(pairPollDelay(nine.slice(0, 8), 24_000), 3000);
    assert.equal(pairPollDelay(nine, 27_000), 33_000);
    assert.equal(pairPollDelay(nine, 60_000), 3000);
    let t = 0;
    const sent: number[] = [];
    while (t < 300_000) {
      sent.push(t);
      t += pairPollDelay(sent, t);
    }
    for (const at of sent) assert.ok(sent.filter((x) => x >= at && x < at + 60_000).length <= 9);
  });
});
