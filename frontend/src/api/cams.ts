import { createElement, useEffect, useRef, type JSX } from 'react';
import { parseCamFrame, type CamSub } from './types';

/** The shared /ws/cams client (docs/CONTRACT.md §5, §11): one reference-counted socket per page
 * and role; JPEG frames are decoded per slot and drawn into every mounted CamCanvas. */

export type CamRole = 'device' | 'gm';

export const DEAD_MS = 12_000;
export const STABLE_MS = 10_000;
export const STALE_MS = 3_000;
export const MAX_BACKING_W = 960;
export const MAX_BACKING_H = 720;
const BACKOFF_MIN_MS = 500;
const BACKOFF_MAX_MS = 8_000;
const JITTER = 0.3;
const LINGER_MS = 2_000;
const WATCHDOG_MS = 1_000;
const STALE_TICK_MS = 100;
const NOISE_W = 192;
const NOISE_H = 144;

// ------------------------------------------------------------------ pure parts (cams.test.ts)

/** Reconnect delay: 0.5 s doubling to 8 s, then ±30 % jitter. */
export function backoffDelay(attempt: number, rand: () => number = Math.random): number {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** attempt);
  return Math.round(base * (1 + JITTER * (2 * rand() - 1)));
}

/** The retry after a close, or null after 4401/4403/4409 (wait until the subscription changes).
 * A connection that stayed up for 10 s starts the backoff over. */
export function retryAfterClose(
  code: number,
  attempt: number,
  connectedMs: number | null,
  rand?: () => number,
): { delay: number; attempt: number } | null {
  if (code === 4401 || code === 4403 || code === 4409) return null;
  const n = connectedMs !== null && connectedMs >= STABLE_MS ? 0 : attempt;
  return { delay: backoffDelay(n, rand), attempt: n + 1 };
}

export interface Want {
  slots: readonly number[];
  fps: number;
}

/** The one `sub` for every mounted hook: each wanted slot once, at the highest fps asked for with a slot. */
export function mergeSubs(wants: Iterable<Want>): CamSub {
  const slots = new Set<number>();
  let fps = 0;
  for (const want of wants) {
    const valid = want.slots.filter((s) => Number.isInteger(s) && s >= 1 && s <= 4);
    if (!valid.length) continue;
    for (const s of valid) slots.add(s);
    fps = Math.max(fps, want.fps);
  }
  return {
    t: 'sub',
    slots: [...slots].sort((a, b) => a - b) as CamSub['slots'],
    fps: Math.min(30, Math.max(1, Math.round(fps || 30))),
  };
}

/** A frame may be drawn only for the tile's assignment generation and only if newer than the last drawn. */
export function acceptFrame(tileGen: number, lastSeq: number, frame: { gen: number; seq: number }): boolean {
  return frame.gen === tileGen && frame.seq > lastSeq;
}

/** Canvas backing store: CSS size × DPR, scaled down evenly to fit 960 × 720. */
export function backingSize(cssW: number, cssH: number, dpr: number): { w: number; h: number } {
  const w = cssW * dpr;
  const h = cssH * dpr;
  const k = Math.min(1, MAX_BACKING_W / w, MAX_BACKING_H / h);
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** The source rectangle that makes a `sw`×`sh` image cover a `dw`×`dh` canvas (object-fit: cover). */
export function coverRect(sw: number, sh: number, dw: number, dh: number): { x: number; y: number; w: number; h: number } {
  const k = Math.max(dw / sw, dh / sh);
  const w = dw / k;
  const h = dh / k;
  return { x: (sw - w) / 2, y: (sh - h) / 2, w, h };
}

export function camsUrl(loc: { protocol: string; host: string }, as: CamRole): string {
  return `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}/ws/cams?as=${as}`;
}

export interface Bitmap {
  readonly width: number;
  readonly height: number;
  close(): void;
}

interface FrameIn {
  gen: number;
  seq: number;
  jpeg: Blob;
}

/** One slot's decode pipeline: at most one decode in flight, only the newest frame waits behind it,
 * and a decoded frame is kept only while its generation and socket are still current. */
export class SlotFeed<B extends Bitmap = ImageBitmap> {
  bitmap: B | null = null;
  lastSeq = 0;
  lastFrameAt: number;
  private pending: FrameIn | null = null;
  private busy = false;
  private epoch = 0;
  private closed = false;

  constructor(
    public gen: number,
    now: number,
    private readonly decode: (jpeg: Blob) => Promise<B>,
    private readonly onBitmap: () => void,
  ) {
    this.lastFrameAt = now;
  }

  /** A frame from the socket; `decode` is false while the page is hidden (it still counts as a sign of life). */
  offer(frame: FrameIn, now: number, decode: boolean): void {
    if (this.closed || !acceptFrame(this.gen, this.lastSeq, frame)) return;
    this.lastFrameAt = now;
    if (!decode) return;
    this.pending = frame;
    if (!this.busy) void this.pump();
  }

  /** A new socket: the server may have restarted, so sequence numbers start over. */
  restart(): void {
    this.epoch++;
    this.lastSeq = 0;
    this.pending = null;
  }

  close(): void {
    this.closed = true;
    this.pending = null;
    this.bitmap?.close();
    this.bitmap = null;
  }

  private async pump(): Promise<void> {
    this.busy = true;
    for (let frame = this.pending; frame && !this.closed; frame = this.pending) {
      this.pending = null;
      const epoch = this.epoch;
      let bitmap: B;
      try {
        bitmap = await this.decode(frame.jpeg);
      } catch {
        continue;
      }
      if (this.closed || epoch !== this.epoch) {
        bitmap.close();
        continue;
      }
      this.bitmap?.close();
      this.bitmap = bitmap;
      this.lastSeq = frame.seq;
      this.onBitmap();
    }
    this.busy = false;
  }
}

// ------------------------------------------------------------------ the page-wide socket per role

interface Sink {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** What the canvas shows: null = black, a bitmap, or DIRTY (static or not yet painted). */
  drawn: object | null;
}

const DIRTY = {};
const decodeJpeg = (jpeg: Blob) => createImageBitmap(jpeg);

let noise: HTMLCanvasElement | null = null;
let noiseAt = -Infinity;

function noiseFrame(now: number): HTMLCanvasElement {
  noise ??= Object.assign(document.createElement('canvas'), { width: NOISE_W, height: NOISE_H });
  const ctx = noise.getContext('2d');
  if (ctx && now - noiseAt >= STALE_TICK_MS) {
    noiseAt = now;
    const img = ctx.createImageData(NOISE_W, NOISE_H);
    const px = new Uint32Array(img.data.buffer);
    for (let i = 0; i < px.length; i++) px[i] = 0xff000000 | (((Math.random() * 256) | 0) * 0x010101);
    ctx.putImageData(img, 0, 0);
  }
  return noise;
}

function paint(sink: Sink, feed: SlotFeed, now: number): void {
  const { canvas, ctx } = sink;
  if (now - feed.lastFrameAt >= STALE_MS) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(noiseFrame(now), 0, 0, canvas.width, canvas.height);
    sink.drawn = DIRTY;
  } else if (feed.bitmap) {
    if (sink.drawn === feed.bitmap) return;
    const r = coverRect(feed.bitmap.width, feed.bitmap.height, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(feed.bitmap, r.x, r.y, r.w, r.h, 0, 0, canvas.width, canvas.height);
    sink.drawn = feed.bitmap;
  } else if (sink.drawn !== null) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    sink.drawn = null;
  }
}

class CamLink {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private openedAt: number | null = null;
  private lastRx = 0;
  private sent = '';
  /** The sub that was refused (4401/4403/4409); no reconnect until the wanted sub differs. */
  private blocked: string | null = null;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private linger: ReturnType<typeof setTimeout> | undefined;
  private watchdog: ReturnType<typeof setInterval> | undefined;
  private staleTicker: ReturnType<typeof setInterval> | undefined;
  private raf = 0;
  private queued = false;
  private readonly wants = new Set<Want>();
  private readonly feeds = new Map<number, SlotFeed>();
  private readonly sinks = new Map<number, Set<Sink>>();
  private readonly byCanvas = new Map<Element, Sink>();
  private readonly resizer = new ResizeObserver((entries) => this.resized(entries));

  constructor(private readonly role: CamRole) {}

  want(want: Want): () => void {
    this.wants.add(want);
    this.queueSync();
    return () => {
      this.wants.delete(want);
      this.queueSync();
    };
  }

  attach(slot: number, gen: number, canvas: HTMLCanvasElement): () => void {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return () => undefined;
    let feed = this.feeds.get(slot);
    if (!feed || feed.gen !== gen) {
      feed?.close();
      feed = new SlotFeed(gen, performance.now(), decodeJpeg, this.requestPaint);
      this.feeds.set(slot, feed);
    }
    const sink: Sink = { canvas, ctx, drawn: DIRTY };
    const sinks = this.sinks.get(slot) ?? new Set<Sink>();
    this.sinks.set(slot, sinks.add(sink));
    this.byCanvas.set(canvas, sink);
    this.resizer.observe(canvas);
    this.staleTicker ??= setInterval(this.checkStale, STALE_TICK_MS);
    this.requestPaint();
    return () => {
      this.resizer.unobserve(canvas);
      this.byCanvas.delete(canvas);
      sinks.delete(sink);
      if (sinks.size) return;
      this.sinks.delete(slot);
      this.feeds.get(slot)?.close();
      this.feeds.delete(slot);
      if (this.sinks.size) return;
      clearInterval(this.staleTicker);
      this.staleTicker = undefined;
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    };
  }

  private queueSync(): void {
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      this.sync();
    });
  }

  /** Sends the merged sub when it changed; opens the socket only when some slot is wanted. */
  private sync(): void {
    const sub = mergeSubs(this.wants);
    const msg = JSON.stringify(sub);
    if (this.blocked !== null && this.blocked !== msg) this.blocked = null;
    clearTimeout(this.linger);
    this.linger = this.wants.size ? undefined : setTimeout(() => this.shutdown(), LINGER_MS);
    if (this.ws?.readyState === WebSocket.OPEN) {
      if (msg === this.sent) return;
      this.ws.send(msg);
      this.sent = msg;
    } else if (!this.ws && this.retry === undefined && this.blocked === null && sub.slots.length) {
      this.open();
    }
  }

  private open(): void {
    const ws = new WebSocket(camsUrl(location, this.role));
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.sent = '';
    this.openedAt = null;
    this.lastRx = performance.now();
    ws.onopen = () => {
      this.openedAt = this.lastRx = performance.now();
      for (const feed of this.feeds.values()) feed.restart();
      this.sync();
    };
    ws.onmessage = (ev: MessageEvent) => this.receive(ev.data);
    ws.onclose = (ev: CloseEvent) => this.closed(ev.code);
    this.watchdog = setInterval(() => {
      if (performance.now() - this.lastRx > DEAD_MS) this.closed(4408);
    }, WATCHDOG_MS);
  }

  private receive(data: unknown): void {
    this.lastRx = performance.now();
    if (!(data instanceof ArrayBuffer)) return;
    const frame = parseCamFrame(data);
    if (frame) this.feeds.get(frame.slot)?.offer(frame, this.lastRx, !document.hidden);
  }

  private closed(code: number): void {
    const upMs = this.openedAt === null ? null : performance.now() - this.openedAt;
    this.drop();
    const plan = retryAfterClose(code, this.attempt, upMs);
    if (!plan) {
      this.blocked = JSON.stringify(mergeSubs(this.wants));
      return;
    }
    this.attempt = plan.attempt;
    this.retry = setTimeout(() => {
      this.retry = undefined;
      this.sync();
    }, plan.delay);
  }

  private drop(): void {
    clearInterval(this.watchdog);
    const ws = this.ws;
    if (!ws) return;
    this.ws = null;
    ws.onopen = ws.onmessage = ws.onclose = null;
    ws.close();
  }

  private shutdown(): void {
    clearTimeout(this.retry);
    this.retry = this.linger = undefined;
    this.drop();
    this.attempt = 0;
    this.blocked = null;
  }

  private resized(entries: ResizeObserverEntry[]): void {
    const dpr = window.devicePixelRatio || 1;
    for (const entry of entries) {
      const sink = this.byCanvas.get(entry.target);
      if (!sink) continue;
      const { w, h } = backingSize(entry.contentRect.width, entry.contentRect.height, dpr);
      if (sink.canvas.width === w && sink.canvas.height === h) continue;
      sink.canvas.width = w;
      sink.canvas.height = h;
      sink.drawn = null;
      this.requestPaint();
    }
  }

  private readonly checkStale = (): void => {
    const now = performance.now();
    for (const feed of this.feeds.values()) {
      if (now - feed.lastFrameAt >= STALE_MS) return this.requestPaint();
    }
  };

  private readonly requestPaint = (): void => {
    this.raf ||= requestAnimationFrame(this.paintAll);
  };

  private readonly paintAll = (): void => {
    this.raf = 0;
    const now = performance.now();
    for (const [slot, sinks] of this.sinks) {
      const feed = this.feeds.get(slot);
      if (feed) for (const sink of sinks) paint(sink, feed, now);
    }
  };
}

const links = new Map<CamRole, CamLink>();

function linkFor(as: CamRole): CamLink {
  let link = links.get(as);
  if (!link) links.set(as, (link = new CamLink(as)));
  return link;
}

// ------------------------------------------------------------------ React API

/** Keeps `slots` subscribed on the page's shared /ws/cams socket while mounted; `[]` pauses. */
export function useCamFrames(slots: number[], fps: number, as: CamRole): void {
  const key = [...new Set(slots)].sort((a, b) => a - b).join(',');
  useEffect(() => linkFor(as).want({ slots: key ? key.split(',').map(Number) : [], fps }), [key, fps, as]);
}

const FILL = { display: 'block', width: '100%', height: '100%' } as const;

/** One slot's live picture (object-fit: cover); draws static when no frame arrived for 3 s. */
export function CamCanvas({ slot, gen, fps, as, className }: {
  slot: number;
  gen: number;
  fps: number;
  as: CamRole;
  className?: string;
}): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  useCamFrames([slot], fps, as);
  useEffect(() => (ref.current ? linkFor(as).attach(slot, gen, ref.current) : undefined), [slot, gen, as]);
  return createElement('canvas', { ref, className, style: FILL, 'aria-hidden': true });
}
