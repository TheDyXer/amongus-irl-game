# Among Us IRL — setup guide (Phase 1: cameras)

Everything runs on the devserver at **http://192.168.11.220:8740**. All devices must be on the
house Wi-Fi/LAN.

## 1. Camera phones (DroidCam)

1. Install **"DroidCam Webcam & OBS Camera"** (Dev47Apps, free) from Google Play.
2. Open it once and allow **Camera** and **Notifications** (needed for streaming with the screen
   off).
3. Give each phone a **unique device name** (Settings → About phone → Device name), e.g.
   `CAM-NAV`, `CAM-ADMIN`. The server tells phones apart by that name.
4. Battery: keep every camera phone **on a charger**, and set DroidCam's battery usage to
   **Unrestricted** (Settings → Apps → DroidCam → Battery). Otherwise Android may stop the stream.
5. Wi-Fi: connect to the house network; keep all devices on the same band if you can.
6. Mount the phone in **landscape**, pointing at the hallway/room. Leave the DroidCam app open on
   its main screen.
7. The free app streams 640×480, which is exactly what the panel uses. The flashlight blink (the
   "someone is watching" light) needs DroidCam Pro on that phone; the GM console shows
   "needs Pro" if it isn't available.
8. **One viewer per phone.** While the game runs, never open the DroidCam PC client or a browser
   on a camera phone's address — the phone would show "busy" for our server. The GM console
   warns "another app is connected to CAM n" if that happens. (House rule: connecting to a camera
   phone is cheating.)
9. Optional: in the MikroTik router, give each camera phone a DHCP reservation. Not required —
   phones are found automatically even when their IP changes.

In the GM console → **Cameras**: the phones appear under *Known phones* once DroidCam is open.
Assign each to a slot (CAM 1–4) and type its room plate (e.g. `NAVIGATION`). If a phone doesn't
show up, use **Add by IP** with the address DroidCam displays.

## 2. Screens

| Screen | Browser | Settings |
|---|---|---|
| Security station (laptop) | Chrome or Edge, kiosk mode: `chrome --kiosk http://192.168.11.220:8740/` | Power: never sleep while plugged in |
| Living-room TV (Android/Google TV) | **TV Bro** from Google Play | Engine: WebView · *Keep screen on*: ON · Home page: `http://192.168.11.220:8740` |
| This PC | any browser | GM console at `/gm`, optionally a spectator tab |

Avoid Puffin TV (it renders in the cloud and can't reach the LAN) and sideloaded Chrome on the TV.
If the TV stutters: GM console → Screens → set its **max fps** to 10 and turn on **low motion**;
last resort, plug the laptop into the TV via HDMI.

### Pairing a screen

1. GM console → **Screens** → **PAIR A SCREEN** (the pairing window stays open for 5 minutes).
2. On the screen, open `http://192.168.11.220:8740/` — a big 4-letter code appears.
3. In the GM console, find that code in the list and approve it as **Security** or **Spectator**.
4. The screen switches by itself. Tap **TAP TO START** once (unlocks sound and fullscreen).

Screens stay paired (browser cookie). To move a screen to another role, change its view in the
GM console; to unpair, **Revoke**.

## 3. Game master

- First start: open `http://192.168.11.220:8740/gm`, enter the **setup token** printed by the deploy
  (8 letters) and choose a **6–8 digit PIN**.
- Forgot the PIN: on the server, `docker compose exec app python -m app.admin set-pin`
  (in `~/amongus-irl` on the server).
- **Never log in as GM on a kiosk screen** (Security laptop, TV). Use the PC or your own phone.
- Language (EN/HU), volume, cameras on/off and the flashlight blink are in the console sidebar.

## 4. Router (MikroTik)

Recommended: a DHCP reservation for the server (**192.168.11.220**) so the address on every screen
stays valid.

## 5. Troubleshooting

| Symptom | Fix |
|---|---|
| A camera shows "busy" | Something else is connected to that phone (PC client, browser, another server). Close it. |
| Camera window shows static, then disappears | The phone lost Wi-Fi or DroidCam was closed/killed. Check the charger and battery setting. |
| A phone never appears | DroidCam not open, or on another network. Use *Add by IP*. |
| Screen says "Ask the game master to open pairing" | Open the pairing window in the GM console. |
| TV/laptop screen went black after a while | Enable *Keep screen on* (TV Bro) / disable sleep (laptop). |
