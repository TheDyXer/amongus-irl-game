import type { GmStatus, PairStatus, PinBody, PublicInfo, SetupBody } from './types';

/** A rejected HTTP call; `code` is the server's `{"detail": "err.*"}` i18n key. */
export class ApiError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

/** The err.* code of an error body, or err.bad_request for anything else (FastAPI's own 404/422). */
export function errorCode(body: unknown): string {
  const detail = body !== null && typeof body === 'object' ? (body as { detail?: unknown }).detail : undefined;
  return typeof detail === 'string' && detail.startsWith('err.') ? detail : 'err.bad_request';
}

async function request<T>(method: 'GET' | 'POST', path: string, body: object = {}): Promise<T> {
  const post = method === 'POST';
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: post ? { 'Content-Type': 'application/json' } : undefined,
    body: post ? JSON.stringify(body) : undefined,
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(errorCode(data), res.status);
  return data as T;
}

const pairStarts: number[] = [];

export async function pairStart(): Promise<PairStatus> {
  pairStarts.push(Date.now());
  if (pairStarts.length > 20) pairStarts.shift();
  return request('POST', '/api/pair/start');
}

/** Delay before this page's next POST /api/pair/start (see pairPollDelay). */
export function nextPairPoll(): number {
  return pairPollDelay(pairStarts, Date.now());
}

export async function pairStatus(): Promise<PairStatus> {
  return request('GET', '/api/pair/status');
}

export async function gmStatus(): Promise<GmStatus> {
  return request('GET', '/api/gm/status');
}

export async function gmSetup(pin: string, setupToken: string): Promise<void> {
  await request('POST', '/api/gm/setup', { pin, setup_token: setupToken } satisfies SetupBody);
}

export async function gmLogin(pin: string): Promise<void> {
  await request('POST', '/api/gm/login', { pin } satisfies PinBody);
}

export async function gmLogout(): Promise<void> {
  await request('POST', '/api/gm/logout');
}

export async function publicInfo(): Promise<PublicInfo> {
  return request('GET', '/api/public');
}

export const PAIR_POLL_MS = 3000;
const PAIR_POLL_PER_MIN = 9;

/** Delay before the next POST /api/pair/start: every 3 s, but at most 9 in any rolling minute so a
 * waiting screen stays under the server's 10/min per IP limit. `recent` holds earlier POST times. */
export function pairPollDelay(recent: readonly number[], now: number): number {
  const inWindow = recent.filter((t) => now - t < 60_000).sort((a, b) => a - b);
  if (inWindow.length < PAIR_POLL_PER_MIN) return PAIR_POLL_MS;
  return Math.max(PAIR_POLL_MS, inWindow[inWindow.length - PAIR_POLL_PER_MIN] + 60_000 - now);
}
