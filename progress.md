# Progress

Legend: ✅ done · 🟡 started or partial · ⬜ not started. Details: [currentstate.md](currentstate.md).

## Phase 0 — Mock-ups ✅

- ✅ Grilling session: every design decision settled ([plan.md](plan.md))
- ✅ Research: DroidCam limits and API, TV browsers, Among Us visual reference, mesh proximity
  (rejected; QR badges instead)
- ✅ 12 clickable mock-up artboards (Security, Spectator, Splash, 5 phone screens, Badge, GM,
  Comms, Emergency), approved by the user
- ✅ Mock-ups copied to `design/mockups/`

## Phase 1 — Cameras, pairing, GM setup 🟡 (paused)

- ✅ Interface contract v2 (`docs/CONTRACT.md`): reviewed through four lenses, 73 findings folded in
- ✅ Wire models (`backend/app/models.py`) → JSON Schema → `frontend/src/api/types.gen.ts`
- ✅ Foundation: clock, config, errors, storage (SQLite)
- ✅ Tooling: backend venv and pinned requirements, front-end scaffold, `scripts/gen_types.py`
- ✅ Setup guide for the real-phone test (`docs/SETUP.md`)
- ⬜ Camera I/O: frame buffer, MJPEG parser, DroidCam control, relay, fake DroidCam
- ⬜ Discovery (mDNS) and camera manager (slots, torch, battery)
- 🟡 Core server: auth and context written; hub, actions, API, WebSocket, main and admin missing
- 🟡 Theme: tokens, components, sound and i18n written; i18n test missing
- 🟡 Monitor: cams socket client and layout/tile logic written; Monitor, Security, Spectator and
  Kiosk views missing
- 🟡 Shell and GM console: routing, state client, pairing screen, console, cameras and phones
  panels written; screens/security/notices panels and the pairing/gm strings missing
- ⬜ Deploy: Dockerfile, compose, build.sh, bundle/deploy/check scripts
- ⬜ Integration: all tests, type-gen check, build, local end-to-end run with fake phones
- ⬜ Adversarial review and fixes
- ⬜ Deploy to the devserver and an end-to-end test there
- ⬜ **Gate:** real phones (bandwidth, TV Bro with 4 streams, torch, heat and battery)

## Phase 2 — Game core ⬜

- ⬜ Join by QR, lobby (name and colour)
- ⬜ QR badges: printable sheet and linking
- ⬜ Role dealing, Shhhhh and role reveal
- ⬜ Badge kills and reports, ghosts
- ⬜ Emergency button station, meetings, voting on phones, ejection
- ⬜ Comms sabotage and the comms fix station (radio dial)
- ⬜ Win detection, VICTORY/DEFEAT, GM live controls

## Phase 3 — Tasks ⬜

- ⬜ Task spots and printable QR sheets
- ⬜ 6 mini-games: Swipe Card, Fix Wiring, Download/Upload Data, Fuel Engines, Clear Asteroids,
  Start Reactor
- ⬜ Task lists, fake lists for impostors, task bar
- ⬜ Sabotage rules for tasks (lists hidden, no new tasks, started ones can finish), task win

## Log

- **2026-09-26** — Grilling session and plan approved. Mock-ups built, reviewed and approved
  (canvas version 4). Contract v1 reviewed through four lenses (security, realtime,
  plan fit, buildability) → contract v2. Foundation written and smoke-tested. Phase 1 build started
  at 17:49 with 7 module agents plus an integrator.
- **2026-09-26 18:14** — Build stopped to save usage: 6 agents were stopped mid-work, and the
  deploy agent had not started. The state was written down in `currentstate.md`. Public GitHub
  repo created: `main` holds the foundation, `dev` holds the unfinished Phase 1 files.
