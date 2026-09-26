import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CamSlot } from '../../api/types';
import { ago, camStatus, codeKey, mmss, normalizeToken, parseHostPort, pinInput, sortPending, torchKey, validToken } from './logic';

const slot = (over: Partial<CamSlot>): CamSlot => ({
  slot: 1,
  gen: 1,
  room: '',
  phone: { id: 'mdns:A', name: 'A', host: '192.168.11.5', port: 4747, manual: false },
  link: 'streaming',
  signal: 'live',
  fps: 15,
  last_frame_at: null,
  battery: null,
  torch: 'unknown',
  torch_state: 'off',
  error_code: null,
  ...over,
});

describe('camera status', () => {
  it('maps link and signal to a pill', () => {
    assert.equal(camStatus(slot({ link: 'idle', phone: null, signal: 'offline' })).key, 'gm.cam_empty');
    assert.equal(camStatus(slot({ link: 'disabled', signal: 'offline' })).key, 'gm.cam_off');
    assert.equal(camStatus(slot({ link: 'busy', signal: 'offline' })).tone, 'alert');
    assert.equal(camStatus(slot({})).key, 'gm.cam_live');
    assert.equal(camStatus(slot({ signal: 'lost' })).key, 'gm.cam_lost');
    assert.equal(camStatus(slot({ link: 'backoff', signal: 'lost' })).key, 'gm.cam_lost');
    assert.equal(camStatus(slot({ link: 'connecting', signal: 'offline' })).key, 'gm.cam_connecting');
    assert.equal(camStatus(slot({ link: 'backoff', signal: 'offline' })).key, 'gm.cam_retrying');
    assert.equal(camStatus(slot({ signal: 'offline' })).key, 'gm.cam_no_signal');
  });

  it('flags an unknown torch state before the capability', () => {
    assert.equal(torchKey(slot({ torch: 'ready', torch_state: 'unknown' })).key, 'gm.torch_state_unknown');
    assert.equal(torchKey(slot({ torch: 'pro_required' })).key, 'gm.torch_pro');
    assert.equal(torchKey(slot({})).key, 'gm.torch_checking');
  });
});

describe('formatting', () => {
  it('formats countdowns', () => {
    assert.equal(mmss(300_000), '5:00');
    assert.equal(mmss(61_001), '1:02');
    assert.equal(mmss(9_000), '0:09');
    assert.equal(mmss(-5), '0:00');
  });

  it('picks an age unit', () => {
    assert.deepEqual(ago(2_000), { key: 'gm.ago_now', n: 0 });
    assert.deepEqual(ago(12_500), { key: 'gm.ago_s', n: 12 });
    assert.deepEqual(ago(125_000), { key: 'gm.ago_min', n: 2 });
    assert.deepEqual(ago(3 * 3600_000), { key: 'gm.ago_h', n: 3 });
    assert.deepEqual(ago(3 * 86_400_000), { key: 'gm.ago_d', n: 3 });
  });

  it('routes server codes to their namespace', () => {
    assert.equal(codeKey('err.cam_busy'), 'errors.cam_busy');
    assert.equal(codeKey('gm.toast.paired'), 'gm.toast.paired');
  });

  it('sorts pending requests by age, then code', () => {
    const p = (code: string, created_at: number) => ({ code, created_at, expires_at: 0, address: null, hint: '' });
    assert.deepEqual(sortPending([p('KQXT', 5), p('ACDE', 9), p('FHJK', 5)]).map((x) => x.code), ['FHJK', 'KQXT', 'ACDE']);
  });
});

describe('input parsing', () => {
  it('reads host and optional port', () => {
    assert.deepEqual(parseHostPort(' 192.168.11.73 '), { host: '192.168.11.73', port: 4747 });
    assert.deepEqual(parseHostPort('192.168.11.73:8080'), { host: '192.168.11.73', port: 8080 });
    for (const bad of ['', '192.168.11', '192.168.11.256', 'phone.local', '192.168.11.7:0', '192.168.11.7:70000', '1.2.3.4:5:6', '01.2.3.4']) {
      assert.equal(parseHostPort(bad), null, bad);
    }
  });

  it('cleans PIN and token input', () => {
    assert.equal(pinInput('12a34 5678 9'), '12345678');
    assert.equal(normalizeToken(' kqxt-acde '), 'KQXTACDE');
    assert.ok(validToken('KQXTACDE'));
    assert.ok(!validToken('KQXTACDB'));
    assert.ok(!validToken('KQXTACD'));
  });
});
