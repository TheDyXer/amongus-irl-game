import type { ActMsg, ClientContract, EventMsg, ScreenView, ServerContract, Settings, StateMsg } from './types.gen';

export type * from './types.gen';

/** Any view the server can push on /ws (discriminated on `kind`). */
export type View = StateMsg['v'];
/** The per-view payload of a paired screen (discriminated on `view`). */
export type ScreenBody = ScreenView['body'];
/** Any JSON message the server sends on /ws (discriminated on `t`). */
export type ServerMsg = ServerContract['ws'];
/** Any JSON message a client sends on /ws (discriminated on `t`). */
export type ClientMsg = ClientContract['ws'];
/** Any action a client can send inside `{t: "act", a}` (discriminated on `type`). */
export type Action = ActMsg['a'];
/** Any one-shot event (discriminated on `type`); clients ignore unknown types. */
export type ServerEvent = EventMsg['e'];
export type ViewName = ScreenBody['view'];
export type Lang = Settings['lang'];

/** Header of every binary message on /ws/cams (docs/CONTRACT.md §5). */
export const FRAME_VERSION = 1;
export const FRAME_HEADER_BYTES = 12;

export interface CamFrame {
  slot: number;
  /** Assignment generation of the slot; frames whose gen differs from the tile's are dropped. */
  gen: number;
  /** Per-slot monotonic counter; never draw a seq at or below the last drawn one. */
  seq: number;
  /** How old the frame was when the server sent it, in ms. */
  ageMs: number;
  jpeg: Blob;
}

/** Parses one binary /ws/cams message; returns null for anything malformed. */
export function parseCamFrame(data: ArrayBuffer): CamFrame | null {
  if (data.byteLength <= FRAME_HEADER_BYTES) return null;
  const head = new DataView(data, 0, FRAME_HEADER_BYTES);
  if (head.getUint8(0) !== FRAME_VERSION) return null;
  const slot = head.getUint8(1);
  if (slot < 1 || slot > 4) return null;
  return {
    slot,
    gen: head.getUint16(2),
    seq: head.getUint32(4),
    ageMs: head.getUint32(8),
    jpeg: new Blob([new Uint8Array(data, FRAME_HEADER_BYTES)], { type: 'image/jpeg' }),
  };
}
