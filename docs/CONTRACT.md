# Among Us IRL — Phase 1 contract v2 (cams, pairing, GM setup)

The single source of truth every module is built against. v2 folds in a four-lens review
(security, realtime, plan fit, buildability; 73 findings). The approved plan is
`C:\Users\User\.claude\plans\make-me-a-amongus-cheeky-jellyfish.md`; the approved look is in
`design/mockups/` (`Main.dc.html` Security monitor, `Spectator.dc.html`, `GM.dc.html`, …).
Phase 2 (game) and Phase 3 (tasks) extend this contract; nothing here may block them.
Wire shapes are the Pydantic models in `backend/app/models.py` (TS mirror generated into
`frontend/src/api/types.gen.ts`; aliases in `frontend/src/api/types.ts`). Where prose and
models disagree, fix the prose and tell the integrator.

---------------------------------------------------------------------------------------------
## 1. Runtime

- Exactly **one** process, one worker, no `--reload` in Docker: pending pairings, sockets, frame
  buffers and torch state live in memory. `main.py` refuses to start the relay when
  `WEB_CONCURRENCY` > 1.
- Command (Docker and dev):
  `uvicorn app.main:app --host 0.0.0.0 --port 8740 --workers 1 --ws websockets-sansio
  --ws-per-message-deflate false --ws-max-size 65536 --no-proxy-headers
  --timeout-graceful-shutdown 5` (flags not supported by the installed uvicorn are dropped by
  Deploy after checking `uvicorn --help`; compression must be off: JPEG frames don't compress
  and deflate costs CPU per frame).
- Docker uses `network_mode: host` (mDNS + real client IPs). Plain `http://` on the LAN.
- Static SPA served by the same process: `StaticFiles(config.static_dir)` + catch-all that
  returns `index.html` for GET paths not matching `^/(api|ws|cam)(/|$)`.
- `AUI_RELAY_MODE`: `real` (browse `_droidcamobs._tcp`), `fake` (browse `_auifakecam._tcp`, the
  service type the fake camera advertises by default), `off` (no discovery; manual phones only).
  Default `fake` when unset; compose sets `real`. Shown in `GmView.server.relay_mode`. This stops a
  dev server on the PC from stealing the real phones' single video slot.
- Time: every duration/threshold uses the injected `Clock.monotonic()`; wall clock (`Clock.time()`)
  only for persisted timestamps and wire timestamps. Wire timestamps are **epoch milliseconds**
  (`*_at`). Every `state` and `pong` message carries `now` (server epoch ms) so clients compute
  ages and countdowns locally; ages are never pushed as they tick.
- Dev Python 3.13 (venv); server image Python 3.12 — no 3.13+ only syntax.

---------------------------------------------------------------------------------------------
## 2. Principals, auth and live enforcement

### Principals and cookies

| Principal | Established by | Cookie | Attributes |
|---|---|---|---|
| device (screen/station) | pairing approved by the GM | `aui_dev` | HttpOnly, SameSite=Lax, Path=/, Max-Age 1 year |
| gm | PIN login | `aui_gm` | HttpOnly, **SameSite=Strict**, Path=/, Max-Age 24 h |
| player (Phase 2) | join flow | `aui_player` | reserved |

- Tokens: `secrets.token_urlsafe(32)`; only `sha256(token)` is stored. `device.id` is a separate
  `secrets.token_hex(8)` (never derived from the token). GM sessions have their own id
  (`token_hex(8)`) for listing/logout.
- Role selection: `/ws` and `/ws/cams` take `?as=gm|device|player`; the page decides (§8
  routing). `as=gm` needs a valid GM session, `as=device` a known device cookie; there is **no
  fallback** to another role. Missing/invalid → the connection is `anon` (/ws) or rejected (/ws/cams).

### Origin and request checks (CSRF / cross-site WebSocket hijacking)

- For `/ws`, `/ws/cams` and every non-GET `/api/*`: `Origin` must be present and equal
  `http://<Host header>`, and the Host's hostname must be `localhost`, `127.0.0.1`, a private
  IPv4 literal (10/8, 172.16/12, 192.168/16) or listed in `AUI_ALLOWED_HOSTS`. Extra dev origins
  (Vite on `http://127.0.0.1:5173`) come from `AUI_ALLOWED_ORIGINS`. Failing WS handshakes are
  rejected **before accept** (HTTP 403); failing POSTs get 403 `{"detail":"err.bad_origin"}`.
- Non-GET `/api/*` bodies must be `Content-Type: application/json`.

### Pairing (screens and stations)

- The GM opens a **pairing window** (`set_pairing_open {open: true, seconds ≤ 300}`); it is closed
  by default and closes itself at `pairing_open_until`.
- A device page (`/`) calls `POST /api/pair/start`:
  - window closed → `{"status":"closed"}` (the page shows "Ask the game master to open pairing"
    and re-polls every 3 s; no input needed);
  - window open → creates or reuses one pending request for this cookie → `{"status":"pending",
    "code", "expires_at"}`; while its `/ws` stays connected the server keeps the code alive
    (renews `expires_at`) until approved, rejected or the window closes;
  - already paired → `{"status":"paired", "view", "name"}`.
- Code: 4 letters from `ACDEFHJKLMNPQRTUVWXY`, unique among pending, generated with ≤ 50 tries.
- Caps: 8 pending in total; 1 per cookie and 1 per client IP (a new request from the same IP
  replaces the old one); `POST /api/pair/start` ≤ 10/min per IP (429 `err.rate_limited`).
  `user_agent` is stored truncated to 120 chars; the GM sees a short `hint` derived from it
  ("Android TV", "Android phone", "Windows PC", "iPhone", "Mac", "Linux PC", "Browser").
- The GM approves a specific code (`approve_pairing {code, view, name?}`); `name` defaults to the
  localized view label + ordinal ("Security 1"). Rejecting blocks that cookie/IP until the window
  closes. Approval records the device's address; later connections from a different address set
  `DeviceInfo.address_changed` (a warning, not a lockout).
- State machine per device cookie: `unpaired → pending(code) → paired`; `pending → closed` when
  the window closes or on reject; `paired → unpaired` on revoke (the page falls back to pairing).

### GM PIN

- PIN: 6–8 ASCII digits (`^[0-9]{6,8}$`).
- First run: when no PIN exists the server generates a one-time **setup token** (8 chars from the
  pairing alphabet), writes it to `$DATA_DIR/setup-token` and logs it. `POST /api/gm/setup
  {pin, setup_token}` sets the PIN (atomic: single-row table + `asyncio.Lock`), deletes the token
  file and logs in. `deploy.py` prints the token after a fresh deploy. Recovery:
  `python -m app.admin set-pin` (inside the container) resets the PIN and deletes all GM sessions.
- Login limits (checked **before** argon2, which runs in a thread): 5 failures/min per IP → 429;
  10 failures in 10 min overall → login locked for everyone for 5 min (`GmStatus.locked_until`).
  Failures (count, last time, addresses) show in `GmView.login_failures`.
- `change_pin {old, new}` deletes every other GM session and closes their sockets.
  `logout_sessions` logs out every other session. `GmView.sessions` lists sessions (address, hint,
  last seen, current).
- Never log in as GM on a kiosk device (documented in the setup notes).

### Live enforcement (open sockets)

- The hub registers every socket as a `Conn` under its principal. Any change that affects a
  principal — approve, reject, revoke, `update_device` (view), GM logout/`logout_sessions`/
  `change_pin`, session expiry, `cams_enabled` — calls `hub.reauth(...)` in the same event-loop
  tick, which re-resolves the role of matching `/ws` sockets (and pushes their new view) and closes
  `/ws/cams` sockets that are no longer entitled, purging their pending frames.
- One live `/ws` and one `/ws/cams` per device id or GM session: a newer connection closes the
  older with **4409** (the older tab shows "opened elsewhere" and does not reconnect).
- Close codes: `1001`/`1012` server going away/restart (reconnect with backoff); `4401` not
  authenticated for the requested role (don't reconnect; GM page goes to login); `4403` not
  allowed (e.g. cams for a comms station; don't reconnect until `/ws` state changes); `4400`
  malformed message; `4408` heartbeat timeout; `4409` replaced by a newer connection;
  `1008` rate limit exceeded.
- A revoked device's `/ws` is not closed: it receives `PairingView {status: "closed"}` and the page
  starts pairing again.

### Authorization matrix

| Capability | security device | spectator device | comms/emergency device | GM | anon |
|---|---|---|---|---|---|
| `/ws` view | ScreenView (security body) | ScreenView (spectator body) | ScreenView (placeholder body) | GmView | HelloView / PairingView |
| `/ws/cams` frames | **only while "using"** (see §4) | yes | no (4403) | yes | no (4401) |
| actions | `use_open`, `use_close` | none | none (Phase 2 adds theirs) | all GM actions | none |
| `/cam/{slot}.mjpg` | no | no | no | yes | no |

Actions are validated against the sender's role (device actions per view, GM actions); anything
else → `ErrorMsg {code: "err.forbidden"}` (counted toward the rate limit), socket stays open.

---------------------------------------------------------------------------------------------
## 3. HTTP endpoints

Errors: `{"detail": "<err.* code>"}` with a 4xx status. All POST bodies JSON (see §2 checks).

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /api/health` | none | `Health {ok, version}` |
| `GET /api/public` | none | `PublicInfo {lang, volume}` for pre-state screens |
| `POST /api/pair/start` | none | ensure `aui_dev`; returns `PairStatus` (§2 pairing) |
| `GET /api/pair/status` | none | `PairStatus` for the cookie |
| `GET /api/gm/status` | none | `GmStatus {pin_set, logged_in, locked_until, lang}` |
| `POST /api/gm/setup` `SetupBody {pin, setup_token}` | none, only while no PIN | 409 `err.pin_exists`, 403 `err.bad_setup_token` |
| `POST /api/gm/login` `PinBody {pin}` | none | 401 `err.pin_wrong`, 429 `err.rate_limited`/`err.login_locked` |
| `POST /api/gm/logout` | GM | ends this session |
| `GET /cam/{slot}.mjpg` | GM | debug MJPEG re-stream of the slot's buffer (never contacts the phone) |
| `GET /*` | none | SPA |

---------------------------------------------------------------------------------------------
## 4. WebSocket `/ws` — state and actions (JSON text)

- Server → client (models `ServerMsg`):
  - `{"t":"state","now":<ms>,"v":<View>}` — the full view for this client: on connect and after
    every change. Coalesced per client: leading-edge send, then at most one trailing send per
    50 ms, rendered at send time, and only when the JSON differs from the last one sent.
  - `{"t":"event","e":<Event>}` — losable one-shot cues only. Pending state is flushed before an
    event, so state always precedes its event. Clients ignore unknown event types.
  - `{"t":"error","code":"err.*","ref":<act id>|null}` — a rejected action (i18n key).
  - `{"t":"pong","now":<ms>}`.
- Client → server (`ClientMsg`): `{"t":"act","id"?:str,"a":<Action>}` (the server echoes `id` as
  `ref` on errors); `{"t":"ping"}` every 20 s. No ping for 45 s → close 4408. Anonymous sockets
  are closed after 30 s idle.
- **State vs events rule:** anything that must survive a reconnect lives in the view (timestamps
  such as `ends_at`, `pairing_open_until`); events are for sounds/vibration/toasts only.
- Reconnect (clients): exponential 0.5 → 8 s with ±30 % jitter, reset after 10 s connected;
  after reconnect a Security station whose monitor is open re-sends `use_open`.

### Views (`kind`)

- `hello` (anon; carries `lang`), `pairing` (`status: closed|pending`, `code`, `expires_at`,
  `lang`), `screen`, `gm`.
- `ScreenView`: `device {id, name, view, max_fps, low_motion}`, `lang`, `volume`, and `body`
  discriminated on `view`:
  - `security`: `monitor`, `watching`, `using` (this station's own open state as the server sees it);
  - `spectator`: `monitor`, `watching`;
  - `comms`, `emergency`: empty placeholders in Phase 1 (rendered "coming soon").
- `Monitor`: `mode: cams | cams_off | comms_down | meeting` (Phase 1 emits `cams` and
  `cams_off`), `tiles: CamTile[]`, `ends_at` (meeting countdown, Phase 2). `CamTile {slot, gen,
  room, status: live|lost}` — one per assigned camera whose signal is live or lost, slot order;
  `room` upper-cased; empty room = no plate. No tiles when `mode != cams`.
- `GmView`: `settings`, `cams` (always 4 `CamSlot`, slot order), `phones`, `devices`, `pending`,
  `pairing_open_until`, `watching`, `sessions`, `login_failures`, `notices`, `server {address,
  version, relay_mode}`.
- Nothing in any view changes per video frame. GM telemetry (`fps`, `last_frame_at`, battery,
  online flags) is refreshed on a 1 s tick and pushed only when a rounded value changes
  (fps to 0.5).

### "Using", watching and the torch

- A Security station is **using** while its `/ws` connection has sent `use_open` (also a
  keepalive: the client re-sends it every 30 s while the monitor is open) and not `use_close`.
  Using ends on `use_close`, `/ws` disconnect, revoke, a view change away from `security`, or
  75 s without a `use_open`. `use_*` is debounced to ≤ 2 per second per device.
- Frames reach a Security station's `/ws/cams` only while it is using; when using ends, the
  server drops its subscription (as if `sub(slots=[])`).
- `watching` = any device currently using; forced false while `cams_enabled` is false (Phase 2:
  also during meetings and comms sabotage). Watching turns off 1 s after the last user stops
  (debounce), and starts at once.

### Actions (`type`)

- Device (view `security`): `use_open`, `use_close`.
- GM: `assign_cam {slot, phone_id}` (a phone already in another slot moves; that slot empties),
  `unassign_cam {slot}`, `set_room {slot, room}` (allowed on empty slots),
  `add_manual_phone {host, port, slot?}` (host must be an IPv4 literal inside `AUI_LAN_CIDR`,
  not loopback/link-local/the server/the gateway; deduped against known endpoints; in
  `relay_mode` `fake` or `off`, `127.0.0.1` is also allowed so tests and dev can use
  `FakeDroidCam`),
  `forget_phone {phone_id}` (unassigns first), `set_pairing_open {open, seconds}`,
  `approve_pairing {code, view, name?}`, `reject_pairing {code}`, `revoke_device {device_id}`,
  `update_device {device_id, name?, view?, max_fps?, low_motion?}` (all-null = no-op),
  `set_settings {lang?, volume?, cams_enabled?, torch_blink?}`, `test_torch {slot}`,
  `torch_fix {slot}` (one toggle, to repair a torch that ended in the wrong state),
  `change_pin {old, new}`, `logout_sessions {}`, `dismiss_notice {id}`.

### Events (`type`)

- `paired {view}` — sent to a device right after approval (it may play a chime).
- `toast {code, params}` — transient GM notice (e.g. `gm.toast.pairing_closed`).
- Phase 2 adds sound/alarm events; clients ignore unknown types.

---------------------------------------------------------------------------------------------
## 5. WebSocket `/ws/cams` — video frames

- Auth: `?as=device` (view `security` while using, or `spectator`) or `?as=gm`. Rejected before
  accept otherwise (403/4401/4403 per §2). One per principal (4409 on replacement).
- Client → server text: `{"t":"sub","slots":[…],"fps":N}` (`CamSub`); slots deduplicated;
  `[]` pauses. Re-sent after every reconnect. Malformed → close 4400.
- Server → client text: `{"t":"hb","now":<ms>}` every 5 s. The client treats 12 s without any
  message as a dead socket and reconnects (same backoff as `/ws`).
- Server → client binary, one message per frame:
  `version u8 = 1 | slot u8 | gen u16 BE | seq u32 BE | age_ms u32 BE | JPEG bytes` (12-byte
  header). `gen` = the slot's assignment generation (bumped on assign/unassign/move/
  cams_enabled change); `seq` = per-slot monotonic counter (never resets); `age_ms` = server
  monotonic now − frame receive time, computed at send time.
- Server pacing (one sender task per connection): per slot keep only the latest unsent frame
  (overwritten, never queued); effective fps = `min(requested, device.max_fps (GM: requested),
  source)`, re-read live on every send decision; deadline pacing (`next_due += 1/fps`, resync if
  more than one interval behind); slots served round-robin; never send a frame older than 2 s or
  the same (gen, seq) twice; on a new `sub`, immediately send each subscribed slot's latest frame
  if it is < 2 s old. The relay never awaits a client; a client blocked in `send` for > 10 s is
  closed.
- Defaults: kiosks request 30 and are capped by `device.max_fps` (default **15**; GM can set
  5/10/15/20/30 per device); GM console thumbnails request 5 (an enlarged tile 30).
- Client decode rules (api/cams.ts): per slot at most one `createImageBitmap` in flight; while it
  runs keep only the newest pending blob; drop frames whose `gen` ≠ the tile's gen or whose `seq`
  ≤ last drawn; draw in `requestAnimationFrame`; `close()` replaced bitmaps; skip decoding while
  `document.hidden` or for slots without a tile; canvas backing store ≤ min(CSS size × DPR,
  960 × 720); build the blob from `new Uint8Array(buf, 12)` (no copy). If a tile the server says is
  `live` has had no frame on this client for 3 s, draw static locally (the window stays; only the
  server's tile status closes windows).
- Bandwidth budget (to verify in the Phase 1 gate): one 640×480 MJPEG frame ≈ 30–45 KB; 4 cams ×
  15 fps ≈ 16–22 Mbit/s per kiosk screen; at 30 fps double that. Phones upstream ≈ 4 × 8–11
  Mbit/s at 25–30 fps.

---------------------------------------------------------------------------------------------
## 6. Cameras

### DroidCam facts (current app "DroidCam Webcam & OBS Camera")

- Video: `GET http://<ip>:<port>/video/640x480` → `multipart/x-mixed-replace; boundary=…`
  (observed `--dcmjpeg`; parse the boundary with a MIME parser, strip quotes and a leading `--`).
- **One video client per phone.** A second client gets HTTP 200 `text/html` containing
  `droidcam_busy` ("DroidCam is Busy").
- Control calls (separate connections, don't take the video slot; best-effort; paths drift):
  `GET /v1/phone/name`, `GET /v1/phone/battery_info` (`level`, `amps` > 0 ⇒ charging),
  `GET /v1/camera/info` (may expose torch state), `PUT /v1/camera/torch_toggle`. HTTP 550 = needs
  Pro. 2 s timeout, responses capped at 16 KB, never raise, never copy response bodies into state.
- mDNS: `_droidcamobs._tcp.local.`; the instance name identifies the phone (ask players to give
  camera phones unique device names; duplicates get `#2` suffixes).

### Phones, endpoints and slots — the one-connection invariant

- Phone ids: `mdns:<instance>` (discovered) or `ip:<host>:<port>` (manual). A phone is in at most
  one slot; 4 slots.
- **Relays belong to phones, keyed by endpoint (`host:port`)**, never by slot. The manager keeps
  at most one relay per endpoint, guarded by a per-endpoint `asyncio.Lock`; before any new video
  connection to an endpoint, the previous one is fully closed (task cancelled and awaited, stream
  context exited). Moving a phone between slots **re-binds** its relay to the new slot's frame
  buffer without reconnecting. Adding a manual phone whose endpoint belongs to another phone id
  merges into that phone.
- Address changes (mDNS): only IPv4 in `AUI_LAN_CIDR` is used; if the current address is still
  advertised it stays; a new address is applied on the next (re)connect, never interrupting a
  live stream; a failed connection switches to the newest address immediately; each move adds a
  GM notice (`gm.notice.cam_moved`). mDNS removal only affects `online`
  (= seen in the last 120 s **or** relay streaming); it never stops a relay. While any assigned
  phone lacks a fresh resolution, re-query every 30 s.

### Relay (one per assigned phone, only while `cams_enabled`)

- Dedicated `httpx.AsyncClient` per relay for video (`max_connections=1`, no keep-alive reuse);
  one shared control client (keep-alive) for control calls. Timeouts: connect 3 s, read 5 s, pool 1 s.
- Check status and `Content-Type` before parsing: `text/html` → read ≤ 4 KB, busy if it contains
  `droidcam_busy`; non-200 or unexpected type → link `backoff` with an error code.
- Parser (`MjpegParser`): bytearray + `find`; prefer `Content-Length`, else the next boundary
  marks the end; accept a part only if it starts `FFD8` and ends `FFD9`; resync on the next
  boundary otherwise; cap 1 MiB per part and 2 MiB buffered (reset + count an error).
- Frame watchdog: no complete JPEG for 5 s → close and reconnect.
- Backoff 1, 2, 4, 8, 10, 10… s; reset only after 10 s of continuous frames.
- Busy right after our own previous stream (within 30 s) is self-inflicted: stay `connecting`
  (`err.cam_releasing`), retry every 1.5 s. Busy on a fresh connect, or for > 30 s: link `busy`
  (`err.cam_busy`, a prominent GM alert: "another app is connected to CAM n"), retry every 2 s.
- Name: after the first good stream, fetch `/v1/phone/name` once (best effort).
- Battery: every 60 s while assigned.

### Status model

- `CamSlot.link` (GM only): `idle` (no phone) | `disabled` (cams off) | `connecting` |
  `streaming` | `busy` | `backoff`.
- `CamSlot.signal` and tile status: pure function of frame age (manager, 250 ms tick):
  age < 2 s → `live`; 2–12 s → `lost`; else `offline`. Hysteresis: `lost → live` needs 2 frames
  within 1 s; a tile stays `lost` ≥ 1 s; `offline → live` needs 2 s of steady frames before the
  window re-opens. Unassign, move and cams-off remove the tile immediately (no lost phase).
- Tiles are pushed only when the set `(slot, gen, room, status)` changes; all screens therefore
  switch within one coalescing window.
- Static hiss is client-side (Security stations only, once per live→lost edge per slot, ≤ 1 per
  5 s).

### Torch (the watching light) — one actor per phone

- One task per assigned phone fed by a queue of intents (`blink_on`, `blink_off`, `test`, `fix`,
  `force_off`); never two toggles at once; an in-flight toggle is shielded and allowed to finish
  (2 s timeout). Track `assumed_on`; on a timeout or unknown outcome mark `torch_state: unknown`
  and stop driving that phone until `test_torch`/`torch_fix`. If `/v1/camera/info` exposes the
  torch state on real phones, use it to resync (verify in the Phase 1 gate). Persist
  `assumed_on` so startup can correct a torch left on.
- Blink: toggle every 500 ms while `watching` and `torch_blink` and capability not in
  {`pro_required`, `unsupported`}; when blinking stops, end off. Capability: `unknown` until
  probed; probe with an on/off pair at assign time (not during a game); HTTP 550 →
  `pro_required`; other failures → `unsupported`; 2xx → `ready`. `test_torch` = on/off 300 ms
  apart, ignored while blinking.
- Teardown order (unassign, cams off, shutdown): stop blinking → torch off → close video.

### Shutdown (lifespan exit, bounded ~5 s)

Stop blinking and force torches off (≤ 2 s) → close all sockets with 1012 → end mjpg generators →
cancel relays (responses closed) → close HTTP clients → close storage.

---------------------------------------------------------------------------------------------
## 7. Settings

`Settings {lang: en|hu = en, volume 0–100 = 70, cams_enabled = true, torch_blink = true}`,
stored in SQLite, included in `GmView` and (lang, volume) in `ScreenView`/`HelloView`/`PairingView`.

---------------------------------------------------------------------------------------------
## 8. Front end

### Routing (by path, then by the server's view)

| Path | Role | Behaviour |
|---|---|---|
| `/` | device | `POST /api/pair/start`, connect `?as=device`; render by `view.kind`: pairing → Pairing, screen → by `body.view` (security, spectator, comms/emergency → ComingSoon) |
| `/gm`, `/gm/*` | gm | `GET /api/gm/status` → setup (PIN + setup token) or login → connect `?as=gm` → GM console |
| `/join`, `/play`, `/b/*`, `/t/*` | player | reserved for Phase 2 (render a "coming soon" page now) |

Only `/` calls `/api/pair/start`. The GM's language setting drives every screen (`view.lang`).

### Kiosk screens

- A full-screen **TAP TO START** overlay: an autofocused `<button>` (click, Enter and TV-remote OK
  all work); the tap unlocks audio and requests fullscreen (failure ignored). The Pairing screen
  has no interactive elements: a huge code, auto-renewing, re-polling when closed.
- Security: idle Security-room art + USE button → monitor opens (bg fade 0.25 s + power-on sweep
  0.25 s; close sweep 0.1 s + fade 0.3 s) → sends `use_open` (and every 30 s) and subscribes the
  tiles' slots on `/ws/cams`; ✕ → `use_close` + `sub []`. No input for 90 s → "STILL WATCHING?"
  → closes 10 s later. Open/close blips are local sounds.
- Spectator: the same monitor, always open; never sends `use_*`.
- `device.low_motion` (GM toggle per device, e.g. for the TV): no drifting starfield, lamp blinks
  without transitions, static texture animates at a lower rate; animations use only `transform`
  and `opacity`.

### Monitor component

- Props: `monitor` (mode + tiles), `watching`, `lowMotion`, `lang`.
- Layout from `monitor/layout.ts` `layoutFor(n)`: 0 = housing with a "NO SIGNAL" plate;
  1 = full; 2 = side by side; 3 = two on top + one centred below; 4 = 2×2 (4-col × 2-row grid whose
  gaps are the steel dividers, exactly like `design/mockups/Main.dc.html`).
- `lost` tile → TV static (`/static.png`) + flashing "SIGNAL LOST"; `cams_off` → "CAMERAS OFF"
  plate; `comms_down` → every tile static + flashing red "[COMMS DISABLED]"; `meeting` → dark
  "MEETING IN PROGRESS" + countdown to `ends_at` (the last two are built now, emitted in Phase 2).
- Room plate top-left (≥ 8 px padding), `CAM n` bottom-left on a plate, blinking red lamp on the
  housing while `watching`.

### GM console (`design/mockups/GM.dc.html`, Setup tab; the Live tab is Phase 2)

- Cameras: 4 slot cards — status pills from `link`/`signal`, a live thumbnail (`CamCanvas` at 5 fps),
  device name, IP, battery, torch capability + test/fix buttons, room-plate input, assign from
  known phones, manual IP (+ optional slot), unassign, forget.
- Screens: pairing window button with countdown; pending requests as a stable list (code, address,
  hint) with approve-as-view buttons (name optional) and reject; paired devices with rename,
  view, max fps, low motion, revoke, address-changed warning, online state.
- Settings: EN/HU, volume, cams on/off, torch blink. Security: change PIN, sessions + "log out
  others", login failures. Notices list with dismiss. Server info (address, version, relay mode).
- Every server-supplied string is rendered as React text only (never innerHTML/style/url).

### Theme, sound, i18n

- Fonts via `@fontsource/*` (latin + latin-ext subsets). Luckiest Guy has no latin-ext: Hungarian
  strings rendered in it fall back to Lilita One (a unit test checks glyph coverage of every
  en/hu string against each font's subsets).
- Padding ≥ 8 px inside any bordered or filled container; wide letter-spacing only on short
  uppercase labels; no coloured glows, gradient washes, left-border accent cards or emoji.
- Sounds are synthesized with WebAudio (no files). Phase 1: `open`, `close`, `static` (local only),
  `paired` (on the `paired` event). Master volume from `view.volume`.
- i18n: `src/i18n/<lang>/<ns>.json` for ns ∈ {common, monitor, pairing, gm, errors}; flat keys
  `<ns>.<key>`; `{name}` interpolation; plurals `key_one`/`key_other` via `Intl.PluralRules`;
  parity test per file. Server texts are only `err.*`/`gm.notice.*`/`gm.toast.*` codes.

---------------------------------------------------------------------------------------------
## 9. Limits

| Limit | Value |
|---|---|
| WS message size (client → server) | 64 KiB (`--ws-max-size 65536`) |
| Sockets per client IP / total | 8 / 64 |
| `/ws` + `/ws/cams` per device id or GM session | 1 each (newer replaces older, 4409) |
| Client messages per socket | 20/s (close 1008) |
| `/ws` heartbeat | client ping 20 s; server closes after 45 s silence (4408) |
| `/ws/cams` heartbeat | server `hb` every 5 s; client reconnects after 12 s silence |
| Anonymous `/ws` idle | 30 s |
| Blocked send | close after 10 s |
| Pending pairings | 8 total, 1 per cookie, 1 per IP |
| `/api/pair/start` | 10/min per IP |
| GM login | 5 failures/min per IP; 10 per 10 min global → 5 min lock |
| MJPEG part / buffer | 1 MiB / 2 MiB |
| Control call | 2 s timeout, 16 KiB response |
| Strings | room ≤ 16, device name ≤ 24, phone name ≤ 32, user agent ≤ 120, hint ≤ 24 |

---------------------------------------------------------------------------------------------
## 10. Internal interfaces (backend) — build against these exactly

```python
# app/clock.py (Core)                         # test seam: every loop sleeps via clock.sleep
class Clock(Protocol):
    def monotonic(self) -> float: ...
    def time(self) -> float: ...
    async def sleep(self, seconds: float) -> None: ...
class SystemClock(Clock): ...
class FakeClock(Clock): def advance(self, seconds: float) -> None  # wakes sleepers whose deadline passed

# app/config.py (Core)
class Config(BaseSettings):  # env_prefix="AUI_"; tests construct Config(...) directly
    data_dir: Path; static_dir: Path; public_address: str = ""   # "" = auto (UDP route trick)
    relay_mode: Literal["real", "fake", "off"] = "fake"
    lan_cidr: str = "192.168.11.0/24"; allowed_hosts: list[str] = []; allowed_origins: list[str] = []
    video_size: str = "640x480"; version: str = app.__version__
    # timings (seconds): cam_connect_timeout=3, cam_read_timeout=5, frame_watchdog_s=5,
    # live_s=2, lost_grace_s=10, busy_retry_s=2, self_busy_window_s=30, backoff=(1,2,4,8,10),
    # battery_poll_s=60, torch_period_s=0.5, coalesce_s=0.05, gm_tick_s=1, status_tick_s=0.25,
    # pairing_ttl_s=600, pairing_window_max_s=300, use_timeout_s=75, ws_ping_timeout_s=45
def get_config() -> Config  # cached

# app/errors.py (Core, frozen)
class ActionError(Exception):
    def __init__(self, code: str, **params: str) -> None   # code is an err.* i18n key

# app/storage.py (Core) — one sqlite3 connection, WAL, PRAGMA user_version migrations
MIGRATIONS: list[str]                        # Phase 2/3 append, never edit
@dataclass class DeviceRow: id, token_hash, name, view, max_fps, low_motion, created_at, last_seen_at, address
@dataclass class PhoneRow: id, name, host, port, manual
@dataclass class SlotRow: slot, phone_id | None, room
class Storage:
    @classmethod
    def open(cls, path: Path) -> "Storage"; def close(self) -> None
    def get_settings(self) -> Settings; def update_settings(self, **fields) -> Settings
    def get_pin_hash(self) -> str | None; def set_pin_hash_if_absent(self, h: str) -> bool; def set_pin_hash(self, h: str) -> None
    def add_gm_session(self, id, token_hash, expires_at, address, user_agent) -> None
    def gm_session(self, token_hash, now) -> GmSessionRow | None; def touch_gm_session(self, id, now) -> None
    def list_gm_sessions(self, now) -> list[GmSessionRow]; def delete_gm_session(self, id) -> None; def delete_gm_sessions_except(self, id) -> list[str]
    def add_device(self, row: DeviceRow) -> None; def device_by_token_hash(self, h) -> DeviceRow | None
    def update_device(self, id, **fields) -> DeviceRow | None; def delete_device(self, id) -> None; def list_devices(self) -> list[DeviceRow]
    def list_slots(self) -> list[SlotRow]      # always 4
    def save_slot(self, slot, phone_id, room) -> None
    def list_phones(self) -> list[PhoneRow]; def upsert_phone(self, row: PhoneRow) -> None; def delete_phone(self, id) -> None
    def get_torch_on(self, phone_id) -> bool; def set_torch_on(self, phone_id, on: bool) -> None
# timestamps stored as wall-clock epoch seconds (float)

# app/auth.py (Core)
COOKIE_DEVICE = "aui_dev"; COOKIE_GM = "aui_gm"
def new_token() -> str; def hash_token(token: str) -> str
class PairingBook:                            # in memory
    def open_window(self, seconds, now_mono) -> None; def close_window(self) -> None
    def window_until(self, now_mono) -> float | None
    def start(self, token_hash, address, user_agent, now_mono) -> PairStatus-like result  # enforces caps
    def keep_alive(self, token_hash, now_mono) -> None; def by_code(self, code) -> Pending | None
    def take(self, code) -> Pending; def reject(self, code) -> None; def expire(self, now_mono) -> bool; def pending(self) -> list[Pending]
class Auth:
    def __init__(self, storage: Storage, config: Config, clock: Clock)
    pairing: PairingBook
    def device_for_token(self, token: str | None) -> DeviceRow | None
    def gm_session_for_token(self, token: str | None) -> GmSessionRow | None
    async def setup_pin(self, pin, setup_token, address, user_agent) -> tuple[str, GmSessionRow]
    async def login(self, pin, address, user_agent) -> tuple[str, GmSessionRow]   # raises ActionError err.pin_wrong/err.rate_limited/err.login_locked
    def logout(self, session_id) -> None; async def change_pin(self, session_id, old, new) -> list[str]  # returns ended session ids
    def approve(self, code, view, name | None) -> DeviceRow; def login_failures(self) -> LoginFailures
    def setup_token(self) -> str | None       # created at startup when no PIN exists

# app/cams/buffer.py (Camera I/O)
@dataclass(frozen=True) class Frame: jpeg: bytes; seq: int; gen: int; t: float   # t = clock.monotonic() at receipt
class FrameBuffer:                            # one per slot, lives for the whole process
    slot: int; gen: int; latest: Frame | None
    def publish(self, jpeg: bytes) -> None    # seq += 1 (never resets); wakes waiters; never awaits
    def bump_gen(self) -> None                # clears latest; wakes waiters
    def add_listener(self, cb: Callable[[Frame], None]) -> Callable[[], None]   # sync callbacks for ws senders
    async def wait_newer(self, seq: int, timeout: float) -> Frame | None

# app/cams/mjpeg.py (Camera I/O)
def parse_boundary(content_type: str) -> bytes | None
def is_busy_page(content_type: str, first_bytes: bytes) -> bool
class MjpegParser:
    def __init__(self, boundary: bytes | None, max_part: int = 1 << 20, max_buffer: int = 2 << 20)
    def feed(self, chunk: bytes) -> list[bytes]   # complete JPEGs only
    errors: int

# app/cams/droidcam.py (Camera I/O) — best effort, 2 s timeout, never raise
async def phone_name(client, host, port) -> str | None
async def battery(client, host, port) -> Battery | None
async def torch_toggle(client, host, port) -> Literal["ok", "pro_required", "unsupported", "timeout"]
async def torch_state(client, host, port) -> bool | None      # from /v1/camera/info when exposed
def video_url(host, port, size) -> httpx.URL                   # built with httpx.URL, never f-strings

# app/cams/relay.py (Camera I/O)
LinkState = Literal["connecting", "streaming", "busy", "backoff"]
class PhoneRelay:                              # ONE per endpoint; owns the only video connection
    def __init__(self, phone_id: str, host: str, port: int, *, clock: Clock, config: Config,
                 client_factory: Callable[[], httpx.AsyncClient], on_link: Callable[[str, LinkState, str | None], None])
    def bind(self, buffer: FrameBuffer | None) -> None      # re-point output; no reconnect
    def start(self) -> None                                  # spawns its task
    async def retarget(self, host: str, port: int) -> None   # applied on next (re)connect unless link is down: then now
    async def stop(self) -> None                             # cancel + await; the stream is closed when this returns
    link: LinkState; error: str | None; fps: float           # fps = EWMA over 2 s
    last_frame_mono: float | None; phone_name: str | None

# app/cams/fake_droidcam.py (Camera I/O; imported only by tests and tools/fake_droidcam.py; needs Pillow)
class FakeDroidCam:
    def __init__(self, name: str = "Fake 1", fps: int = 15, torch: Literal["ready", "pro", "none"] = "ready",
                 battery: int = 80, service_type: str = "_auifakecam._tcp.local.")
    async def start(self, host: str = "127.0.0.1", port: int = 0, mdns: bool = False) -> int   # returns port
    async def stop(self) -> None
    busy: bool; stalled: bool; torch_on: bool; torch_toggles: int
    video_clients: int; max_concurrent_video_clients: int  # tests assert this never exceeds 1

# app/cams/discovery.py (Discovery + manager)
def phone_from_service(instance: str, addresses: list[str], port: int, lan_cidr: str) -> tuple[str, str, str, int] | None
class Discovery:
    def __init__(self, cams: "CamManager", config: Config, clock: Clock, zc_factory=AsyncZeroconf)
    async def start(self) -> None; async def stop(self) -> None   # calls cams.phone_seen / cams.phone_gone

# app/cams/manager.py (Discovery + manager)
ChangeKind = Literal["tiles", "gm"]
class CamManager:
    def __init__(self, storage: Storage, config: Config, clock: Clock, *,
                 client_factory: Callable[[], httpx.AsyncClient], control_client: httpx.AsyncClient,
                 on_change: Callable[[ChangeKind], None], on_notice: Callable[[str, dict[str, str]], None])
    async def start(self) -> None; async def stop(self) -> None
    # commands (raise ActionError)
    async def assign(self, slot: int, phone_id: str) -> None; async def unassign(self, slot: int) -> None
    async def set_room(self, slot: int, room: str) -> None
    async def add_manual(self, host: str, port: int, slot: int | None) -> str
    async def forget(self, phone_id: str) -> None
    async def test_torch(self, slot: int) -> None; async def torch_fix(self, slot: int) -> None
    async def set_enabled(self, enabled: bool) -> None; def set_torch_blink(self, on: bool) -> None
    def set_watching(self, watching: bool) -> None
    # discovery inputs
    def phone_seen(self, phone_id: str, name: str, host: str, port: int) -> None
    def phone_gone(self, phone_id: str) -> None
    # read side: pure, synchronous, cheap
    def tiles(self) -> list[CamTile]; def slots(self) -> list[CamSlot]; def phones(self) -> list[KnownPhone]
    def buffer(self, slot: int) -> FrameBuffer
def derive_signal(age: float | None, prev: str, ...) -> Literal["live", "lost", "offline"]   # unit-tested, with hysteresis

# app/hub.py (Core)
@dataclass class Conn:
    id: str; ws: WebSocket; kind: Literal["state", "cams"]; role: Literal["anon", "pairing", "device", "gm"]
    token_hash: str | None; device_id: str | None; gm_session_id: str | None
    address: str; user_agent: str; using: bool = False
class Hub:
    def __init__(self, config: Config, clock: Clock)
    def bind(self, ctx: "AppContext") -> None
    async def start(self) -> None; async def close_all(self, code: int) -> None
    def notify(self, scope: Literal["screens", "gm", "all"] = "all") -> None   # sync: marks dirty
    def notify_cams(self, kind: ChangeKind) -> None                           # tiles → all, gm → gm
    async def send_event(self, target, event: Event) -> None                  # flushes state first
    async def reauth(self, *, device_id: str | None = None, gm_session_ids: list[str] | None = None, everyone: bool = False) -> None
    async def serve_state(self, ws: WebSocket, role: str, principal) -> None   # /ws loop
    async def serve_cams(self, ws: WebSocket, role: str, principal) -> None    # /ws/cams loop (sender task, pacing)
    def watching(self) -> bool

# app/actions.py (Core)
async def dispatch(ctx: AppContext, conn: Conn, action: Action) -> None      # role matrix; raises ActionError

# app/context.py (Core)
@dataclass class AppContext: config: Config; clock: Clock; storage: Storage; auth: Auth; hub: Hub; cams: CamManager; discovery: Discovery | None
def get_ctx(request: Request) -> AppContext       # websocket: websocket.app.state.ctx

# app/main.py (Core) — create_app(config: Config | None = None, clock: Clock | None = None) -> FastAPI
# lifespan: Config → Storage.open + migrate → Auth → Hub → CamManager(on_change=hub.notify_cams)
# → hub.bind(ctx) → await cams.start() → await discovery.start() (relay_mode != off) → await hub.start();
# shutdown in reverse (§6 Shutdown). app.state.ctx = ctx. Routers: app/api.py (HTTP), app/ws.py (sockets).
# app/admin.py (Core): `python -m app.admin set-pin` (reads the PIN twice from stdin).
```

## 11. Internal interfaces (front end)

```ts
// api/types.ts (shared, exists): View, Action, ServerMsg, ClientMsg, parseCamFrame(), FRAME_HEADER_BYTES
// api/http.ts (Shell)
export async function pairStart(): Promise<PairStatus>; export async function pairStatus(): Promise<PairStatus>
export async function gmStatus(): Promise<GmStatus>; export async function gmSetup(pin: string, setupToken: string): Promise<void>
export async function gmLogin(pin: string): Promise<void>; export async function gmLogout(): Promise<void>
export async function publicInfo(): Promise<PublicInfo>
export class ApiError extends Error { code: string; status: number }
// api/state.ts (Shell)
export function connect(opts: { as: 'device' | 'gm' }): void                 // once, from main.tsx
export function useServer(): { view: View | null; now: () => number; connected: boolean; send: (a: Action) => void; lastError: { code: string } | null }
export function useServerEvent(handler: (e: ServerEvent) => void): void
// api/cams.ts (Monitor)
export function useCamFrames(slots: number[], fps: number, as: 'device' | 'gm'): void   // ref-counted shared socket
export function CamCanvas(props: { slot: number; gen: number; fps: number; as: 'device' | 'gm'; className?: string }): JSX.Element
// views (default exports): Security({ view }), Spectator({ view }) (Monitor owner); Pairing({ view }),
// ComingSoon({ what }), GmApp() (Shell+GM owner); Kiosk({ children, lowMotion }) (Monitor owner)
// monitor/layout.ts (Monitor): export function layoutFor(n: 0 | 1 | 2 | 3 | 4): { col: string; row: string }[]
// theme (Theme owner): theme/tokens.css (CSS vars), theme/base.css (.outlined, keyframes),
// theme/fonts.ts (fontsource imports; imported once by main.tsx), components/: Button, Pill, Panel,
// Plate, Crewmate({color, shadow, size?, ghost?, dead?}), TvStatic, Starfield({lowMotion}),
// Segmented<T>, Slider, Toggle, OutlinedText
// sound/index.ts (Theme): unlockAudio(): Promise<void>; play(name: 'open'|'close'|'static'|'paired'): void; setVolume(v: number): void
// i18n/index.ts (Theme): useT(): (key: string, params?: Record<string, string | number>) => string; setLang(lang: Lang): void
```

## 12. Error and notice codes

`err.bad_origin`, `err.bad_request`, `err.forbidden`, `err.rate_limited`, `err.login_locked`,
`err.pin_wrong`, `err.pin_exists`, `err.bad_setup_token`, `err.pairing_closed`,
`err.pairing_full`, `err.unknown_code`, `err.unknown_device`, `err.unknown_phone`,
`err.slot_empty`, `err.bad_host`, `err.endpoint_taken`, `err.cam_busy`, `err.cam_releasing`,
`err.cam_timeout`, `err.cam_http`, `err.cam_bad_stream`, `err.torch_unknown`;
notices `gm.notice.cam_moved {slot, host}`, `gm.notice.cam_busy {slot}`,
`gm.notice.device_address_changed {name, address}`; toasts `gm.toast.pairing_closed`,
`gm.toast.paired {name}`.

## 13. Module ownership and tests

| Module | Files | Tests |
|---|---|---|
| Camera I/O | `backend/app/cams/{buffer,mjpeg,droidcam,relay,fake_droidcam}.py`, `tools/fake_droidcam.py` | `test_mjpeg.py`, `test_buffer.py`, `test_droidcam.py`, `test_relay.py` (one-connection invariant with FakeDroidCam, busy, stall watchdog, backoff, retarget) |
| Discovery + manager | `backend/app/cams/{discovery,manager}.py` | `test_manager.py` (assign/move/unassign/gen, derive_signal hysteresis, torch actor, endpoint dedupe, enable/disable), `test_discovery.py` (phone_from_service, seen/gone) |
| Foundation (done, written by the integrator; extend only, don't rewrite) | `backend/app/{clock,config,errors,storage}.py` (`DeviceRow` also has `approved_address`; `Storage.device(id)`, `get_json`/`set_json` exist) | — |
| Core server | `backend/app/{auth,hub,actions,context,api,ws,main,admin}.py`, `backend/tests/conftest.py` | `test_storage.py`, `test_auth.py` (PIN rules, lockout, setup token, pairing caps/window), `test_ws.py` (roles, origin, reauth on revoke closes cams within 1 s, 4409, coalescing, using/watching), `test_api.py` |
| Shared contract | `backend/app/models.py`, `frontend/src/api/types.ts` | `test_models.py` (types.gen.ts fresh via `scripts/gen_types.py --check`) |
| Theme | `frontend/src/{theme,components,sound,i18n}/*` | `i18n.test.ts` (parity, glyph coverage) |
| Monitor + kiosk views | `frontend/src/monitor/*`, `api/cams.ts`, `views/{Security,Spectator,Kiosk}.tsx` | `layout.test.ts`, `cams.test.ts` (frame parse/gen/seq rules) |
| Shell + GM | `frontend/src/{main.tsx,App.tsx}`, `api/{state,http}.ts`, `views/{Pairing,ComingSoon}.tsx`, `views/gm/*` | `state.test.ts` (reconnect/backoff logic as pure functions) |
| Deploy | `Dockerfile`, `compose.yaml`, `.dockerignore`, `deploy/*`, `scripts/{bundle,deploy}.py` (gen_types.py exists) | a `scripts/check_deploy.py` dry run |

The conftest fixtures (Core): `config(tmp_path)`, `fake_clock`, `fake_cam` (FakeDroidCam on
127.0.0.1), `app_ctx`, `client` (TestClient with lifespan, relay_mode `off`), `gm_session`,
`paired_device(view)`.
