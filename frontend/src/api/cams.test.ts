import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SlotFeed,
  acceptFrame,
  backingSize,
  backoffDelay,
  camsUrl,
  coverRect,
  mergeSubs,
  retryAfterClose,
} from './cams';

const mid = () => 0.5;
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

class FakeBitmap {
  closed = false;
  readonly width = 640;
  readonly height = 480;

  constructor(readonly seq: number) {}

  close(): void {
    this.closed = true;
  }
}

/** A decoder whose decodes finish only when the test says so. */
function decoder() {
  const seqOf = new Map<Blob, number>();
  const calls: { seq: number; done: (ok: boolean) => void }[] = [];
  const decode = (jpeg: Blob) =>
    new Promise<FakeBitmap>((resolve, reject) => {
      const seq = seqOf.get(jpeg) ?? -1;
      calls.push({ seq, done: (ok) => (ok ? resolve(new FakeBitmap(seq)) : reject(new Error('bad jpeg'))) });
    });
  const frame = (gen: number, seq: number) => {
    const jpeg = new Blob([]);
    seqOf.set(jpeg, seq);
    return { gen, seq, jpeg };
  };
  return { calls, decode, frame };
}

function feedAt(gen: number) {
  const d = decoder();
  const painted: number[] = [];
  const feed = new SlotFeed<FakeBitmap>(gen, 0, d.decode, () => painted.push(feed.lastSeq));
  return { ...d, feed, painted };
}

describe('reconnect', () => {
  it('doubles from 0.5 s and caps at 8 s', () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5, 12].map((n) => backoffDelay(n, mid)), [500, 1000, 2000, 4000, 8000, 8000, 8000]);
  });

  it('jitters by at most 30 % either way', () => {
    assert.equal(backoffDelay(0, () => 0), 350);
    assert.equal(backoffDelay(0, () => 1), 650);
    assert.equal(backoffDelay(9, () => 0), 5600);
    assert.equal(backoffDelay(9, () => 1), 10400);
  });

  it('stops after 4401, 4403 and 4409 and retries after anything else', () => {
    for (const code of [4401, 4403, 4409]) assert.equal(retryAfterClose(code, 0, 60_000, mid), null);
    for (const code of [1000, 1001, 1006, 1008, 1012, 4400, 4408]) {
      assert.deepEqual(retryAfterClose(code, 2, null, mid), { delay: 2000, attempt: 3 });
    }
  });

  it('starts the backoff over after 10 s connected', () => {
    assert.deepEqual(retryAfterClose(1006, 6, 9_999, mid), { delay: 8000, attempt: 7 });
    assert.deepEqual(retryAfterClose(1006, 6, 10_000, mid), { delay: 500, attempt: 1 });
  });

  it('builds the socket URL for the page role', () => {
    assert.equal(camsUrl({ protocol: 'http:', host: '192.168.11.220:8740' }, 'device'), 'ws://192.168.11.220:8740/ws/cams?as=device');
    assert.equal(camsUrl({ protocol: 'https:', host: 'example.lan' }, 'gm'), 'wss://example.lan/ws/cams?as=gm');
  });
});

describe('subscription', () => {
  it('merges every hook into one sorted slot list at the highest fps', () => {
    const sub = mergeSubs([
      { slots: [3, 1], fps: 5 },
      { slots: [1, 4], fps: 30 },
      { slots: [2], fps: 5 },
    ]);
    assert.deepEqual(sub, { t: 'sub', slots: [1, 2, 3, 4], fps: 30 });
  });

  it('ignores the fps of hooks that want no slot', () => {
    assert.deepEqual(mergeSubs([{ slots: [2], fps: 5 }, { slots: [], fps: 30 }]), { t: 'sub', slots: [2], fps: 5 });
  });

  it('pauses with an empty list and drops slots the server would reject', () => {
    assert.deepEqual(mergeSubs([]), { t: 'sub', slots: [], fps: 30 });
    assert.deepEqual(mergeSubs([{ slots: [0, 5, 1.5, 2], fps: 90 }]), { t: 'sub', slots: [2], fps: 30 });
    assert.deepEqual(mergeSubs([{ slots: [1], fps: 0.2 }]), { t: 'sub', slots: [1], fps: 1 });
  });
});

describe('frame acceptance', () => {
  it('takes only the tile generation and strictly newer frames', () => {
    assert.equal(acceptFrame(3, 10, { gen: 3, seq: 11 }), true);
    assert.equal(acceptFrame(3, 10, { gen: 3, seq: 10 }), false);
    assert.equal(acceptFrame(3, 10, { gen: 3, seq: 9 }), false);
    assert.equal(acceptFrame(3, 10, { gen: 2, seq: 99 }), false);
  });

  it('decodes one frame at a time and keeps only the newest waiting one', async () => {
    const { calls, feed, frame, painted } = feedAt(1);
    feed.offer(frame(1, 10), 5, true);
    feed.offer(frame(1, 11), 6, true);
    feed.offer(frame(1, 12), 7, true);
    assert.deepEqual(calls.map((c) => c.seq), [10]);
    calls[0].done(true);
    await flush();
    assert.equal(feed.lastSeq, 10);
    assert.deepEqual(calls.map((c) => c.seq), [10, 12]);
    const first = feed.bitmap;
    calls[1].done(true);
    await flush();
    assert.equal(feed.lastSeq, 12);
    assert.equal(first?.closed, true);
    assert.equal(feed.bitmap?.closed, false);
    assert.deepEqual(painted, [10, 12]);
  });

  it('drops other generations and frames at or below the last drawn', async () => {
    const { calls, feed, frame } = feedAt(3);
    feed.offer(frame(2, 50), 1, true);
    assert.equal(calls.length, 0);
    feed.offer(frame(3, 5), 2, true);
    calls[0].done(true);
    await flush();
    feed.offer(frame(3, 5), 3, true);
    feed.offer(frame(3, 4), 4, true);
    assert.equal(calls.length, 1);
    assert.equal(feed.lastSeq, 5);
  });

  it('only notes the arrival while the page is hidden', () => {
    const { calls, feed, frame } = feedAt(1);
    feed.offer(frame(1, 1), 250, false);
    assert.equal(calls.length, 0);
    assert.equal(feed.lastFrameAt, 250);
    feed.offer(frame(2, 2), 900, false);
    assert.equal(feed.lastFrameAt, 250);
  });

  it('starts sequence numbers over on a new socket and discards decodes from the old one', async () => {
    const { calls, feed, frame, painted } = feedAt(1);
    feed.offer(frame(1, 500), 1, true);
    feed.restart();
    feed.offer(frame(1, 1), 2, true);
    calls[0].done(true);
    await flush();
    assert.equal(feed.bitmap, null);
    assert.deepEqual(calls.map((c) => c.seq), [500, 1]);
    calls[1].done(true);
    await flush();
    assert.equal(feed.lastSeq, 1);
    assert.deepEqual(painted, [1]);
  });

  it('moves on after a failed decode', async () => {
    const { calls, feed, frame } = feedAt(1);
    feed.offer(frame(1, 1), 1, true);
    feed.offer(frame(1, 2), 2, true);
    calls[0].done(false);
    await flush();
    assert.deepEqual(calls.map((c) => c.seq), [1, 2]);
    calls[1].done(true);
    await flush();
    assert.equal(feed.lastSeq, 2);
  });

  it('closes the shown bitmap and any late decode once closed', async () => {
    const { calls, feed, frame } = feedAt(1);
    feed.offer(frame(1, 1), 1, true);
    calls[0].done(true);
    await flush();
    const shown = feed.bitmap;
    feed.offer(frame(1, 2), 2, true);
    feed.close();
    assert.equal(shown?.closed, true);
    calls[1].done(true);
    await flush();
    assert.equal(feed.bitmap, null);
    feed.offer(frame(1, 3), 3, true);
    assert.equal(calls.length, 2);
  });
});

describe('canvas geometry', () => {
  it('sizes the backing store to CSS size × DPR', () => {
    assert.deepEqual(backingSize(320, 180, 2), { w: 640, h: 360 });
    assert.deepEqual(backingSize(0, 0, 1), { w: 1, h: 1 });
  });

  it('caps the backing store at 960 × 720 without changing its shape', () => {
    assert.deepEqual(backingSize(1034, 576, 1), { w: 960, h: 535 });
    assert.deepEqual(backingSize(400, 800, 1), { w: 360, h: 720 });
    assert.deepEqual(backingSize(960, 720, 2), { w: 960, h: 720 });
  });

  it('crops the picture to cover the canvas', () => {
    assert.deepEqual(coverRect(640, 480, 640, 480), { x: 0, y: 0, w: 640, h: 480 });
    assert.deepEqual(coverRect(640, 480, 1280, 480), { x: 0, y: 120, w: 640, h: 240 });
    assert.deepEqual(coverRect(640, 480, 240, 480), { x: 200, y: 0, w: 240, h: 480 });
  });
});
