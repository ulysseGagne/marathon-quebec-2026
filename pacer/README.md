# Virtual Pacer — Marathon Beneva de Québec 2026

A phone app that shows one number while you run: how many seconds you are **ahead (`+3`, time
in the bank)** or **behind (`−3`)** a perfect even-effort run to your target (2:59:30 by
default), measured at the exact spot where you are on the course. The voice says it too:
“3 seconds behind”.

**Open it on the iPhone:** <https://ulyssegagne.github.io/marathon-quebec-2026/pacer/>
then Safari → Share → **Add to Home Screen**. After the first visit it works with no
connection at all.

## Using it

| | |
|---|---|
| **Start screen** | Map with your position (and the direction the phone points, after “turn on compass”), the course, GPS accuracy, “Works offline”, and a reminder of the bar before the start (“CAF bar at 7:20, before the gun”) until the gun. |
| **START** | The clock starts when you tap. Tap as you cross the start mat. |
| **LIVE** | Press it in the corral from 5:00 on race morning: it counts down to 8:00:00, starts the clock by itself, then switches to your chip time as you run over the start line (`LIVE · CHIP`, the voice says “Chip time”), so an early or late gun does not matter. Pressed late, it still finds your crossing in the last 20 min. The crossing is the last one before you are 60 m past the line, so GPS wobble while standing at the line cannot fake an early one. **Try it now: Practice → LIVE rehearsal** (gun one minute after the tap, a “Go!”, start line 30 m ahead). |
| **Running screen** | Top half: tilted map that turns with the course, more road ahead than behind, zooming out on straights and in before turns. White bars across the road mark the official start and finish lines; the thin line before the start is the corral, and the ghost waits on the start line until the clock starts. You are the big yellow arrow; the ghost is the white arrow, at the front of the bright line (the course is thin behind the ghost and bright from it on). Bottom half: the number (`+3` = 3 s ahead, `−3` = 3 s behind), then time, official km, and the ghost's pace for the stretch you are on. Bottom right: the gear (hold 5 s for the run menu). Top right: how and when the clock started, to the second (`LIVE · CHIP 8:00:05`, `START 8:00:03`), and the projected finish (target + gap). |
| **Tunnel** | Tunnel Joseph-Samson (km 10.7–11.3 and 36.2–36.7, ~580 m each) has no GPS: the number shows `~` with stripes and is estimated from your pace relative to the ghost; it resyncs after the exit. |
| **Voice** | **When off pace** (default): warnings from 5 s off the ghost either way (10 s in Settings), at every 5 s step as the gap gets worse and as it gets better (“5, 10, 15 seconds behind”, then “10”, “5” coming back; the same ahead), then “on pace” the moment you meet the ghost again, only right after a warning; a wobble around a step is not repeated. Simulated: about one call every 10 min. Or every 250 m, 500 m, 1 km or 2 km. “About …” in the tunnel. In every mode but off, also “Take caffeinated bar” / “Take decaffeinated bar” at your bars, “Water in 250 meters” before every aid station (“Gel in 250 meters” at km 15.1 and 27) and “chip time”; a phrase that is still playing is never cut off by the next one. A recorded voice (227 clips, Piper `en_US-joe-medium`, CC0) plays through Web Audio in a `transient` audio session, so **Apple Music keeps playing** under it; that needs the side switch on ring. The other setting uses the iPhone's own voice, which pauses the music. |
| **Fuel** | Settings → Fuel. Suggested: CAF bar before the start (~7:20), then DECAF km 4.8 (0:20), DECAF km 10.1 (0:42), race gel 15.1 (1:05), CAF km 21.9 (1:34), race gel 27 (1:55), CAF km 31.9 (2:16): a fuel stop every 21–29 min, nothing after 2:16. In the race ~150 g of carbs (~50 g/h) plus 25 g before the start; 150 mg of caffeine (XACT bar: 30 g, 25 g carbs; Performance = CAF, +50 mg caffeine; race gels counted as ~25 g). 5 of 6 bars (3 CAF, 2 DECAF), the sixth a spare. Each bar is announced exactly 1 km before an aid station (2 min to eat, 2 to get ready, then “Water in 250 meters”), on flat ground or a gentle downhill, never uphill or in a tunnel. Type your own km (`c` = CAF); Settings checks the station 1 km on, slope and tunnel, and adds up carbs and caffeine. CAF/DECAF labels on the map (the pre-start one at the start line), “CAF bar in 240 m”, “CAF bar now”, “Water in 180 m” under the number, listed in the Splits. |
| **Stopping** | Nothing reacts to a tap. Hold the bottom row (the **gear**) for **5 s** to open the run menu: a bar fills across the row and the line above counts down; letting go early does nothing. Changes in the menu need a 1 s hold; stopping needs a 5 s hold. A reload, crash or swipe-away resumes the run from the saved start time. |
| **Screen off** | iOS freezes web apps while the phone is locked: no GPS, no voice, no logic until it is unlocked (only a native app could keep running). The app keeps the screen awake itself; when it is unlocked after a pause it catches up and says the gap within a few seconds (when off pace, only from 5 s, or “on pace” if you met the ghost after a warning). **Pocket mode** (Settings or run menu) is the battery-friendly alternative: black screen (black OLED pixels draw almost nothing), map paused, GPS and voice running; tap to look for 12 s. |
| **Colours** | B&W (default: white on black, one yellow accent for your arrow) or Amber (everything in one warm yellow). Aid stations (round badges with a drop, gels/sponges/oranges noted) and bars (CAF, DECAF labels) are black and white in both. |
| **Run menu** | Start the clock at your detected start-line crossing, use gun time, nudge the start ±1/±5 s, set a new finish target from here, voice interval, colours, pocket mode, export GPX. |
| **Settings** | Target time, race-morning wind (by hand, or from the Open-Meteo forecast for 8:00–11:00, fetched once; on race morning the start screen offers it on a chip), seconds lost per aid station and what each station has, voice mode and music behaviour, fuel plan, colours, pocket mode, gun time (if the start is delayed), a 20× simulated race (a different runner every time). |
| **Splits** | Every kilometre of the even-effort plan with clock and time of day. |
| **Practice** | Builds a route on real streets from where you stand to Pavillon Charles-De Koninck (DKN, Université Laval) — or any point you tap — there and back or one way, at the ghost pace you choose, with even effort on the hills. **Free run** works anywhere without a route. |

The in-app **Help** has the full race-day checklist (Home Screen, Precise Location, Auto-Lock
Never, Guided Access, Do Not Disturb, keeping the old battery warm).

## How it works

- **No accumulated error.** Running apps add up GPS steps, so errors pile up (0.5 % ≈ 200 m ≈
  50 s by km 40). The pacer snaps every GPS fix onto the course line and reads the official
  distance directly; the error stays around ±5 m (≈1 s) all race.
- **Tracker** (`js/tracker.js`): Kalman filter on (official distance, speed). It only searches
  the stretch you can have reached since the last fix, so the sections the course runs twice
  (km 10.6–11.4 = km 36.1–36.8 on the same road), the Quai des Cageux hairpin and the two tunnel
  passes cannot be confused. Outliers are gated; poor fixes in the tunnel are ignored; without
  GPS it carries you forward along the ghost's speed profile at your recent ratio to it.
  Re-acquires the right pass after a reload using the ghost's position.
- **Ghost** (`js/model.js`): constant metabolic power. Energy cost of running on a slope from
  Minetti et al. (2002) for climbs and a real-world curve for descents (best at −10 %, ~12 %
  faster; Minetti's treadmill data would have you run descents almost twice as fast), plus air
  drag (≈3 % of the cost at 4:15/km). Optional wind: headwind component × how exposed each
  stretch is (river 0.65, Plains 0.55, city streets 0.3, tunnel 0), tailwinds help half as much.
  Solved so the ghost crosses the line exactly on target.
- **Course** (`data/course.json`, `data/marathon-2026.gpx`): the earlier trace (checked against
  the official 2026 map) map-matched onto Overture Maps street centrelines; start and finish
  lines located by registering the official start-area map (runner's guide p. 15) to the
  streets — the start line lands within 4 m of the guide's own pin; both passes forced through
  Tunnel Joseph-Samson (the old trace cut a straight line up to 35 m off it). Official
  distance is measured, like the certified course, along the shortest legal line inside each
  road (a taut string 30 cm from the kerb): 42,107 m before scaling, i.e. within 0.2 % of the
  certified 42,195 m, and the residual is spread evenly. Elevation: mean of AWS Terrain Tiles
  (CDEM) and the earlier trace's elevations, bridges and tunnels interpolated.
- **Map**: MapLibre GL 5.24 with an offline dark basemap (`data/basemap.pmtiles`, 3.7 MB, all of
  Québec City) built from Overture Maps. The course is uploaded once; the ghost's front is a
  `line-gradient` on that line, changed in place each frame (no re-tiling, so it glides).
- **Battery**: the running screen redraws 5 times a second and only when something moved;
  nothing redraws in pocket mode; the compass is off during the run; the keep-awake video only
  plays on iOS before 18.4 (where the wake lock does not work in Home Screen apps); map
  transitions are off. Measured in desktop Chromium against the previous version: 5.5 map
  redraws/s instead of 9.4 while running, main-thread work down a third, 0.1 redraws/s instead
  of 3.7 on the start screen while standing still.
- **Offline**: a service worker precaches all 10.2 MB (1.6 MB of it voice clips) on the first
  visit. A new version takes over as soon as it is downloaded and the start screen reloads onto
  it by itself; during a run nothing reloads (the new version is used from the next launch).
  The build number is at the bottom of Settings.

## Limits

- The official course PDF (`MDQ_parcours-42-2km.pdf`) could not be downloaded from the build
  environment, so the geometry comes from the earlier checked trace, not a fresh tracing of the
  PDF. The shortest-route length matching the certified distance to 0.2 % is the main
  evidence that it is right. The km markers digitized earlier were too noisy (±50 m) to use.
- The physical km signs may differ from the app by a few tens of metres; the app's number is
  the one to trust.
- Elevation models are ~20 m resolution: big climbs are right, small bumps are approximate.

## Development

```
pacer/
  index.html, app.css, sw.js, manifest.webmanifest
  js/        app.js (UI), course.js, geo.js, model.js, tracker.js, gap.js, practice.js,
             freerun.js, mapview.js, theme.js, store.js, voice.js, wake.js, sim.js, help.js
  data/      course.json, marathon-2026.gpx, basemap.pmtiles, practice-graph.bin,
             practice-dem.bin, practice-dest.json
  voice/     recorded phrases (tools/build_voice.py)
  vendor/    maplibre-gl 5.24.0, pmtiles 4.5.0, NoSleep.js 0.12.0
  glyphs/, fonts/ (Barlow Condensed, OFL), icons/
  tools/     data pipeline (Python) and build_sw.mjs
  test/      node tests (engine, practice) and e2e.mjs (Playwright)
```

- Tests: `cd pacer && npm test` (full simulated marathons through the tracker, model checks,
  routing, out-and-back practice).
- Browser check: `PLAYWRIGHT=…/playwright/index.mjs node pacer/test/e2e.mjs out/`.
- After changing any app file: `node pacer/tools/build_sw.mjs` (new cache version).
- Voice clips: `pip install piper-tts joe-us-piper-voice lameenc numpy`, then
  `python3 pacer/tools/build_voice.py`.
- Data pipeline (Python 3, `pip install pymupdf numpy scipy shapely pyarrow pillow
  mapbox-vector-tile pmtiles`):
  `fetch_overture.py` → `register_startmap.py` → `build_geometry.py` → `build_distance.py` →
  `build_elevation.py` → `build_course.py`; `build_basemap.py`; `build_practice.py`.

Map data © OpenStreetMap contributors and Overture Maps Foundation. Terrain: AWS Terrain Tiles.
