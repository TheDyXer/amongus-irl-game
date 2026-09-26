import { useEffect, useEffectEvent, useSyncExternalStore } from 'react';
import type { Action, ClientMsg, Lang, ServerEvent, ServerMsg, View } from './types';

/** The single /ws client (docs/CONTRACT.md §4, §11): state push, actions, events, heartbeat, reconnect. */

export type Role = 'device' | 'gm';
/** Why the socket stopped for good: 4401 (not signed in for the role) or 4409 (opened elsewhere). */
export type Ended = 'auth' | 'replaced';
export interface ServerError {
  code: string;
  ref: string | null;
}

export interface ServerState {
  view: View | null;
  connected: boolean;
  ended: Ended | null;
  lastError: ServerError | null;
  /** Estimated server epoch ms minus local epoch ms. */
  offset: number;
}

export const INITIAL: ServerState = { view: null, connected: false, ended: null, lastError: null, offset: 0 };
export const PING_MS = 20_000;
export const DEAD_MS = 45_000;
export const CONNECT_TIMEOUT_MS = 10_000;
export const STABLE_MS = 10_000;
const BACKOFF_MIN_MS = 500;
const BACKOFF_MAX_MS = 8_000;
const JITTER = 0.3;
const TICK_MS = 5_000;

// ------------------------------------------------------------------ pure parts (state.test.ts)

/** Reconnect delay: 0.5 s doubling to 8 s, then ±30 % jitter. */
export function backoffDelay(attempt: number, rand: () => number = Math.random): number {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** attempt);
  return Math.round(base * (1 + JITTER * (2 * rand() - 1)));
}

/** The retry after a close; a connection that stayed up for 10 s starts the backoff over. */
export function retryPlan(attempt: number, connectedMs: number | null, rand?: () => number): { delay: number; attempt: number } {
  const n = connectedMs !== null && connectedMs >= STABLE_MS ? 0 : attempt;
  return { delay: backoffDelay(n, rand), attempt: n + 1 };
}

export function closeOutcome(code: number): Ended | 'retry' {
  if (code === 4401) return 'auth';
  if (code === 4409) return 'replaced';
  return 'retry';
}

export function parseServerMsg(data: unknown): ServerMsg | null {
  if (typeof data !== 'string') return null;
  try {
    const msg: unknown = JSON.parse(data);
    return msg !== null && typeof msg === 'object' && typeof (msg as { t?: unknown }).t === 'string' ? (msg as ServerMsg) : null;
  } catch {
    return null;
  }
}

/** Applies one server message received at local time `at`; `pingAt` is when the last ping left. */
export function reduce(s: ServerState, msg: ServerMsg, at: number, pingAt: number | null = null): ServerState {
  switch (msg.t) {
    case 'state':
      return { ...s, view: msg.v, offset: msg.now - at };
    case 'pong': {
      const offset = Math.round(msg.now - (pingAt === null ? at : (at + pingAt) / 2));
      return Math.abs(offset - s.offset) < 250 ? s : { ...s, offset };
    }
    case 'error':
      return { ...s, lastError: { code: msg.code, ref: msg.ref ?? null } };
    default:
      return s;
  }
}

export function viewLang(view: View): Lang {
  return view.kind === 'gm' ? view.settings.lang : view.lang;
}

export function viewVolume(view: View): number | null {
  if (view.kind === 'gm') return view.settings.volume;
  return view.kind === 'screen' ? view.volume : null;
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10).padEnd(8, '0');
}

// ------------------------------------------------------------------ the module-level client

let state = INITIAL;
let role: Role | null = null;
let ws: WebSocket | null = null;
let attempt = 0;
let startedAt = 0;
let openedAt: number | null = null;
let lastRx = 0;
let pingAt: number | null = null;
let retry: ReturnType<typeof setTimeout> | undefined;
let watchdog: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();
const handlers = new Set<(e: ServerEvent) => void>();

function commit(next: ServerState): void {
  if (next === state) return;
  state = next;
  for (const listener of listeners) listener();
}

function drop(): void {
  if (!ws) return;
  ws.onopen = ws.onmessage = ws.onclose = null;
  ws.close();
  ws = null;
}

function stop(): void {
  clearTimeout(retry);
  clearInterval(watchdog);
  drop();
}

function open(): void {
  const sock = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws?as=${role}`);
  ws = sock;
  startedAt = Date.now();
  openedAt = null;
  sock.onopen = () => {
    openedAt = lastRx = Date.now();
    pingAt = null;
    commit({ ...state, connected: true });
  };
  sock.onmessage = (ev) => receive(ev.data);
  sock.onclose = (ev) => closed(ev.code);
}

function receive(data: unknown): void {
  lastRx = Date.now();
  const msg = parseServerMsg(data);
  if (!msg) return;
  commit(reduce(state, msg, lastRx, pingAt));
  if (msg.t !== 'event') return;
  for (const handler of [...handlers]) {
    try {
      handler(msg.e);
    } catch (err) {
      reportError(err);
    }
  }
}

function closed(code: number): void {
  ws = null;
  const outcome = closeOutcome(code);
  if (outcome !== 'retry') {
    stop();
    commit({ ...state, connected: false, ended: outcome });
    return;
  }
  const plan = retryPlan(attempt, openedAt === null ? null : Date.now() - openedAt);
  attempt = plan.attempt;
  commit({ ...state, connected: false });
  retry = setTimeout(open, plan.delay);
}

/** Pings every 20 s; a socket silent for 45 s (or stuck connecting for 10 s) is dropped and retried. */
function tick(): void {
  if (!ws) return;
  const t = Date.now();
  const stuck = ws.readyState === WebSocket.CONNECTING ? t - startedAt > CONNECT_TIMEOUT_MS : t - lastRx > DEAD_MS;
  if (stuck) {
    drop();
    closed(4408);
  } else if (ws.readyState === WebSocket.OPEN && (pingAt === null || t - pingAt >= PING_MS)) {
    pingAt = t;
    ws.send(JSON.stringify({ t: 'ping' } satisfies ClientMsg));
  }
}

function start(): void {
  stop();
  attempt = 0;
  watchdog = setInterval(tick, TICK_MS);
  open();
}

/** Opens /ws?as=<role>; a no-op while that role's socket is running. Restarts after 4401/4409. */
export function connect(opts: { as: Role }): void {
  if (role === opts.as && state.ended === null) return;
  const keepView = role === opts.as;
  role = opts.as;
  commit({ ...state, view: keepView ? state.view : null, connected: false, ended: null, lastError: null });
  start();
}

/** Replaces the socket at once (e.g. after a new device cookie was set). */
export function reconnect(): void {
  if (role === null) return;
  commit({ ...state, connected: false, ended: null });
  start();
}

/** Closes the socket for good (GM logout). */
export function disconnect(): void {
  stop();
  role = null;
  commit({ ...INITIAL, offset: state.offset });
}

/** Estimated server epoch ms. */
export function now(): number {
  return Date.now() + state.offset;
}

/** Sends an action with a short random id (echoed as `ref` on errors); null while offline. */
export function send(a: Action): string | null {
  if (!ws || ws.readyState !== WebSocket.OPEN) return null;
  const id = newId();
  ws.send(JSON.stringify({ t: 'act', id, a } satisfies ClientMsg));
  return id;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): ServerState {
  return state;
}

export function useServer(): {
  view: View | null;
  now: () => number;
  connected: boolean;
  ended: Ended | null;
  send: (a: Action) => string | null;
  lastError: ServerError | null;
} {
  const s = useSyncExternalStore(subscribe, snapshot);
  return { view: s.view, now, connected: s.connected, ended: s.ended, send, lastError: s.lastError };
}

const clockListeners = new Set<() => void>();
let clockTimer: ReturnType<typeof setInterval> | undefined;

function subscribeClock(listener: () => void): () => void {
  clockListeners.add(listener);
  if (clockListeners.size === 1) {
    clockTimer = setInterval(() => {
      for (const l of clockListeners) l();
    }, 1000);
  }
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0) clearInterval(clockTimer);
  };
}

function clockSnapshot(): number {
  return Math.floor(now() / 1000) * 1000;
}

/** Estimated server time (ms), re-rendering once a second; for ages and countdowns. */
export function useNow(): number {
  return useSyncExternalStore(subscribeClock, clockSnapshot);
}

export function useServerEvent(handler: (e: ServerEvent) => void): void {
  const onEvent = useEffectEvent(handler);
  useEffect(() => {
    const listener = (e: ServerEvent) => onEvent(e);
    handlers.add(listener);
    return () => {
      handlers.delete(listener);
    };
  }, []);
}
