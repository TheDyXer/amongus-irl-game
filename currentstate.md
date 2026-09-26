# Current state — paused 2026-09-26

The project is **paused in the middle of Phase 1** (cameras, pairing, GM setup) to save usage.
Phase 0 is finished and approved. The Phase 1 foundation is finished. About a third of the Phase 1
modules were written when the build was stopped. Nothing is deployed yet.

- Plan: [plan.md](plan.md) · checklist and log: [progress.md](progress.md)
- Binding spec: [docs/CONTRACT.md](docs/CONTRACT.md) (v2, after a 73-finding review). Read this first.
- Party setup guide: [docs/SETUP.md](docs/SETUP.md)
- Approved look: `design/mockups/*.dc.html` (Design Component artboards; they need the canvas
  runtime to render) and the private canvas artifact
  https://claude.ai/artifact/RsFzuFocStCLmBrKiRjQ7q (version 4, 12 artboards). Screenshots are in
  `docs/images/`.
- The Phase 1 build instructions (each module's spec and file ownership, the frontend style rules,
  the integrator checklist): [docs/handoff/phase1-build-workflow.js](docs/handoff/phase1-build-workflow.js)

## Git branches

| Branch | Contents |
|---|---|
| `main` | Phase 0 and the foundation: mock-ups, contract, models, clock/config/errors/storage, tooling, docs. Nothing to run yet. |
| `dev` | `main` plus the **unfinished, untested Phase 1 files** the build agents wrote before they were stopped. |

Continue on `dev`. Merge into `main` when Phase 1 passes its gate (a real-phone test).

## Finished and checked (foundation, on `main`)

- `backend/app/models.py`: the whole wire contract (Pydantic v2). Views, actions, events,
  envelopes and the `/ws/cams` binary frame header `>BBHII`.
- `backend/app/clock.py` (Clock, SystemClock, FakeClock with `advance()`/`settle()`), `config.py`
  (all `AUI_*` settings and timings), `errors.py` (ActionError), `storage.py` (SQLite, WAL,
  migrations). A smoke test passed.
- `scripts/gen_types.py` → `frontend/src/api/types.gen.ts` (generated, and fresh when paused);
  `frontend/src/api/types.ts` (aliases plus `parseCamFrame`).
- Front-end scaffold: React 19, TS 5.9, Vite 8, @fontsource fonts, `tsx --test`. `tsc -b` passed
  before the agents started.
- Backend venv: `backend/.venv` (Python 3.13 locally; the image uses 3.12). Pinned
  `requirements*.txt`.

## Phase 1 modules: state when stopped (the files are on `dev`)

Seven module agents plus an integrator were planned. Six were running and none had finished when
the workflow was stopped (the deploy agent had not started). **None of the written files has been
reviewed or tested**; no agent got as far as its test run. `tsc -b` will fail on `dev` until the
missing views exist, because `App.tsx` already imports them.

| Module | Written | Still missing |
|---|---|---|
| **camera-io** | nothing (it was writing `cams/buffer.py` when stopped) | `backend/app/cams/buffer.py`, `mjpeg.py`, `droidcam.py`, `relay.py`, `fake_droidcam.py`; `tools/fake_droidcam.py`; tests `test_buffer/test_mjpeg/test_droidcam/test_relay.py` |
| **manager** | nothing (it was waiting to see camera-io's files) | `backend/app/cams/discovery.py`, `manager.py`; tests `test_manager.py`, `test_discovery.py` |
| **core** | `backend/app/auth.py`, `backend/app/context.py` | `hub.py` (it was starting this, "the largest piece"), `actions.py`, `api.py`, `ws.py`, `main.py`, `admin.py`; `tests/conftest.py` (with FakeCams), `test_auth.py`, `test_ws.py`, `test_api.py` |
| **theme** | nearly done: `theme/{tokens.css,base.css,fonts.ts,glyphs.ts}`, `components/*` (Button, Pill, Panel, Plate, Crewmate, TvStatic, Starfield, Segmented, Slider, Toggle, OutlinedText, stars, cx, components.css, index.ts), `sound/index.ts`, `i18n/{index,translate}.ts`, `i18n/{en,hu}/{common,errors}.json` | `i18n.test.ts` (en/hu key parity, interpolation, plurals, `hasGlyphsOutsideLatin1`); check the `.font-splash` class with its Lilita One fallback; a typecheck |
| **monitor** | `api/cams.ts` + `cams.test.ts`, `monitor/layout.ts` + test, `monitor/tiles.ts` + test | `monitor/Monitor.tsx`, feed/tile components and CSS, `views/Security.tsx`, `views/Spectator.tsx`, `views/Kiosk.tsx` (+ CSS), `i18n/{en,hu}/monitor.json` |
| **shell-gm** | `main.tsx`, `App.tsx`, `api/http.ts`, `api/state.ts` + test, `views/Pairing.tsx` + `pairing.css`, `views/ComingSoon.tsx`, `views/gm/{GmApp,Console,CamerasPanel,PhonesPanel,parts,icons}.tsx`, `views/gm/logic.ts` + test | Screens panel (pairing approvals, devices), Security panel (change PIN, sessions, login failures), Notices panel, GM CSS, `i18n/{en,hu}/{pairing,gm}.json`; check that the set-PIN and login screens are complete in `GmApp.tsx` |
| **deploy** | not started | `Dockerfile`, `compose.yaml`, `deploy/build.sh`, `scripts/bundle.py`, `scripts/deploy.py`, `scripts/check_deploy.py` (copy the MathBoard pattern) |
| **integrator** | not started | pytest, `gen_types.py --check`, `npm run typecheck/test/build`, a local end-to-end run with 2 fake DroidCams (ports 4801/4802), `check_deploy.py`, `deploy.py --dry-run`, a `git status` check |

## How to continue

1. `git switch dev`. Set up the tools: `cd backend; py -3.13 -m venv .venv;
   .venv\Scripts\python -m pip install -r requirements-dev.txt`, then `cd ../frontend; npm ci`.
2. Finish the build. Re-run the modules from `docs/handoff/phase1-build-workflow.js`, telling each
   agent which of its files already exist ("review and complete them, don't start over"). Suggested
   order: camera-io, core and deploy in parallel; manager as soon as camera-io's `buffer.py` and
   `relay.py` exist; finish theme, monitor and shell-gm; then run the integrator step. A leaner
   alternative is to build one module at a time in a normal session, using the same prompts.
3. Review Phase 1 against the contract (security, realtime correctness, match with the mock-ups,
   code quality) and fix what the review finds.
4. Deploy: `backend\.venv\Scripts\python scripts\deploy.py` (it needs to be written first). It
   uses the saved devserver login (SSH and sudo), which is documented in a private Claude memory
   and never committed. Report the GM setup token (`$AUI_DATA_DIR/setup-token`, printed in the
   log).
5. Phase 1 gate, following [docs/SETUP.md](docs/SETUP.md): real DroidCam phones, Wi-Fi bandwidth, TV Bro
   on the TV showing 4 streams, torch support (DroidCam Pro), phone heat and battery over about
   30 minutes.
6. Merge `dev` into `main`. Then Phase 2 (game core), then Phase 3 (tasks), as in [plan.md](plan.md).

## Things learned along the way (don't re-learn them)

- **DroidCam** allows only one video client per phone. A second viewer gets an HTTP 200 HTML page
  containing `droidcam_busy`. Video is at `/video/640x480`, MJPEG with boundary `--dcmjpeg`. The
  control API (`/v1/phone/name`, `/v1/phone/battery_info`, `/v1/camera/info`,
  `PUT /v1/camera/torch_toggle`) is officially Pro-only and answers HTTP 550 otherwise. mDNS:
  `_droidcamobs._tcp.local.`
- That's why the **server relays** every phone (one connection each, keyed by endpoint), and why
  screens get frames over the binary **WebSocket `/ws/cams`**: browsers allow only 6 HTTP/1.1
  connections per host, so four MJPEG `<img>` streams would starve every other request.
- `AUI_RELAY_MODE` defaults to `fake`, so a dev instance can never take a real phone away from
  the server. Compose sets `real`.
- Plain http is not a secure context: no Wake Lock and no AudioWorklet. Kiosks set "never sleep",
  and sounds use oscillators/buffers. Animate only `transform`/`opacity` (weak TV GPUs).
- Luckiest Guy has no latin-ext glyphs, so Hungarian ő/ű need the Lilita One fallback.
- Pydantic: `json_schema_serialization_defaults_required=True` keeps defaulted discriminators
  (`t`, `kind`) required in the generated TypeScript.
- npm 11 holds back esbuild's install script (allowScripts). tsc, tsx and Vite still work.
- Claude Workflow results are nested under `"result"` in the output JSON.
- Mock-up rules to carry into the UI: ≥8 px padding on plates and pills, restrained letter
  spacing, no glow shadows. The bouncy easing of the meeting band is intentional.
- TV: use **TV Bro** (WebView engine, "Keep screen on"). Puffin TV renders in the cloud and can't
  reach the LAN.

## Open questions for the user

- Party date: not set yet.
- The Hungarian strings are drafts; the user should review them.
- Which camera phones have DroidCam Pro (needed for the torch "watching" light)? This gets tested
  at the Phase 1 gate.
