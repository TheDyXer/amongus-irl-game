import type { CamSlot, PendingPairing } from '../../api/types';

export type Tone = 'live' | 'lost' | 'alert' | 'neutral' | 'info';

/** Status pill of a camera slot, from the relay link and the frame signal. */
export function camStatus(c: CamSlot): { key: string; tone: Tone } {
  if (c.link === 'idle') return { key: 'gm.cam_empty', tone: 'neutral' };
  if (c.link === 'disabled') return { key: 'gm.cam_off', tone: 'neutral' };
  if (c.link === 'busy') return { key: 'gm.cam_busy', tone: 'alert' };
  if (c.signal === 'live') return { key: 'gm.cam_live', tone: 'live' };
  if (c.signal === 'lost') return { key: 'gm.cam_lost', tone: 'lost' };
  if (c.link === 'connecting') return { key: 'gm.cam_connecting', tone: 'info' };
  if (c.link === 'backoff') return { key: 'gm.cam_retrying', tone: 'lost' };
  return { key: 'gm.cam_no_signal', tone: 'alert' };
}

export function torchKey(c: CamSlot): { key: string; tone: Tone } {
  if (c.torch_state === 'unknown') return { key: 'gm.torch_state_unknown', tone: 'lost' };
  switch (c.torch) {
    case 'ready':
      return { key: 'gm.torch_ready', tone: 'live' };
    case 'pro_required':
      return { key: 'gm.torch_pro', tone: 'lost' };
    case 'unsupported':
      return { key: 'gm.torch_unsupported', tone: 'neutral' };
    default:
      return { key: 'gm.torch_checking', tone: 'neutral' };
  }
}

/** Oldest request first, ties broken by code, so rows never jump while the GM reads them. */
export function sortPending(pending: readonly PendingPairing[]): PendingPairing[] {
  return [...pending].sort((a, b) => a.created_at - b.created_at || a.code.localeCompare(b.code));
}

/** i18n key of a server code: err.* lives in the errors namespace, gm.notice.* / gm.toast.* in gm. */
export function codeKey(code: string): string {
  return code.startsWith('err.') ? `errors.${code.slice(4)}` : code;
}

/** "m:ss" for countdowns; never negative. */
export function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Translation key and count for "n s/min/h ago". */
export function ago(ms: number): { key: string; n: number } {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 5) return { key: 'gm.ago_now', n: 0 };
  if (s < 60) return { key: 'gm.ago_s', n: s };
  if (s < 3600) return { key: 'gm.ago_min', n: Math.floor(s / 60) };
  if (s < 172_800) return { key: 'gm.ago_h', n: Math.floor(s / 3600) };
  return { key: 'gm.ago_d', n: Math.floor(s / 86_400) };
}

const OCTET = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4 = new RegExp(`^${OCTET}(\\.${OCTET}){3}$`);
export const DROIDCAM_PORT = 4747;

/** "192.168.11.73" or "192.168.11.73:4747" → host and port; null when malformed. */
export function parseHostPort(input: string): { host: string; port: number } | null {
  const [host, port, ...rest] = input.trim().split(':');
  if (rest.length || !IPV4.test(host)) return null;
  if (port === undefined) return { host, port: DROIDCAM_PORT };
  const n = /^\d{1,5}$/.test(port) ? Number(port) : 0;
  return n >= 1 && n <= 65535 ? { host, port: n } : null;
}

export const PIN_RE = /^[0-9]{6,8}$/;
export const TOKEN_ALPHABET = 'ACDEFHJKLMNPQRTUVWXY';
const TOKEN_RE = new RegExp(`^[${TOKEN_ALPHABET}]{8}$`);

/** Upper-cases the setup token and drops spaces and dashes people copy along with it. */
export function normalizeToken(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '');
}

export function validToken(token: string): boolean {
  return TOKEN_RE.test(token);
}

/** Digits only, at most 8. */
export function pinInput(input: string): string {
  return input.replace(/\D/g, '').slice(0, 8);
}
