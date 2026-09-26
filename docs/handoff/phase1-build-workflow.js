export const meta = {
  name: 'amongus-phase1-build',
  description: 'Build Phase 1 (cams, pairing, GM setup) with 7 module agents in parallel, then integrate and smoke-test',
  phases: [
    { title: 'Build', detail: 'one agent per module, contract-first' },
    { title: 'Integrate', detail: 'types, tests, build, local end-to-end smoke test' },
  ],
}

const ROOT = 'X:\\amongus-irl'
const PY = 'X:\\amongus-irl\\backend\\.venv\\Scripts\\python.exe'

const COMMON = `You are one of seven agents building Phase 1 of "Among Us IRL" in parallel, in the repo ${ROOT}.
Phase 1 = DroidCam phone cameras relayed by a FastAPI server to paired kiosk screens (Security station, TV spectator wall) over WebSockets, plus a PIN-protected game-master (GM) console for setup. Later phases add the game.

Read these first, completely:
- ${ROOT}\\docs\\CONTRACT.md (v2). This is binding: endpoints, protocols, behaviours, limits, and the exact internal interfaces in sections 10 and 11. Build against those signatures exactly.
- ${ROOT}\\backend\\app\\models.py (wire models) and ${ROOT}\\frontend\\src\\api\\types.ts plus types.gen.ts (the generated TS mirror; never hand-edit types.gen.ts).
- The foundation modules that already exist and are frozen: ${ROOT}\\backend\\app\\clock.py, config.py, errors.py, storage.py. Use them; don't rewrite them. If you truly need an extra method, add it minimally and report it.
- For context only: the approved plan C:\\Users\\User\\.claude\\plans\\make-me-a-amongus-cheeky-jellyfish.md.

Rules:
- Only create or edit the files your module owns (listed below). Other modules are being written at the same moment. Code against the contract's signatures, and in your tests use small local fakes for other modules' classes where needed. The integration step afterwards wires everything together.
- If you must deviate from the contract, keep the deviation minimal, put a one-line comment at the spot, and report it in "deviations". Never silently change a shape in models.py (it is owned by the integrator).
- Match the codebase style: concise, typed, no filler comments, no dead code. Python must run on 3.12 (server) and 3.13 (dev venv). Use asyncio throughout, and use the injected Clock for every sleep and timestamp.
- Backend commands run from ${ROOT}\\backend with ${PY} (for example: ${PY} -m pytest tests/test_mjpeg.py). Frontend commands run from ${ROOT}\\frontend with npm.cmd (npm run typecheck, npm test). Typecheck errors in files other modules haven't written yet are expected; your own files must be clean.
- Do not add dependencies. If one is unavoidable, don't install it; report it.
- Do not deploy, do not touch the devserver, and do not open a browser.
- If the impeccable design hook comments on a write, fix real problems; if you judge a finding a false positive, leave it, run no ignore command, and mention it.
Return: the files you wrote, test commands and their results, deviations from the contract, and anything the integrator must do.`

const FE_STYLE = `FRONT-END STYLE (shared by all front-end modules):
- React 19 + TypeScript strict (tsconfig has noUnusedLocals). Plain CSS files next to the components (e.g. monitor/monitor.css), imported from the component. No CSS frameworks.
- Design tokens are CSS variables defined in src/theme/tokens.css (the Theme module writes it; use these exact names): --c-space #05060d, --c-bg #0b0f16, --c-panel #10151f, --c-card #141a24, --c-card-2 #1a2130, --c-steel #4e5a6c, --c-neutral #2b3445, --c-ink #0b0e13, --c-text #e9eef6, --c-text-2 #d5dde8, --c-text-3 #c9d3e1, --c-muted #a9b4c3, --c-cyan #8CFFFF, --c-cyan-ink #07131a, --c-cyan-bg #0e2a33, --c-impostor #FF1919, --c-alert #ff3b30, --c-green #43d15d, --c-green-ink #07210e, --c-green-2 #58f07a, --c-amber #ffb020, --c-yellow #ffd400, --c-orange #F07D0D, --f-splash 'Luckiest Guy', --f-title 'Lilita One', --f-ui 'Barlow Condensed', --f-body 'Barlow', --f-mono 'VT323', --w-outline 3px, --r-card 16px, --r-btn 12px.
- The approved look is in ${ROOT}\\design\\mockups\\*.dc.html (Design Component artboards: inline styles, a "<helmet>" style block, and SVG markup). Port their visuals faithfully: the palette, the thick #0b0e13 outlines, chunky buttons and panels, the crewmate SVG paths, and the .outlined text-shadow class. Ignore their "PREVIEW CONTROLS" bars and the DC runtime syntax ({{ }}, sc-if, sc-for).
- Accessibility: real <button>/<input>/<label>, touch targets of at least 44px, aria-label on icon-only buttons, text contrast of at least 4.5:1. At least 8px padding inside any bordered or filled container. Wide letter-spacing only on short uppercase labels. Never: coloured glow shadows, gradient washes (scanline stripes are OK), left-border accent cards, emoji or emoji-prone glyphs (use inline SVG icons), or innerHTML. Animate only transform and opacity.
- Every visible string comes from i18n: const t = useT(); t('monitor.signal_lost'). Keys are "<ns>.<key>". Each module owns its own namespace JSON files in src/i18n/en/<ns>.json and src/i18n/hu/<ns>.json (flat objects keyed by the part after "<ns>."), with Hungarian drafted by you (the user will review it). {name} interpolation; plurals use key_one/key_other.
- Server-sent codes (err.*, gm.notice.*, gm.toast.*) are translated through the "errors" and "gm" namespaces.`

const MODULES = [
  {
    key: 'camera-io',
    prompt: `YOUR MODULE: Camera I/O. You own: backend/app/cams/buffer.py, mjpeg.py, droidcam.py, relay.py, fake_droidcam.py; tools/fake_droidcam.py; tests backend/tests/test_buffer.py, test_mjpeg.py, test_droidcam.py, test_relay.py.
Build exactly contract section 10's FrameBuffer/Frame, parse_boundary/is_busy_page/MjpegParser, the droidcam control functions, PhoneRelay (LinkState, bind/start/retarget/stop, link/error/fps/last_frame_mono) and FakeDroidCam. Section 6 is the behaviour spec: the one-connection invariant, busy detection (including the self-inflicted-busy window), the frame watchdog, backoff with its reset rule, timeouts, caps, never copying response bodies into state, and httpx.URL-built URLs. The relay does NOT fetch the phone name (the manager does, via droidcam.phone_name, when the link first reaches streaming). Remove any phone_name attribute from the relay and report that as a deviation.
FakeDroidCam: write it with asyncio.start_server and a small hand-written HTTP/1.1 handler, so you control concurrency exactly. It serves /video/<size> as multipart/x-mixed-replace with boundary --dcmjpeg, with Content-Length per part. Frames are rendered with Pillow at the configured fps: a simple room with a moving crewmate-like blob, the fake's name, and a frame counter. A second concurrent /video client (or busy=True) gets HTTP 200 text/html containing droidcam_busy. stalled=True stops sending frames but keeps the socket open. It also serves GET /v1/phone/name, GET /v1/phone/battery_info ({"level":..,"amps":..}), GET /v1/camera/info (include torch state), and PUT /v1/camera/torch_toggle (torch="pro" answers HTTP 550, "none" answers 404). It tracks video_clients, max_concurrent_video_clients and torch_toggles, and can register mDNS via zeroconf AsyncZeroconf with a configurable service type (default _auifakecam._tcp.local.). tools/fake_droidcam.py is a thin argparse CLI (--port --name --fps --mdns --type (--real-type shortcut for _droidcamobs._tcp.local.) --busy --torch --battery) that adds backend/ to sys.path.
Tests must cover: the parser (split chunks, missing Content-Length, quoted/unquoted boundaries, garbage, oversize parts); FrameBuffer semantics (seq never resets, bump_gen, listeners, wait_newer); the control functions against FakeDroidCam (550 gives pro_required, timeouts don't raise); and the relay against FakeDroidCam: frames arrive; busy gives link busy; stalled triggers watchdog reconnects; backoff grows then resets; and the one-connection invariant (max_concurrent_video_clients stays 1 through many retarget/stop/start/bind cycles). The relay takes a config object: in tests pass an app.config.Config with small timings (Config(data_dir=tmp_path, static_dir=tmp_path, frame_watchdog_s=0.5, ...)) and a SystemClock.`,
  },
  {
    key: 'manager',
    prompt: `YOUR MODULE: Discovery and manager. You own: backend/app/cams/discovery.py, manager.py; tests backend/tests/test_manager.py, test_discovery.py.
Build CamManager exactly as contract section 10 specifies, with section 6's behaviour. Relays are keyed by endpoint, with a per-endpoint asyncio.Lock and at most one relay per endpoint; moving a phone between slots re-binds its relay to the new slot's FrameBuffer without reconnecting; manual phones whose endpoint belongs to another phone merge into it. Slot gens bump on assign/unassign/move/cams_enabled changes (FrameBuffer.bump_gen). There is one FrameBuffer per slot for the whole process. derive_signal is a pure function with hysteresis (lost to live needs 2 frames within 1 s; a tile stays lost at least 1 s; offline to live needs 2 s of steady frames). A 250 ms status tick calls on_change('tiles') only when the set of (slot, gen, room, status) changes; the GM telemetry refreshes on the hub's 1 s tick through slots(). Other requirements:
- Names: fetch droidcam.phone_name once when a relay first reaches streaming.
- Battery: poll every 60 s.
- Torch: one TorchController actor per assigned phone, with a queue of intents, shielded in-flight toggles, assumed_on persisted through storage.set_torch_on, torch_state unknown after a timeout, a capability probe at assign time, test_torch/torch_fix, and blinking only while watching, torch_blink and a ready capability all hold. It ends off.
- Teardown order: stop blinking, then torch off, then close the video.
- set_enabled(False) stops relays and removes tiles immediately; True restarts them with fresh backoff.
- phone_seen/phone_gone follow the address-change rules (IPv4 in lan_cidr only; apply a new address on the next reconnect unless the link is down; notice gm.notice.cam_moved via on_notice).
- add_manual validates the host: IPv4 literal in lan_cidr, not loopback/link-local/the server's own IP/the gateway (.1); 127.0.0.1 is allowed when config.relay_mode is fake or off.
- Commands raise app.errors.ActionError with the section-12 codes.
- slots() returns 4 CamSlot models (link idle/disabled/connecting/streaming/busy/backoff from the relay, signal, fps, last_frame_at in epoch ms via clock.time(), battery, torch, torch_state, error_code); tiles() returns only live/lost tiles in slot order with upper-cased rooms; phones() returns KnownPhone rows (online = seen by mDNS in the last 120 s or relay streaming).
Discovery: AsyncZeroconf + AsyncServiceBrowser for _droidcamobs._tcp.local. (relay_mode real) or _auifakecam._tcp.local. (fake); relay_mode off means no discovery. Resolve IPv4 addresses and call cams.phone_seen/phone_gone. phone_from_service is pure and unit-tested (instance name to id "mdns:<instance>", duplicate names get "#2" suffixes, only lan_cidr addresses). Re-query every 30 s while an assigned phone lacks fresh resolution.
The Camera I/O module (PhoneRelay, FrameBuffer, droidcam functions, FakeDroidCam) is being written at the same moment. For unit tests, inject a relay factory (add an optional relay_factory kwarg to CamManager; report it) and use a FakeRelay implementing PhoneRelay's contract interface. Also write 2-3 integration tests with the real PhoneRelay + FakeDroidCam, marked @pytest.mark.integration and skipped if app.cams.fake_droidcam can't be imported yet, so the integrator can run them. Use app.storage.Storage on a tmp_path and app.clock.FakeClock or SystemClock.`,
  },
  {
    key: 'core',
    prompt: `YOUR MODULE: Core server. You own: backend/app/auth.py, hub.py, actions.py, context.py, api.py, ws.py, main.py, admin.py; tests backend/tests/conftest.py, test_auth.py, test_ws.py, test_api.py.
Implement contract sections 1-5, 7, 9 and 12 on the server side with the section-10 interfaces:
- auth: cookies and tokens; PairingBook with its window, caps, codes, keep-alive and hints derived from the user agent; the PIN rules; the setup token (created at startup when no PIN exists, written to config.setup_token_path and logged); atomic setup; login limits checked before argon2 (run argon2 via starlette.concurrency.run_in_threadpool); sessions; change_pin.
- Origin/Host checks for WebSockets (reject before accept) and for non-GET /api (403 err.bad_origin), and the JSON content-type requirement.
- hub: the Conn registry; per-client coalesced state pushes (leading edge, then one trailing send per 50 ms, only when the JSON changed; state always before events); views built from storage + cams.slots()/tiles()/phones() + auth; ScreenView per contract (security body with monitor/watching/using, spectator body, placeholder bodies for comms/emergency; mode cams or cams_off); GmView with everything, including now-based timestamps.
- "using", watching (1 s off-debounce) and cams.set_watching.
- reauth on every principal change (close /ws/cams with 4403, push new views, revoked devices get PairingView closed); one /ws and one /ws/cams per principal (4409); heartbeats (/ws: ping 20 s, 4408 after 45 s; /ws/cams: hb every 5 s); limits (sockets per IP and total, 20 msgs/s with 1008, 64 KiB messages, 30 s anonymous idle, 10 s blocked-send close).
- The /ws/cams sender: one task per connection, latest-frame-only per slot via FrameBuffer listeners, deadline pacing at the effective fps re-read live from the device row (security devices only while using), round-robin slots, never older than 2 s, never the same (gen, seq) twice, and an immediate latest frame on sub. Frames are packed with models.pack_frame.
- The GET /cam/{slot}.mjpg debug stream (GM only, via FrameBuffer.wait_newer).
- actions.dispatch with the role matrix: device actions per view (models.DEVICE_ACTIONS), GM actions; ActionError is sent as an ErrorMsg with ref = act id.
- api.py HTTP endpoints (section 3, including /api/public).
- main.py create_app(config=None, clock=None) with the lifespan order and shutdown sequence from sections 6/10, app.state.ctx, the static SPA catch-all (index.html for GETs outside /api /ws /cam), and a refusal to run the relay when WEB_CONCURRENCY > 1.
- admin.py: python -m app.admin set-pin.
- The public address: config.public_address, or auto-detect the LAN IP with the UDP-connect trick plus the port.
CamManager and Discovery are being written at the same moment by another agent. In conftest.py, provide a FakeCams class implementing CamManager's public API from section 10 (commands record calls; slots/tiles/phones return configurable data; buffer(slot) returns real app.cams.buffer.FrameBuffer objects if importable, else a small local stand-in), and let create_app accept an optional cams override for tests (report it). Fixtures: config(tmp_path), fake_clock, app_ctx, client (starlette TestClient with lifespan, relay_mode off), gm_session, paired_device(view). Also add a fake_cam fixture that starts app.cams.fake_droidcam.FakeDroidCam when importable (else skip).
Tests: PIN rules/lockout/setup token/atomic setup; pairing window, caps and rate limits; Origin rejection (Origin http://evil:8000 gives 403 before accept); role resolution with ?as=; revoke while streaming closes /ws/cams within 1 s and pushes PairingView; 4409 replacement; the coalescing count; using/watching and use timeout (drive time with FakeClock where practical); cams sender pacing and latest-frame-only (publish 10 frames quickly, the client receives only the newest); the GM-only mjpg endpoint; the static fallback.`,
  },
  {
    key: 'theme',
    prompt: `YOUR MODULE: Theme. You own: frontend/src/theme/* (tokens.css with exactly the variable names in the style block, base.css with body basics, the .outlined text-shadow class copied from the mock-ups, shared keyframes, focus-visible styles and a .sr-only class, fonts.ts), frontend/src/components/*, frontend/src/sound/*, frontend/src/i18n/index.ts, frontend/src/i18n/en/common.json, en/errors.json, hu/common.json, hu/errors.json, and tests frontend/src/i18n/i18n.test.ts plus any components/*.test.ts.
- fonts.ts imports the @fontsource CSS (the packages are installed): Barlow 500/700, Barlow Condensed 600/800, Lilita One 400, Luckiest Guy 400, VT323 400, including latin-ext. main.tsx (the Shell module) imports theme/fonts.ts, theme/tokens.css and theme/base.css once.
- Components per contract section 11, typed and exported by name from components/index.ts: Button({tone:'primary'|'neutral'|'danger'|'ok'|'cyan', size?:'m'|'l', ...button props}), Pill({tone, children}), Panel({title, subtitle?, actions?, children}), Plate({children}) (the uppercase room plate), Crewmate({color, shadow, size?, ghost?, dead?, title?}) (the exact shared SVG paths from the mock-ups; ghost = the wavy-bottom path; dead = the half body with a bone from Splash.dc.html), TvStatic({lowMotion?, className?}) (the /static.png texture, already in frontend/public, animated with steps like Main.dc.html, slower when lowMotion), Starfield({lowMotion?}) (a canvas of about 500 square stars with size-based parallax drift; static when lowMotion or prefers-reduced-motion), Segmented<T>, Slider, Toggle, OutlinedText.
- sound/index.ts: synthesized WebAudio only (no files): unlockAudio(), play('open'|'close'|'static'|'paired'), setVolume(0..100). open/close are short chunky UI blips in the spirit of the game's panel appear/disappear; static is a 0.6 s filtered-noise hiss; paired is a friendly two-note chime. It must be safe to call before unlock (a no-op) and never throw. No AudioWorklet (plain http is not a secure context).
- i18n/index.ts: statically import all five namespaces (common, monitor, pairing, gm, errors) for en and hu from ./en/<ns>.json and ./hu/<ns>.json. Create only your own four JSON files; the monitor/pairing/gm files are written by other agents, so do not create them. Export useT(), setLang(lang) and a non-hook t(key, params) for tests. Missing keys fall back to en, then to the key itself. {name} interpolation; plurals via Intl.PluralRules with key_one/key_other.
- errors.json covers every err.* code in contract section 12. common.json holds shared words (buttons, yes/no, on/off, loading, tap to start, still watching, coming soon...). The Hungarian is drafted by you.
- i18n.test.ts: key parity en vs hu for every namespace file that exists (skip missing ones), interpolation, plural selection, and a helper hasGlyphsOutsideLatin1(text) with a test (Luckiest Guy has no latin-ext, so Hungarian ő/ű need the Lilita One fallback). Also add a .font-splash class whose font-family is 'Luckiest Guy', 'Lilita One', sans-serif.
${FE_STYLE}`,
  },
  {
    key: 'monitor',
    prompt: `YOUR MODULE: Monitor and kiosk views. You own: frontend/src/monitor/* (Monitor.tsx, layout.ts, Feed/Tile components, CSS), frontend/src/api/cams.ts, frontend/src/views/Security.tsx, Spectator.tsx, Kiosk.tsx (plus their CSS), frontend/src/i18n/en/monitor.json, frontend/src/i18n/hu/monitor.json, and tests frontend/src/monitor/layout.test.ts and frontend/src/api/cams.test.ts.
- Port design/mockups/Main.dc.html faithfully: the Security-room idle art (SVG console, floor, SECURITY plate, the USE button with the four-screen icon and outlined "USE"), and the monitor (steel housing with bevel, blinking red lamp while watching, a 4-column x 2-row grid whose 16px gaps are the dividers, feeds with a 5px ink border and 10px radius, the room plate top-left, and the "CAM n" plate bottom-left with at least 8px padding).
- Layouts via layoutFor(n) exactly as in the mock-up's cells table: 0 = housing with a "NO SIGNAL" plate; 1 = full; 2 = side by side; 3 = two on top + one centred below; 4 = 2x2.
- Tile states: lost = TvStatic + flashing "SIGNAL LOST"; monitor.mode cams_off = a "CAMERAS OFF" plate; comms_down = every tile static + flashing red "[COMMS DISABLED]"; meeting = dark "MEETING IN PROGRESS" + a countdown to ends_at using useServer().now(). Build all four modes now.
- Security.tsx: idle to open (0.25 s background fade + 0.25 s power-on scaleY sweep; close 0.1 s sweep + 0.3 s fade). On open: play('open'), send {type:'use_open'} immediately and every 30 s while open, and subscribe the tiles' slots via useCamFrames. The close button (top-left, 60px, aria-label) sends use_close, unsubscribes and plays close. After 90 s without input, show a "STILL WATCHING?" prompt with a button; with no answer it closes 10 s later. When the monitor is open and the socket reconnects, resend use_open. If the server says using=false while the client thinks the monitor is open (for example after a use timeout), close locally. Play 'static' once per live-to-lost tile edge (at most once per 5 s per slot) on Security only.
- Spectator.tsx: the same monitor, always open, never sends use_*.
- Kiosk.tsx: a full-screen TAP TO START overlay: an autofocused <button> that accepts click, Enter and TV-remote OK; it calls unlockAudio() and requestFullscreen() (failure ignored). Pass lowMotion down from ScreenView.device.low_motion.
- api/cams.ts per contract sections 5 and 11: one shared, reference-counted /ws/cams socket per page (?as=device or ?as=gm); the sub message merges all hooks' slots with the max fps; heartbeat and dead-socket detection (12 s); reconnect with 0.5-8 s backoff and ±30% jitter; stop reconnecting after close codes 4401/4403/4409 until something changes. Decode rules: at most one createImageBitmap in flight per slot; keep only the newest pending blob; drop frames whose gen differs or whose seq is not above the last drawn; draw in requestAnimationFrame; close replaced bitmaps; skip decoding while document.hidden. CamCanvas({slot, gen, fps, as, className}) draws with object-fit cover and a backing store of at most min(CSS size x DPR, 960x720). It also has the local staleness rule: a live tile with no frame for 3 s draws static locally. Keep the frame-acceptance rules and the backoff as pure exported functions so cams.test.ts can test them under tsx --test without a DOM.
- Use the Theme module's components (Plate, TvStatic, Crewmate, Button, OutlinedText) and useT/setLang/sound APIs exactly as contract section 11 names them; they are being written at the same moment. useServer() and connect() come from api/state.ts (the Shell module), also in parallel; code against the section-11 signatures.
${FE_STYLE}`,
  },
  {
    key: 'shell-gm',
    prompt: `YOUR MODULE: Shell and GM console. You own: frontend/src/main.tsx, frontend/src/App.tsx, frontend/src/api/state.ts, frontend/src/api/http.ts, frontend/src/views/Pairing.tsx, frontend/src/views/ComingSoon.tsx, frontend/src/views/gm/* (GmApp.tsx, login/setup screens, the console, panels, CSS), frontend/src/i18n/en/pairing.json, en/gm.json, hu/pairing.json, hu/gm.json, and tests frontend/src/api/state.test.ts.
- main.tsx imports theme/fonts.ts, theme/tokens.css and theme/base.css, then renders App. App.tsx routes by path per contract section 8: "/" is the device flow (POST /api/pair/start, then connect({as:'device'}), then render by view.kind and ScreenView.body.view: Security/Spectator come from views/Security.tsx and views/Spectator.tsx, wrapped in views/Kiosk.tsx, all written by the Monitor module at the same moment; comms and emergency get ComingSoon). "/gm" and "/gm/*" are the GM flow. /join, /play, /b/*, /t/* get a ComingSoon page. Call setLang whenever the current view carries lang (for GmView, settings.lang; before any state, /api/public).
- state.ts per contract section 11: a module-level WebSocket client (useSyncExternalStore) with ping every 20 s, reconnect with 0.5-8 s backoff and ±30% jitter (reset after 10 s connected), and no reconnect after 4401 (the GM goes to login) or 4409 (show "opened elsewhere"). It tracks the server clock offset from state/pong now (now() returns estimated server epoch ms). send(action) attaches a short random id; useServerEvent(handler); lastError holds {code, ref}. Keep backoff/jitter and the message reducer as pure exported functions for state.test.ts.
- http.ts per section 11, with ApiError(code, status) parsed from {"detail": code}; JSON bodies; credentials same-origin.
- Pairing.tsx: no interactive elements. It shows the 4-letter code huge ('VT323' or Lilita One), instructions ("Open the GM console > Screens > approve this code"), and the closed state ("Ask the game master to open pairing"), re-POSTing /api/pair/start every 3 s while closed, when expired, or when the code is missing. Play the paired chime on the paired event. The look follows the house style (starfield background via the Theme's Starfield).
- GmApp: GET /api/gm/status; first run shows a set-PIN screen (6-8 digit PIN entered twice + the 8-letter setup token, explaining where the token is); otherwise login (a PIN pad that works with a keyboard too, showing err.pin_wrong/err.rate_limited/err.login_locked with remaining lock time); then the console with connect({as:'gm'}).
- The console ports design/mockups/GM.dc.html: a sidebar (GAME MASTER, nav SETUP active, LIVE GAME disabled with a "Phase 2" hint, PRINT SHEETS disabled, SETTINGS; LANGUAGE EN/HU segmented, VOLUME slider, CAMS on/off toggle, TORCH BLINK toggle), a header with server address/version/relay mode pills, and these panels:
  CAMERAS: 4 slot cards with status pills derived from link+signal, a CamCanvas thumbnail at 5 fps (from api/cams.ts, Monitor module, as 'gm'), device name, IP, battery, torch capability/state with TEST and FIX buttons, a room-plate input (saves on blur/Enter via set_room), UNASSIGN, and for empty slots "assign" from known unassigned phones plus "add by IP" (with optional slot).
  KNOWN PHONES: a list with online state and FORGET.
  SCREENS: a PAIR A SCREEN button that opens the window for 5 minutes (countdown from pairing_open_until, CLOSE button); pending requests as a stable list sorted by created_at showing the code big, address, hint and age, with approve-as buttons (SECURITY, SPECTATOR, COMMS, EMERGENCY) and REJECT; paired devices with an inline rename, view select, max fps select (5/10/15/20/30), low motion toggle, online/last seen, an address-changed warning and REVOKE (with confirm).
  SECURITY: change PIN (old/new), active sessions with LOG OUT OTHERS, login failures.
  NOTICES: dismissable.
  Every server string is rendered as text only. Times ("3 s ago", countdowns) are computed locally from now().
- Use the Theme components and APIs (Button, Pill, Panel, Plate, Crewmate, Segmented, Slider, Toggle, Starfield, useT, setLang, play) exactly as contract section 11 names them; they are being written in parallel.
${FE_STYLE}`,
  },
  {
    key: 'deploy',
    prompt: `YOUR MODULE: Deploy. You own: ${ROOT}\\Dockerfile, ${ROOT}\\compose.yaml, ${ROOT}\\.dockerignore (exists; refine if needed), ${ROOT}\\deploy\\build.sh, ${ROOT}\\scripts\\bundle.py, ${ROOT}\\scripts\\deploy.py, ${ROOT}\\scripts\\check_deploy.py. (scripts/gen_types.py exists; leave it alone.)
Reuse the proven MathBoard pattern; read these first: X:\\mathit\\Dockerfile, X:\\mathit\\compose.yaml, X:\\mathit\\scripts\\deploy.py, X:\\mathit\\scripts\\bundle.py, X:\\mathit\\deploy\\build.sh (if present), and the connect() pattern in C:\\Users\\User\\.claude\\statusline-deploy.py.
- Dockerfile: multi-stage. node:22-bookworm-slim runs npm ci and npm run build in frontend/. Then python:3.12-slim-bookworm installs backend/requirements.txt, copies backend/app, and copies frontend/dist to /app/static. Non-root user uid 10001; /app/data owned by it; WORKDIR so that "app.main:app" imports. CMD per contract section 1. Check every uvicorn flag against the installed version (${PY} -m uvicorn --help): keep --workers 1 and permessage-deflate off; if --ws websockets-sansio or any other flag is unsupported, pick the supported equivalent and report it.
- compose.yaml: service "app", project name amongus-irl, image amongus-irl:local, network_mode: host, restart unless-stopped. Environment: AUI_RELAY_MODE=real, AUI_DATA_DIR=/app/data, AUI_STATIC_DIR=/app/static, AUI_PUBLIC_ADDRESS=192.168.11.220:8740. A named volume "data" at /app/data. The MathBoard hardening (security_opt no-new-privileges, cap_drop ALL, mem_limit 512m, json-file logging 5m x 3). A healthcheck with python urllib against http://127.0.0.1:8740/api/health.
- deploy/build.sh (runs as root via sudo on the server, in ~/amongus-irl): docker compose build, then up -d. Then, only if ufw is active, add idempotently: ufw allow from 192.168.11.0/24 to any port 8740 proto tcp comment 'amongus-irl'. Write a status file (.runtime-build-status.json: state running/done/failed, with timestamps). After up, wait for the health check. If /app/data/setup-token exists in the container, print it clearly ("GM SETUP TOKEN: XXXXXXXX").
- scripts/bundle.py: builds deploy-bundle.tar.gz at the repo root with only what the image needs (backend/app, backend/requirements.txt, backend/pyproject.toml; frontend package.json, package-lock.json, tsconfig.json, vite.config.ts, index.html, src/, public/; Dockerfile, compose.yaml, .dockerignore, deploy/). Exclude node_modules, dist, .venv, data, tests, __pycache__.
- scripts/deploy.py: run bundle.py; read X:\\mathit\\.runtime\\server-access.json (host, port, user, password); paramiko with RejectPolicy against ~/.ssh/known_hosts. mkdir -p the remote dir, upload over SFTP (chmod 600), and extract. Run "sudo -S -p '' sh -c 'nohup sh deploy/build.sh > .runtime-build.log 2>&1 &'" with the password written to stdin (never printed, never logged, never in argv), exactly like MathBoard. Then poll the status file and stream new log lines until done or failed (15 min timeout). Finally, from the PC, GET http://192.168.11.220:8740/api/health and print it, and print the setup token line if the log has one. Flags: --dry-run (bundle + validate only, no network) and --logs (tail the remote log).
- scripts/check_deploy.py: an offline validation that the bundle builds and that the Dockerfile/compose contain the required settings (network_mode host, a single worker, deflate off, healthcheck, hardening). Exit nonzero on failure. Run it.
Do NOT deploy and do NOT connect to the server in this task (deploy.py is run later by the integrator). Run check_deploy.py and "python scripts/deploy.py --dry-run".`,
  },
]

const BUILD_SCHEMA = {
  type: 'object',
  properties: {
    module: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    tests: { type: 'string' },
    deviations: { type: 'array', items: { type: 'string' } },
    integrator_todo: { type: 'array', items: { type: 'string' } },
  },
  required: ['module', 'files', 'tests', 'deviations', 'integrator_todo'],
}

phase('Build')
const built = await parallel(MODULES.map((m) => () =>
  agent(`${COMMON}\n\n${m.prompt}`, { label: 'build:' + m.key, phase: 'Build', schema: BUILD_SCHEMA })
    .then((r) => r || { module: m.key, files: [], tests: 'agent returned nothing', deviations: [], integrator_todo: ['module ' + m.key + ' produced no result'] })))

phase('Integrate')
const report = await agent(`You are the integrator for Phase 1 of "Among Us IRL" in ${ROOT}. Seven module agents just built their parts in parallel against ${ROOT}\\docs\\CONTRACT.md (v2). Read the contract (especially sections 10, 11 and 13) and then make the whole thing work together. You may edit any file.

Their reports (files, tests, deviations, todos):
${JSON.stringify(built, null, 1)}

Do this in order, and fix every problem you find at its root, preferring the contract's shape. When a module deviated reasonably, keep the deviation and update the contract text (and models.py + regenerate types if a wire shape changes: ${PY} scripts\\gen_types.py from ${ROOT}):
1. Backend: from ${ROOT}\\backend run ${PY} -m pytest -q, including the integration-marked tests (the manager + real relay + FakeDroidCam). Make them all pass. Add a test_models.py that runs scripts/gen_types.py --check.
2. Wiring: create_app must use the real CamManager + Discovery (relay_mode off/fake/real). Make sure that contract section 10's constructor args and on_change/on_notice callbacks line up, and that hub views use the manager's read side.
3. Frontend: from ${ROOT}\\frontend run npm.cmd run typecheck, npm.cmd test and npm.cmd run build. Fix every error: mismatched imports, names, props and i18n namespaces (all 5 namespace JSON files must exist for en and hu with matching keys).
4. Local end-to-end smoke test, all on this PC with no devserver:
   a. Start two FakeDroidCams via tools/fake_droidcam.py on ports 4801 and 4802 (no mDNS).
   b. Start the server with AUI_RELAY_MODE=off, AUI_DATA_DIR set to a temp dir and AUI_STATIC_DIR=${ROOT}\\frontend\\dist: ${PY} -m uvicorn app.main:app --host 127.0.0.1 --port 8740 (with the contract's flags).
   c. Write a throwaway Python script under ${ROOT}\\backend\\scratch_smoke.py (delete it afterwards) that uses httpx and websockets (installed with uvicorn[standard]) with correct Origin/Host headers. It should: read the setup token file; set the GM PIN; open /ws?as=gm; add the two fake cams with add_manual_phone into slots 1 and 2 with rooms; open pairing; POST /api/pair/start as a "device" client (its own cookie jar); approve it as spectator; open that device's /ws and /ws/cams; subscribe; and assert that binary frames arrive for slots 1 and 2 with the right header layout and increasing seq. Then stop fake cam 2 and assert its tile goes lost and then disappears within about 15 s. Then revoke the device and assert its /ws/cams closes with 4403 and its /ws gets a pairing view. Also check GET / serves index.html and /api/health works.
   d. Stop everything and delete the temp data and the smoke script.
5. Run ${PY} scripts\\check_deploy.py and ${PY} scripts\\deploy.py --dry-run from ${ROOT}.
6. Review git status: make sure no stray files (logs, temp data, node_modules, dist) would be committed. .gitignore exists; extend it if needed. Do not commit.
Do not deploy to the devserver. Do not open a browser.
Return a precise report: what passed (with counts), what you fixed (file: change), deviations accepted (and contract edits), anything still failing or unverified, and anything that needs the real phones or the devserver.`, { label: 'integrate', phase: 'Integrate' })

return { built: built, report: report }
