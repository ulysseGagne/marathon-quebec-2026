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
| **Start screen** | Map with your position (and the direction the phone points, after “turn on compass”), the course, GPS accuracy, “Works offline”, and a reminder of the bar before the start (“CAF bar at 7:20, before the gun”) until the gun. The first time, a “Before you start” card asks for the two permissions, one button each: Location (needed; the iPhone popup comes only when it is tapped) and, on iPhone, the Compass (optional, “motion and orientation”). Pressing START or LIVE never brings up the compass popup. |
| **START** | The clock starts when you tap. Tap as you cross the start mat. |
| **LIVE** | Press it in the corral (from 5:00 on race morning; ~7:45 is right): it counts down to 8:00:00 on screen and out loud (“Start in 15 minutes”… every minute from 10… “15 seconds”, “Gun time: 8 a.m. exactly”), starts the clock by itself, stays quiet about the gap until chip time takes over, then switches to your chip time (`LIVE · CHIP 8:00:05`; ~15 s after you cross the voice says “Chip time: 8 a.m. and 5 seconds”), so an early or late gun does not matter. Pressed after the gun, it says the gun time it counts from (the one set in Settings); **START** says “Start time: …” to the second. The crossing is when you leave the line for good: counted once you are 60 m past it, timed from the GPS points either side, or from the moment you started moving if GPS drift had put you just past the line while you stood there; from 30 s before the gun. Simulated standing at the line 10 min: within 2 s every time, 0.5 s typically. Pressed late, it still finds your crossing in the last 20 min. **Check** (start screen, and top left while waiting) shows the pre-race check: GPS, offline, screen, target, voice, bars, reminders. **Try it now: Practice → LIVE rehearsal** (gun one minute after the tap, a “Go!”, start line 30 m along the route). |
| **Running screen** | Top half: tilted map that turns with the course, more road ahead than behind, zooming out on straights and in before turns. White bars across the road mark the official start and finish lines; the thin line before the start is the corral, and the ghost waits on the start line until the clock starts. You are the big yellow arrow; the ghost is the white arrow, at the front of the bright line (the course is thin behind the ghost and bright from it on). Bottom half: the number (`+3` = 3 s ahead, `−3` = 3 s behind), then time, official km, and the ghost's pace for the stretch you are on. Bottom right: the gear (hold 5 s for the run settings). Hold the map 5 s to unlock it: no following, flat and north up, drag and pinch, ◎ centres it on you; it locks again like the run settings close (Close at the top right, 30 s untouched, or pocket mode going black). Top right: how and when the clock started, to the second (`LIVE · CHIP 8:00:05`, `START 8:00:03`), and the projected finish (target + gap). |
| **Tunnel** | Tunnel Joseph-Samson (km 10.7–11.3 and 36.2–36.7, ~580 m each) has no GPS: the number shows `~` with stripes and is estimated from your pace relative to the ghost; it resyncs after the exit. |
| **Voice** | **When off pace** (default): a call at each step as soon as the gap reaches it, getting worse and getting better: 5, 10, 15, 20, 25, 30, 45 s, 1 min, 90 s, 2, 3, 4, 5 min (nothing past 5 min). 5, 10, 15 behind, back to 10, 15 again, 10, 5: every one is said, then “on pace” when you meet the ghost; inside ±5 s after that nothing (no repeated “on pace”); the same ahead. A wobble around a step is not repeated; there is no waiting between calls (the ladder itself stops chatter), and if the gap jumps back inside past the 5 s step (after a tunnel or a pause) that improvement is said once. Or every 250 m, 500 m, 1 km or 2 km. “About …” in the tunnel. In every mode but off, also “Take caffeinated bar” / “Take regular bar” at your bars, “Water in 200 meters” before every aid station (“Gel in 200 meters” at km 15.1 and 27), the gun, chip or start time to the second, “Off course: 90 meters from the course” / “Back on course”, and the turns. The voice is the iPhone's own (`speechSynthesis`): **Apple Music gets quieter while it talks** and comes back right after, and it speaks with the side switch on silent too. A phrase still being said is never cut off by the next one. |
| **Fuel** | Settings → Fuel. Suggested: CAF bar before the start (~7:20), then REG km 4.8 (0:20), REG km 10.1 (0:42), race gel 15.1 (1:05), CAF km 21.9 (1:34), race gel 27 (1:55), CAF km 31.9 (2:16): a fuel stop every 21–29 min, nothing after 2:16. In the race ~150 g of carbs (~50 g/h) plus 25 g before the start; 150 mg of caffeine (XACT bar: 30 g, 25 g carbs; Performance = CAF, +50 mg caffeine; race gels counted as ~25 g). 5 of 6 bars (3 CAF, 2 REG), the sixth a spare. Each bar is announced exactly 1 km before an aid station (2 min to eat, 2 to get ready, then “Water in 200 meters”), on flat ground or a gentle downhill, never uphill or in a tunnel. Type your own km (`c` = CAF); Settings checks the station 1 km on, slope and tunnel, and adds up carbs and caffeine. CAF/REG labels on the map (the pre-start one at the start line), “CAF bar in 240 m”, “CAF bar now”, “Water in 180 m” under the number, listed in the Splits. |
| **Directions** | On by default (Settings, run settings). Each turn is said 50 m before it: “Turn right in 50 meters”; with the next one when it comes within 60 m (“Turn right in 50 meters, then left”, up to three); “U-turn to the left in 50 meters” at a hairpin, “Turn sharp right” from 120°, “Bear left” at a fork (practice routes). The status line shows the next turn from 60 m out. Turns are found on the course line simplified by 7 m, so curving roads say nothing: 62 on the marathon (60° or more, a closed course), every corner of 35° or more on practice routes. Never said before the turn before it is behind you. |
| **Stopping** | Nothing reacts to a tap. Three long holds, each with a fill sliding across the whole screen and a countdown (letting go early, or sliding, does nothing): the bottom row (the **gear**) **5 s** for the run settings, the **map 5 s** to unlock it, **End run 10 s** (in red). Changes in the run settings need a 1 s hold. A reload, crash or swipe-away resumes the run from the saved start time. |
| **Off course** | Clearly off the course (over 40 m from every part of it, and 25 m beyond the fix's own accuracy, for 12 s straight, never around the tunnels): “Off course: 90 meters from the course” (again past 100 m, 200 m, 500 m, 1 km), the number shows the distance with OFF COURSE, and the map shows the raw GPS position and direction, flat, zoomed out to show the course. No gap until you are back (“Back on course”), then it is measured from where you rejoined. Simulated marathons with tunnels, stray fixes and a ±10 m GPS never went off; a 90 m wrong turn is caught ~20 s after the turn. |
| **Screen off** | iOS freezes web apps while the phone is locked: no GPS, no voice, no logic until it is unlocked (only a native app could keep running). The app keeps the screen awake itself; when it is unlocked after a pause it catches up and says the gap within a few seconds (when off pace, only from 5 s, or “on pace” if you met the ghost after a warning). **Pocket mode** (Settings or run settings) is the battery-friendly alternative: black screen (black OLED pixels draw almost nothing), map paused, GPS and voice running; tap to look for 12 s. Going black closes the run settings, so a touch in the pocket cannot land on them. |
| **Colours** | B&W (default: white on black, one yellow accent for your arrow) or Amber (everything in one warm yellow). Aid stations (round badges with a drop, gels/sponges/oranges noted) and bars (CAF, REG labels) are black and white in both. |
| **Run settings** | Start the clock at your detected start-line crossing, use gun time, nudge the start ±1/±5 s, set a new finish target from here, voice interval, colours, pocket mode, export GPX, end run. |
| **Settings** | Target time, race-morning wind (by hand, or from the Open-Meteo forecast for 8:00–11:00, fetched once; on race morning the start screen offers it on a chip), seconds lost per aid station and what each station has, voice mode and music behaviour, fuel plan, colours, pocket mode, gun time (if the start is delayed), a 20× simulated race (a different runner every time). |
| **Splits** | Every kilometre of the even-effort plan with clock and time of day. |
| **Practice** | Two routes, one way each: **Sommet → DKN** (Sommet 3V, 937 avenue Roland-Beaudin, to Pavillon Charles-De Koninck, Université Laval) and **DKN → Sommet**, 2.86 km, the same line both ways, drawn by hand (`data/practice-route.gpx`, DKN to Sommet 3V; `tools/practice_route.mjs` turns any GPX of the run into it), at the ghost pace you choose, with even effort on the hills. Standing at one end picks the route that starts there. **Free run** works anywhere without a route. |

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
- **Offline**: a service worker precaches all 8.7 MB on the first
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
             turns.js, freerun.js, mapview.js, theme.js, store.js, voice.js, wake.js, sim.js,
             help.js
  data/      course.json, marathon-2026.gpx, basemap.pmtiles, practice-route.gpx,
             practice-dem.bin, practice-places.json (practice-graph.bin: the street graph
             the tests route on; the app no longer loads it)
  vendor/    maplibre-gl 5.24.0, pmtiles 4.5.0, NoSleep.js 0.12.0
  glyphs/, fonts/ (Barlow Condensed, OFL), icons/
  tools/     data pipeline (Python) and build_sw.mjs
  test/      node tests (engine, practice) and e2e.mjs (Playwright)
```

- Tests: `cd pacer && npm test` (full simulated marathons through the tracker, model checks,
  routing, the practice routes, off-course detection, the voice ladder, directions).
- Browser check: `PLAYWRIGHT=…/playwright/index.mjs node pacer/test/e2e.mjs out/`.
- After changing any app file: `node pacer/tools/build_sw.mjs` (new cache version).
- Icons and the link-preview card (`icons/og.png`), from one drawing in the app's style:
  `PLAYWRIGHT=…/playwright/index.mjs node pacer/tools/build_icons.mjs`.
- Data pipeline (Python 3, `pip install pymupdf numpy scipy shapely pyarrow pillow
  mapbox-vector-tile pmtiles`):
  `fetch_overture.py` → `register_startmap.py` → `build_geometry.py` → `build_distance.py` →
  `build_elevation.py` → `build_course.py`; `build_basemap.py`; `build_practice.py`.

Map data © OpenStreetMap contributors and Overture Maps Foundation. Terrain: AWS Terrain Tiles.
