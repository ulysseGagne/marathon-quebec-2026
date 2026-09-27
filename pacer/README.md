# Virtual Pacer — Marathon Beneva de Québec 2026

A phone app that shows one number while you run: how many seconds you are **behind (red)** or
**ahead (green)** of a perfect even-effort run to your target (2:59:30 by default), measured
at the exact spot where you are on the course.

**Open it on the iPhone:** <https://ulyssegagne.github.io/marathon-quebec-2026/pacer/>
then Safari → Share → **Add to Home Screen**. After the first visit it works with no
connection at all.

## Using it

| | |
|---|---|
| **Start screen** | Map with your position (and the direction the phone points, after “turn on compass”), the course, GPS accuracy, “Works offline”. |
| **START** | The clock starts when you tap. Tap as you cross the start mat. |
| **LIVE** | The clock follows the 8:00:00 gun; when the app sees you cross the start line it switches to your chip time (`LIVE · CHIP`). Use it if you forgot to tap START. Available from 5:00 on race morning. |
| **Running screen** | Top half: tilted map that turns with the course, more road ahead than behind, zooming out on straights and in before turns. Magenta dot = the ghost. Bottom half: the number, `BEHIND`/`AHEAD`, then time, official km, and the ghost's pace for the stretch you are on. Top right: projected finish (target + gap). |
| **Tunnel** | Tunnel Joseph-Samson (km 10.7–11.3 and 36.2–36.7, ~580 m each) has no GPS: the number shows `~` with stripes and is estimated from your pace relative to the ghost; it resyncs after the exit. |
| **Voice** | At each official km: “3 behind”, “10 ahead”, “on pace”. Nothing else. |
| **Stopping** | Nothing reacts to a tap. Hold **•••** (bottom right) 1 s for the run menu; changes there need a 1 s hold; stopping needs a 5 s hold. A reload, crash or swipe-away resumes the run from the saved start time. |
| **Run menu** | Start the clock at your detected start-line crossing, use gun time, nudge the start ±1/±5 s, set a new finish target from here, voice on/off, colour/black number, export GPX. |
| **Settings** | Target time, race-morning wind (direction + speed), seconds lost per aid station, voice, number style, gun time (if the start is delayed), a 20× simulated race. |
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
  Québec City) built from Overture Maps; course in sunlight-readable yellow.
- **Offline**: a service worker precaches all 8.6 MB on the first visit. Updates wait until you
  tap “Update ready” on the start screen, so nothing reloads during a run.

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
             freerun.js, mapview.js, store.js, voice.js, wake.js, sim.js, help.js
  data/      course.json, marathon-2026.gpx, basemap.pmtiles, practice-graph.bin,
             practice-dem.bin, practice-dest.json
  vendor/    maplibre-gl 5.24.0, pmtiles 4.5.0, NoSleep.js 0.12.0
  glyphs/, fonts/ (Barlow Condensed, OFL), icons/
  tools/     data pipeline (Python) and build_sw.mjs
  test/      node tests (engine, practice) and e2e.mjs (Playwright)
```

- Tests: `cd pacer && npm test` (full simulated marathons through the tracker, model checks,
  routing, out-and-back practice).
- Browser check: `PLAYWRIGHT=…/playwright/index.mjs node pacer/test/e2e.mjs out/`.
- After changing any app file: `node pacer/tools/build_sw.mjs` (new cache version).
- Data pipeline (Python 3, `pip install pymupdf numpy scipy shapely pyarrow pillow
  mapbox-vector-tile pmtiles`):
  `fetch_overture.py` → `register_startmap.py` → `build_geometry.py` → `build_distance.py` →
  `build_elevation.py` → `build_course.py`; `build_basemap.py`; `build_practice.py`.

Map data © OpenStreetMap contributors and Overture Maps Foundation. Terrain: AWS Terrain Tiles.
