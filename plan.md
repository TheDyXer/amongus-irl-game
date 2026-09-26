# Among Us IRL — the plan

> This is the approved plan (grilling session and approval on 2026-09-26), copied from the planning
> session. Where things stand now: [currentstate.md](currentstate.md). Checklist and log:
> [progress.md](progress.md). The binding technical spec for Phase 1 is [docs/CONTRACT.md](docs/CONTRACT.md).


## Context
The user asked for an Among Us–style 4-camera web panel fed by DroidCam phones, showing fewer
windows when fewer cameras are live. A grilling session (2026-09-26) grew it into a real-life
Among Us companion system for a house party (no date yet): a camera relay on the LAN
devserver, Security-station and spectator screens, a game-master console, and a phone app for
players (roles, QR-badge kills and reports, meetings, voting, QR-code task mini-games, comms
sabotage). Personal, non-commercial party use with our own art and sounds fits Innersloth's
fan-creation policy (innersloth.com/fan-creation-policy).

## Settled decisions (grilling log, condensed)
Cameras & screens
- Up to 4 DroidCam phones (spare Androids + the Galaxy A55), free "DroidCam Webcam & OBS
  Camera" app at 640×480. Found automatically (mDNS `_droidcamobs._tcp`) with a manual-IP
  fallback; the GM assigns each phone a slot (CAM 1–4) and an editable room plate once.
- Window count = live cams only. Layouts: 1 = full · 2 = side by side · 3 = two on top + one
  centred below · 4 = 2×2. A dropping cam flickers to static, then its window closes.
- Views: Security station (player kiosk: USE → cams → ✕), Spectator wall (always on; behaves
  like Security: static in sabotage, dark in meetings), GM console, and two device stations
  (Comms fix, Emergency button). Screens join by a pairing code the GM approves.
- Several screens at once (this PC, a laptop, an Android/Google TV); LAN only.

Game
- Dedicated game master (not playing): the GM console shows everything and can fix mistakes.
- Players join by scanning a QR on the TV → name + colour lobby, no approval. Player pages
  never receive cam streams.
- Server deals roles; "Shhhhh!" splash + role reveal on phones and screens.
- **Kills and reports use QR badges** worn on players' backs (user chose this over the mesh
  check, which the Deco research showed is unreliable for proximity): an impostor kills by
  scanning a living crewmate's badge (~1 m); anyone alive reports by scanning a dead body's
  badge.
- Meetings: emergency-button station + GM + badge reports; splash → big screens dark
  "MEETING IN PROGRESS" + countdown; voting and results on phones; ejection screen everywhere.
- Tasks: a printed QR at each task spot opens the mini-game on the player's own phone; 6
  mini-games in v1; impostors fake tasks; task bar; all tasks done = crew wins.
- Comms sabotage: from impostors' phones (+ GM); fixed at a Comms station with the radio-dial
  mini-game (+ GM override). While sabotaged: cams show static + flashing "[COMMS DISABLED]",
  task lists and room names vanish, new tasks can't start (started ones can finish; fake tasks
  follow the same rule).
- Winner detected automatically; GM can override. VICTORY/DEFEAT on phones and screens.
- Full Among Us look built from scratch; synthesized sounds; alarms on every screen; EN/HU
  switchable from the GM console.

Build
- Python 3.12 + FastAPI backend (like MathBoard), React 19 + TypeScript + Vite front end, one
  Docker Compose service on the devserver, deployed with the saved login (SSH + sudo).
- Clickable mock-ups first; the user approves the look before real code.

## Architecture
```
DroidCam phones ──MJPEG (1 conn each)──► devserver :8740  (Docker, network_mode: host)
  (mDNS _droidcamobs._tcp)               FastAPI app
                                          ├─ cams/discovery  python-zeroconf browser + manual IPs
                                          ├─ cams/relay      httpx stream → frame buffer → fan-out
                                          ├─ game/engine     pure state machine + rules
                                          ├─ ws              role-filtered state push, actions in
                                          └─ static          built React app
Screens / stations / phones / GM ◄── HTTP + WebSocket + /cam/{slot}.mjpg (authorised screens)
```
- **Relay:** one `httpx` streaming GET per assigned phone to `/video/640x480`. Detect the
  "DroidCam is Busy" HTML page (HTTP 200, `droidcam_busy`) → status BUSY, retry. Parse
  multipart frames (boundary `--dcmjpeg`; fall back to JPEG SOI/EOI scan), keep the latest
  frame + timestamp, notify subscribers. Live = frame < 2 s old. Reconnect with backoff 1→10 s.
- **Viewer stream (revised after the TV research):** frames go to screens as binary messages
  on a dedicated WebSocket `/ws/cams` (header: slot, seq, timestamp + JPEG bytes), rendered
  with `createImageBitmap` → canvas. Reason: Chromium allows only 6 HTTP/1.1 connections per
  host:port, so four MJPEG `<img>` streams would starve every other request (WebSockets use a
  separate pool of 255). Bonus: exact client-side liveness and server-side per-screen fps
  caps (TV mode 15 fps). Only paired Security/Spectator screens and the GM may subscribe.
  A debug-only `GET /cam/{slot}.mjpg` stays for the GM.
- **Phone extras:** poll `GET /v1/phone/battery_info` every 60 s (battery % + charging in the GM
  console). Torch for the watching light via `PUT /v1/camera/torch_toggle`, capability
  auto-detected per phone (HTTP 550 = needs Pro → on-screen light only).
- **Game engine:** deterministic, framework-free Python module (`lobby → playing ⇄ meeting →
  ended`), unit-tested. Every change snapshots to SQLite so a restart resumes the round.
- **Realtime:** one WebSocket per client. The server pushes a full *view* per role (screen,
  station, player, ghost, GM) — players never get others' roles or any cam data — plus
  one-shot events (splashes, sounds). Clients send typed actions; the server validates all.
  Phones that slept resync on reconnect.
- **Types:** Pydantic v2 models for state/actions → JSON Schema → `json-schema-to-typescript`
  → `frontend/src/api/types.gen.ts`; a test fails if the generated file is stale.
- **Auth:** device pairing (4-letter code → GM approves + picks the view → long-lived httpOnly
  cookie, revocable); GM PIN (argon2 via `argon2-cffi`, set on first visit to `/gm`); player
  cookie from the join flow. Every HTTP route and WS action checks the role. Badge and task
  tokens are random and unguessable.
- **Storage:** SQLite (stdlib) in a Docker volume: cameras, screens, badges, task spots,
  settings, PIN hash, game snapshot.

## QR badges (kills + reports)
- Printable badge sheet from the GM console (15 reusable badges, ≈8×10 cm, QR ≈6 cm, big
  number, neutral crewmate outline). URL `http://192.168.11.220:8740/b/<token>`.
- Linking in the lobby: the phone asks "Scan your badge"; scanning an unlinked badge links it
  (fallback: type the badge number). The GM can relink.
- Scanning a badge in game:
  - living impostor → living crewmate, cooldown ready, no meeting → **kill**. The impostor's
    phone confirms; the victim's phone shows "YOU WERE KILLED" (vibrates if awake) → ghost.
  - any living player → dead, unreported body → **report** → DEAD BODY REPORTED (reporter +
    body colours) → meeting.
  - anything else → neutral "Nothing happens" (crewmates can't learn roles); impostor-only
    hints on impostors' phones ("Kill ready in 23 s", "That's your teammate").
- A scan that opens a browser without the player cookie → "Open this in the browser you
  joined with" + re-link by the player's short code.
- House rules (printed on the GM's rules sheet): badge on the back; the impostor taps the
  victim's shoulder after scanning; dead players stay down with the badge visible until
  reported; no photos of badges.

## Views
- **Security station** (`/security`): idle console art + USE button → monitor opens (bg fade
  0.25 s + sweep 0.25 s; close 0.1 s + fade 0.3 s, per the game) → ✕ closes. While open it
  triggers the watching light. Idle 90 s → "Still watching?" → closes after 10 s.
- **Spectator wall** (`/spectator`, the TV): lobby = join QR + player list; in game =
  always-on monitor. Doesn't trigger the watching light (in the game, ghosts don't).
- **Monitor component** (shared): layouts per live-cam count, room plates, bezel with "+"
  dividers, drop → static + "SIGNAL LOST" 10 s → window closes → re-flow; sabotage → static
  + flashing red "[COMMS DISABLED]" per feed; meeting → dark "MEETING IN PROGRESS" + timer.
- **Comms fix station** (`/station/comms`): radio dial; turn until the wave is a clean sine,
  hold 1 s → green light → sabotage cleared everywhere.
- **Emergency button station** (`/station/emergency`): big red button → "Who's calling?"
  colour picker (living players) → per-player limit + cooldown; locked during sabotage.
- **Player phone** (`/join`, `/play`): join (name + colour) → scan badge → lobby → Shhhhh +
  role reveal → play (task list by room; impostors also SABOTAGE + kill-cooldown indicator;
  ghost mode after death) → voting (cards, SKIP, confirm; votes final) → results → ejection →
  VICTORY/DEFEAT.
- **Task QR target** (`/t/{spotCode}`): opens the spot's mini-game if it's on the player's list
  (impostor: fake, never counts); "not your task" otherwise; sabotage rules apply.
- **Mini-games (v1):** Swipe Card, Fix Wiring, Download/Upload Data (2 spots), Fuel Engines
  (2 spots), Clear Asteroids, Start Reactor. Pointer-event React components; completion is
  reported to and validated by the server.
- **GM console** (`/gm`, PIN): Setup — cameras (discovered phones, battery, assign slot + room
  plate, manual IP), screens (pairing approvals, view, TV mode), badges + task spots (create,
  printable A4 sheets incl. the join QR and a rules sheet), game settings, language, volume,
  cams on/off. Live — everything visible (cams, roles, deaths, votes, tasks) plus controls
  (start/end, call meeting, sabotage/clear, undo kill, relink badge, kick, override winner).

## Game settings & rules (confirmed defaults; settings adjustable in the GM console)
- 4–15 players, 18 colours, names ≤ 10 chars. Impostors 1 (4–6 players) / 2 (7–9) / 3 (10+).
- Kill cooldown 60 s; 1 emergency meeting per player, 30 s cooldown at start and after
  meetings; discussion 90 s, voting 60 s; confirm ejects on, anonymous votes off; 4 tasks per
  crewmate; sabotage cooldown 60 s, one sabotage at a time.
- Votes final; tie or SKIP majority ejects no one; kill cooldowns reset after meetings; no
  kills during meetings. Ghosts can't vote, report or call meetings; crew ghosts can do tasks,
  impostor ghosts can sabotage. Emergency button locked during sabotage. No mid-game joins;
  refresh/lock resumes; GM can kick.
- Win: crew when all impostors are ejected or all crew tasks are done; impostors when living
  impostors ≥ living crewmates.
- Cams stream for the whole session (GM "cams off" switch). Watching light ≈1 Hz.
- Sounds: meeting alarm on every screen; comms sabotage = short alert (no klaxon, as in the
  game); UI blips/static on the screen in use. Hungarian strings drafted for the user's review.

## Theme (own art, no game assets)
- Crewmate SVG (proportions + 18 body/shadow colours from the research; visor `#95CADC`),
  thick black outlines, `paint-order: stroke fill` outlined text.
- Starfield canvas (~500 square dots, size-based parallax drift). Monitor bezel: dark
  blue-grey housing, heavy black outline, thick "+" dividers; canvas TV static.
- Splashes: Shhhhh, role reveal (Crewmate `#8CFFFF`, Impostor `#FF1919`), EMERGENCY MEETING /
  DEAD BODY REPORTED band snap, ejection, VICTORY (`#8CFFFF`) / DEFEAT (`#FF0000`).
- Fonts (self-hosted, work offline): Lilita One / Luckiest Guy (titles, splashes), Barlow
  Condensed ExtraBold (UI), Arimo (names), VT323 (monitor text).
- WebAudio-synthesized sounds (panel blips, static hiss, alarm, alert, task ding, kill sting,
  ejection whoosh, victory/defeat). One tap per screen unlocks audio.
- UI strings in `i18n/en.json` + `i18n/hu.json`.

## Phases (each ends deployed and playable)
0. **Mock-ups** — clickable private Artifact: Security (USE, 1/2/3/4 layouts, drop, comms
   static, meeting dark), a splash, TV lobby, player phone (crew / impostor / ghost / voting),
   a badge, GM console. **Gate: user approves the look.**
1. **Cams** — repo + tooling, fake DroidCam simulator, discovery + relay, pairing, GM setup
   (cameras, screens, plates, language, volume), Security + Spectator views, monitor theme,
   watching light (+ torch where allowed), sounds, Docker + deploy. **Gate: real phones.**
2. **Game core** — join/lobby, badges (print + link), roles, Shhhhh + reveal, badge kills and
   reports, emergency station, meetings, voting, ejection, win detection, comms sabotage + fix
   station, GM live controls.
3. **Tasks** — task spots + QR sheets, 6 mini-games, task lists + fake lists, task bar,
   sabotage/task rules, task win.

## Repo layout — new repo `X:\amongus-irl` (git init; commits only when the user asks)
- `backend/app/` — `main.py`, `config.py`, `auth.py`, `ws.py`, `storage.py`, `i18n.py`,
  `cams/{discovery,relay,droidcam}.py`, `game/{engine,rules,models,badges,tasks}.py`.
- `backend/tests/` — pytest (engine rules, badge scan outcomes, relay vs. fake phone, auth).
- `frontend/src/` — `views/`, `monitor/`, `minigames/`, `theme/`, `sound/`, `i18n/`,
  `api/types.gen.ts`.
- `tools/fake_droidcam.py` — MJPEG + Busy page + battery/torch endpoints + mDNS advert; run
  several on different ports to simulate 4 phones.
- `Dockerfile`, `compose.yaml`, `deploy/build.sh`, `scripts/{bundle,deploy,gen_types}.py`.
- **Reuse:** `X:\mathit\Dockerfile` (multi-stage node:22 → python:3.12-slim, non-root user),
  `X:\mathit\compose.yaml` (`restart: unless-stopped`, `no-new-privileges`, `cap_drop: [ALL]`,
  `mem_limit`, json-file log rotation, python urllib healthcheck), `X:\mathit\scripts\deploy.py`
  + `bundle.py` (tarball → SFTP → `sudo -S` background `deploy/build.sh`, log file), and
  `connect()` in `C:\Users\User\.claude\statusline-deploy.py` (reads
  `X:\mathit\.runtime\server-access.json`, RejectPolicy host-key check). Never print the
  password.

## Deploy
- Server dir `~/amongus-irl`, compose project `amongus-irl`, port **8740**,
  `network_mode: host` (mDNS discovery), volume for SQLite.
- `build.sh` (sudo): `docker compose build && docker compose up -d`, then idempotent
  `ufw allow from 192.168.11.0/24 to any port 8740 proto tcp comment amongus-irl`.
- `deploy.py`: bundle → upload → sudo build in background → poll the log → check
  `http://192.168.11.220:8740/api/health` from the PC.
- Recommended in the MikroTik: DHCP reservation for the server (192.168.11.220), optionally
  for camera phones.
- Camera-phone setup sheet: DroidCam Webcam & OBS Camera (free), notifications allowed,
  battery optimisation off, 640×480, on a charger, landscape mount, same Wi-Fi band.
- TV: **TV Bro** from Google Play (WebView engine; "Keep screen on" ON — otherwise Google TV
  Ambient Mode kicks in after 10 min; custom home page `http://192.168.11.220:8740`; use the
  IP, not `.local`). Avoid Puffin TV (cloud-rendered, can't reach the LAN), Firefox for TV
  (discontinued), sideloaded Chrome. Dedicated 24/7 box: Fully Kiosk (APK + PLUS). Verify 4
  streams in Phase 1; fallback: HDMI from the laptop.
- Plain http is not a secure context: no Screen Wake Lock/AudioWorklet (use oscillators /
  AudioBufferSourceNode; kiosk laptops set "never sleep" in the OS). Animate only `transform`
  and `opacity` (weak TV GPUs).

## Verification
- `pytest` backend: role dealing, cooldowns, badge scan outcomes (kill / report / neutral /
  cooldown / teammate / meeting), vote tally (skip/tie), ejection, win conditions, sabotage ×
  task rules, relay against `fake_droidcam.py` (frames, Busy page, stall → static → closed,
  reconnect), auth (player cookie can't open `/cam/*`; unpaired device can't join a view).
- Front end: `tsc -b` + `vite build`, type-gen freshness test, layout unit tests (tsx --test,
  like MathBoard). Chrome visual checks of every view with fake cams (1/2/3/4, drop, comms,
  meeting, splashes, phone views, badge sheet print preview).
- On the server: deploy; 4 fake phones (or real ones) discovered; pair PC/laptop/TV; USE →
  cams → stop one phone → static → re-flow. Full mock round with 4–5 browser players (separate
  Chrome profiles; badge and task scans simulated by opening their URLs): join → badge link →
  roles → task → sabotage → fix → kill → report → vote → ejection → victory.
- Real devices: badge scanning from ~1 m with phone cameras, Android TV browser with 4
  streams, phone heat/battery over 30 min, Wi-Fi bandwidth, torch support per phone.

## Out of scope (can be added later)
Reactor/O2/lights/doors sabotage, vents, admin map/vitals/door log, visual tasks (MedBay
scan), cosmetics/hats, chat, internet access, recording, mesh-based location.

## Facts appendix
- Devserver: Ubuntu 24.04.5, i7-2700K 4c/8t, 15 GiB RAM, wired 1 Gbps, 192.168.11.220 (DHCP);
  Python 3.12, Node 18/22 (nvm); Docker needs sudo; ufw on; no avahi; ports 8000–9000 free.
- Network: MikroTik router 192.168.11.1 (DHCP); TP-Link Deco mesh (3 nodes, AP mode).
- PC: wired 192.168.11.193; Node 24, Python 3.14, Docker Desktop; project home `X:\`.
- DroidCam: one video client per phone; `/video/640x480` MJPEG; free = 640×480 clean; control
  API officially Pro-only (550), paths drift; Android streams with the screen off (keep on
  charger, battery optimisation off, Notifications allowed); serve pages over plain http.
