// Virtual Pacer — Marathon Beneva de Québec 2026.
// One number: seconds behind (+) or ahead (−) of a perfect even-effort run, measured
// where you are on the course.
import { Course } from './course.js';
import { Tracker } from './tracker.js';
import { GapDisplay, fmtGap, spokenGap, offPaceCue, offPaceLevel, offPaceConfig } from './gap.js';
import { fmtClock, fmtPace } from './model.js';
import { MapView } from './mapview.js';
import { Graph, Dem, practiceSpec, withStartLine, PRACTICE_ROUTES } from './practice.js';
import { FreeRun } from './freerun.js';
import { loadSettings, saveSettings, loadRun, saveRun, clearRun, TrackLog, toGpx, parseBars, fmtBars, SUGGESTED_BARS } from './store.js';
import { Wake } from './wake.js';
import { Voice } from './voice.js';
import { simulate } from './sim.js';
import { angleDiff, haversine, bearingDeg } from './geo.js';
import { helpHtml } from './help.js';
import { fetchRaceWind } from './weather.js';
import { THEMES, THEME_ORDER, THEME_NOTES, applyTheme, themeName } from './theme.js';

const VERSION = '2026.09.28';
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const clock = { now: () => Date.now() };

const S = {
  settings: loadSettings(),
  marathon: null,        // Course
  course: null,          // active Course (marathon or practice)
  plan: null,            // active Plan
  readyPlan: null,       // marathon plan with current settings (ready screen)
  tracker: null,
  free: null,            // FreeRun when kind === 'free'
  gap: new GapDisplay(),
  run: null,             // persisted run object
  phase: 'boot',
  fix: null, fixReal: 0, gpsError: null, watchId: null,
  heading: null, headingAt: 0, compass: false,
  map: null, mapReady: false,
  follow: true, overviewShown: false,
  cam: { bearing: 0, zoom: 16, lastReal: 0 },
  wake: new Wake(),
  voice: new Voice(),
  track: null,
  lastVoiceK: null,      // last distance step (voice interval) that was announced
  resume: null,          // catching up after iOS paused the app
  hiddenAt: 0,
  peekUntil: 0,          // pocket mode: screen shown until then (ms)
  freeMap: false,        // the map unlocked (5 s hold on it): no following, flat, draggable
  freeMapIdleMs: 30000,  // ...until this long without a touch on it
  offNow: null,          // {r} while clearly off the course
  offline: null, updateReady: false,
  graph: null, dem: null, places: null,
  practiceDraft: null,
  sim: null,
  lastPanel: {},
  menuTimer: null,
  crossHintUntil: 0,
};

// ---------------------------------------------------------------- boot
async function boot() {
  S.settings.theme = themeName(S.settings.theme);
  applyTheme(S.settings.theme);
  S.voice.enabled = voiceMode() !== 'off';
  registerSW();
  try {
    const spec = await (await fetch('data/course.json')).json();
    S.marathon = new Course({ ...spec, id: 'marathon' });
  } catch (e) {
    $('#boot-msg').textContent = 'Could not load the course. Open once with a connection.';
    throw e;
  }
  S.readyPlan = planFor(S.marathon, null);
  S.map = new MapView($('#map'));
  try {
    const buf = await (await fetch('data/basemap.pmtiles')).arrayBuffer();
    await S.map.init(buf);
    S.map.setTheme(S.settings.theme);
    S.mapReady = true;
  } catch (e) {
    console.error('map failed', e);
    toast('Map could not load: the number still works.');
  }
  bindUi();
  if (!compassNeedsTap()) enableCompass(); // Android / desktop: no permission prompt
  const saved = loadRun();
  const resuming = saved && !saved.stopped && clock.now() - saved.t0 < 8 * 3600e3;
  // Location: right away if it is already allowed (or blocked: then say so), or on a run;
  // the first time, only once the welcome card has said why (its button asks).
  const perm = await geoPermission();
  if (resuming || onboarded() || perm === 'granted' || perm === 'denied') startGps();
  if (resuming) {
    S.run = saved;
    setupRunObjects();
    S.track = new TrackLog(saved.id);
    enterPhase('running');
    const ok = await S.wake.enable();
    if (!ok) S.needWakeTap = true;
    toast('Run resumed');
  } else {
    if (saved) clearRun();
    useCourse(S.marathon, S.readyPlan);
    enterPhase('ready');
    maybeWelcome(perm);
  }
  loop();
  setInterval(watchdog, 5000);
  maybeSuggestWind();
}

function planFor(course, run) {
  let p;
  if (run && (run.kind === 'practice' || run.kind === 'free')) {
    p = course.plan({ target: run.target });
  } else {
    const src = run || S.settings;
    p = course.plan({ target: src.target, wind: src.wind, aidSeconds: src.aidSeconds });
  }
  if (run && run.replan) p = p.replan(run.replan.d, run.replan.t, run.replan.target);
  return p;
}

function useCourse(course, plan, { keepTracker = false } = {}) {
  const same = keepTracker && S.course === course && S.tracker;
  S.course = course;
  S.plan = plan;
  if (!same) {
    S.tracker = course ? new Tracker(course, { hint: trackerHint, plan: () => S.plan }) : null;
    if (S.fix && S.tracker && Date.now() - S.fixReal < 10000) S.tracker.update({ ...S.fix, t: clock.now() });
  }
  if (S.mapReady) {
    if (course) {
      S.map.setCourse(course);
      if (course.id === 'marathon') showBars(); else S.map.setBars(course, []);
    } else S.map.clearCourse();
  }
  S.overviewShown = false;
}

// Where to look for you when (re)acquiring the course: your last saved position if it
// is recent (after a reload), otherwise where the ghost is, otherwise the start line.
function trackerHint(t) {
  const r = S.run;
  const last = r ? loadLastPos(r.id) : null;
  if (last && t - last.t < 15 * 60000 && t >= last.t) {
    const dt = (t - last.t) / 1000;
    return { d: last.d + last.v * dt, v: last.v, sd: 60 + 1.5 * dt };
  }
  if (r && S.plan && t > r.t0) {
    const el = (t - r.t0) / 1000;
    const d = S.plan.distAt(el);
    return { d, v: S.plan.speedAt(d), sd: 700 };
  }
  return { d: 0, v: 0, sd: 250 };
}

function setupRunObjects() {
  const r = S.run;
  S.gap.reset();
  S.lastVoiceK = null;
  S.alert = { level: 0 };
  S.alertAt = 0;
  S.lastBar = null;
  S.lastWater = null;
  S.countdownAt = null;
  S.offSaid = null;
  S.rawTrail = [];
  S.resume = null;
  S.peekUntil = 0;
  S.lastTrailN = 0;
  S.free = null;
  if (r.kind === 'practice') {
    const course = new Course(r.practice.spec);
    useCourse(course, null);
    S.plan = planFor(course, r);
  } else if (r.kind === 'free') {
    useCourse(null, null);
    S.free = new FreeRun(r.free.pace);
    S.plan = null;
  } else {
    // keep the tracker from the start screen: its history lets LIVE find your chip time
    // even if you press it after crossing the start line
    useCourse(S.marathon, null, { keepTracker: true });
    S.plan = planFor(S.marathon, r);
  }
}

// ---------------------------------------------------------------- phases
function enterPhase(p) {
  S.phase = p;
  const app = $('#app');
  app.classList.remove('phase-boot', 'phase-ready', 'phase-running');
  app.classList.add(`phase-${p}`);
  closeSheets();
  exitFreeMap();
  S.offNow = null;
  if (S.mapReady) S.map.setInteractive(p === 'ready');
  $('#btn-recenter').hidden = p !== 'ready';
  $('#btn-overview').hidden = p !== 'ready';
  updateCompass();
  S.lastPanel = {};
  if (p === 'ready') {
    S.follow = true;
    S.overviewShown = false;
    $('#bottom').className = '';
    renderReady();
  }
  renderChips();
}

// ---------------------------------------------------------------- GPS & compass
function startGps() {
  S.gpsWanted = true;
  if (!('geolocation' in navigator)) { S.gpsError = 'No GPS on this device'; renderChips(); return; }
  watchPermission();
  if (S.watchId !== null) navigator.geolocation.clearWatch(S.watchId);
  S.watchId = navigator.geolocation.watchPosition(onPos, onPosError, {
    enableHighAccuracy: true, maximumAge: 0, timeout: 25000,
  });
}

function onPos(pos) {
  if (S.sim) return;
  // After the phone wakes up, iOS may hand back the last cached position again: skip it.
  if (pos.timestamp && pos.timestamp === S.lastRawTs) return;
  S.lastRawTs = pos.timestamp;
  const c = pos.coords;
  const now = Date.now();
  let t = pos.timestamp || now;
  if (Math.abs(t - now) > 10000) t = now;
  const first = !S.fix;
  S.gpsError = null;
  handleFix({ t, lat: c.latitude, lon: c.longitude, acc: c.accuracy, speed: c.speed ?? -1, heading: c.heading });
  if (first) { renderChips(); renderWelcome(); }
}

// ---- pre-race check: one screen of text, what is set, what is missing, what happens next
function renderCheck() {
  const s = S.settings, r = S.run, now = clock.now(), g = gunMs();
  const rows = [];
  const add = (state, html) => rows.push(`<div class="chk ${state}"><span class="chk-i">${state === 'ok' ? '✓' : state === 'bad' ? '!' : '•'}</span><span>${html}</span></div>`);
  const toGun = (g - now) / 1000;
  // the clock
  if (r && r.kind === 'race' && r.mode === 'live' && now < r.t0) {
    add('ok', `<b>LIVE is on.</b> The clock starts by itself at the ${fmtTimeOfDay(g, true)} gun, then switches to your chip time when you cross the start line. The voice counts down, then says the gun time (“Gun time: ${spokenTimeOfDay(g)}”), and your chip time (“Chip time: …”) about 15 s after you cross.`);
  } else if (r && r.kind === 'race') {
    add('ok', `<b>Running</b> since ${fmtTimeOfDay(r.t0, true)} (${{ chip: 'your start-line crossing', gun: 'the gun: chip time when you cross the line', tap: 'your START tap', adjusted: 'adjusted by hand' }[r.t0Source] || r.t0Source}).`);
  } else if (toGun > 0 && toGun < 3 * 3600) {
    add('bad', `<b>Not started.</b> In the corral, press <b>LIVE</b>: it starts at the gun by itself and switches to your chip time at the start line.`);
  } else {
    add('info', `On race morning, from ${fmtTimeOfDay(g - 3 * 3600e3)}: press <b>LIVE</b> in the corral. It starts at the ${fmtTimeOfDay(g, true)} gun by itself and switches to your chip time at the start line.`);
  }
  // GPS
  const fresh = S.fix && Date.now() - S.fixReal < 30000;
  if (fresh) {
    const [la, lo] = S.marathon.line.latLonAt(0);
    const dist = haversine(S.fix.lat, S.fix.lon, la, lo);
    add(S.fix.acc <= 20 ? 'ok' : 'bad', `GPS ±${Math.round(S.fix.acc)} m${dist < 5000 ? ` · ${dist < 1000 ? `${Math.round(dist)} m` : `${(dist / 1000).toFixed(1)} km`} from the start line` : ''}.`);
  } else if (S.gpsError === 'Location blocked') add('bad', 'Location is blocked: Help → Location.');
  else add('bad', 'No GPS yet: step outside, away from buildings; it can take a minute.');
  if (S.offline === true) add('ok', 'Works offline: no connection needed.');
  else if (S.offline === false) add('bad', 'Still saving for offline: keep the connection a minute.');
  // screen
  if (S.phase === 'running' && S.needWakeTap) add('bad', 'Tap the screen once so it stays on.');
  else add(S.phase === 'running' ? 'ok' : 'info', `${S.phase === 'running' ? 'The screen stays on by itself.' : 'Once LIVE is pressed the screen stays on by itself.'} Do not lock the phone${s.pocket ? '; Pocket mode is on: black screen, voice only' : ' (Pocket mode blacks it out instead)'}.`);
  // plan
  const margin = 3 * 3600 - s.target;
  add('ok', `Target <b>${fmtClock(s.target)}</b>${margin > 0 ? ` (${margin < 60 ? `${margin} s` : `${Math.round(margin / 60)} min`} under 3:00)` : ''} · flat pace about ${fmtPace(flatPace())}/km · ${s.wind.kmh > 0 ? `wind from ${dirName(s.wind.fromDeg)} ${s.wind.kmh} km/h` : 'still air'}.`);
  // voice
  const vm = voiceMode();
  if (vm === 'off') add('bad', 'Voice is off: no calls for pace, bars or water.');
  else add('ok', `Voice ${vm === 'every' ? `every ${voiceLabel(voiceEvery())}` : `when off pace, from ${offPace().band} s, and “on pace” when you meet the ghost`}; bars 1 km before their water; every station 200 m before. Volume up.`);
  // fuel
  const pre = s.preBar || 'caf';
  if (pre !== 'none') {
    const at = g - 40 * 60000;
    const kind = pre === 'caf' ? 'CAF' : 'REG';
    if (now >= g - 50 * 60000 && now < g - 20 * 60000) add('bad', `<b>Now: the ${kind} bar</b>, with a few sips of water (${fmtTimeOfDay(at)}, 40 min before the gun).`);
    else if (now >= g - 20 * 60000 && now < g + 3600e3) add('ok', `${kind} bar at ${fmtTimeOfDay(at)}: eaten by now.`);
    else add('info', `Before the gun: the ${kind} bar at ${fmtTimeOfDay(at)}, with a few sips of water.`);
  }
  const fuel = (s.bars || []).map((b) => ({ d: b.km * 1000, t: `${b.caf ? 'CAF' : 'REG'} ${b.km.toFixed(1)}` }))
    .concat(s.raceGels !== false ? S.marathon.aid.filter((a) => a.what === 'gels').map((a) => ({ d: a.d, t: `gel ${a.km}` })) : [])
    .sort((a, b) => a.d - b.d).map((x) => x.t);
  if (fuel.length) add('info', `On the course: ${fuel.join(' · ')}.`);
  add('info', 'Do Not Disturb on · brightness up · earbuds in.');
  const head = `<p class="chk-time">Phone time ${fmtTimeOfDay(now, true)} · gun ${fmtTimeOfDay(g, true)}${toGun > 0 && toGun < 3 * 3600 ? ` (in ${fmtCountdown(toGun)})` : ''}</p>`;
  $('#check-body').innerHTML = head + rows.join('');
}

// ---- first launch: "Before you start", location and compass, one button each
function onboarded() { try { return localStorage.getItem('pacer.onboarded') === '1'; } catch { return true; } }
function setOnboarded() { try { localStorage.setItem('pacer.onboarded', '1'); } catch { /* ignore */ } }

// 'granted', 'denied', 'prompt', or null when the browser does not say
async function geoPermission() {
  try {
    if (!navigator.permissions || !navigator.permissions.query) return null;
    return (await navigator.permissions.query({ name: 'geolocation' })).state;
  } catch { return null; }
}

// Shown once, on the start screen, when something is left to turn on.
function maybeWelcome(perm) {
  if (onboarded() || S.phase !== 'ready') return;
  if (perm === 'granted' && !compassNeedsTap()) { setOnboarded(); return; } // nothing to ask
  $('#scrim').hidden = false;
  $('#sheet-welcome').hidden = false;
  renderWelcome();
}

function renderWelcome() {
  const sheet = $('#sheet-welcome');
  if (!sheet || sheet.hidden) return;
  const locOn = !!S.fix, locBad = S.gpsError === 'Location blocked';
  const locBtn = $('#wl-loc');
  locBtn.className = `perm-btn${locOn ? ' done' : locBad ? ' bad' : ' next'}`;
  locBtn.textContent = locOn ? 'On ✓' : locBad ? 'How to fix' : S.gpsWanted ? 'Asking…' : 'Turn on';
  locBtn.disabled = locOn;
  $('#wl-loc-note').textContent = locOn ? `On: GPS ±${Math.round(S.fix.acc)} m.`
    : locBad ? 'Blocked. Help shows how to allow it again on this phone.'
      : S.gpsWanted ? 'Choose Allow in the iPhone’s popup (“While Using the App”).'
        : 'Needed. Puts you on the course and times you against the ghost.';
  const needTap = compassNeedsTap();
  $('#wl-compass-row').hidden = !needTap;
  const cBtn = $('#wl-compass');
  cBtn.className = `perm-btn${S.compass ? ' done' : S.compassDenied ? ' bad' : locOn ? ' next' : ''}`;
  cBtn.textContent = S.compass ? 'On ✓' : S.compassDenied ? 'Try again' : 'Turn on';
  cBtn.disabled = S.compass;
  if (S.compassDenied && !S.compass) $('#wl-compass-note').textContent = 'Not allowed. Optional: the app works without it. To allow it, tap again, or close and reopen the app.';
  $('#wl-intro').innerHTML = needTap
    ? 'Two things to turn on. Tap a button, then choose <b>Allow</b> when the iPhone asks.'
    : 'One thing to turn on. Tap the button, then choose <b>Allow</b> when the phone asks.';
  const all = locOn && (S.compass || !needTap);
  const done = $('#wl-done');
  done.textContent = all ? 'Done' : 'Later';
  done.className = `wide${all ? ' primary' : ''}`;
  if (all && !S.welcomeClosing) {
    S.welcomeClosing = true;
    setTimeout(() => { if (!sheet.hidden) { closeWelcome(); toast('All set.', 2000); } }, 1200);
  }
}

// Once location was asked for, the card is not shown again; "Later" without trying brings
// it back next time.
function closeWelcome() {
  if (S.gpsWanted) setOnboarded();
  $('#sheet-welcome').hidden = true;
  $('#scrim').hidden = true;
  renderChips();
}

// When the browser tells us location was allowed again (Settings, the site's settings),
// start the GPS again without waiting for a reload.
function watchPermission() {
  if (S.permWatched || !navigator.permissions || !navigator.permissions.query) return;
  S.permWatched = true;
  navigator.permissions.query({ name: 'geolocation' }).then((p) => {
    S.geoPerm = p.state;
    p.onchange = () => {
      S.geoPerm = p.state;
      if (p.state !== 'denied' && S.gpsError === 'Location blocked') startGps();
    };
  }).catch(() => { /* not supported: the retry button and coming back to the app still work */ });
}

// What the Help sheet needs to show the right steps: how location is doing, and the phone,
// browser and whether this is the Home Screen app.
function helpEnv() {
  const ua = navigator.userAgent || '';
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const fresh = S.fix && Date.now() - S.fixReal < 30000;
  const status = S.gpsError === 'Location blocked' || S.geoPerm === 'denied' ? 'blocked'
    : fresh ? 'ok' : S.gpsError === 'No GPS signal' ? 'nosignal' : 'waiting';
  let standalone = false;
  try { standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch { /* ignore */ }
  return {
    status, acc: fresh ? S.fix.acc : null, ios, android: /Android/.test(ua), standalone,
    chrome: /CriOS/.test(ua), firefox: /FxiOS/.test(ua),
  };
}

// "Try again" in Help: ask for the GPS again (iOS shows its prompt if it is allowed to), then
// show how it went.
function retryLocation() {
  S.gpsError = null;
  startGps();
  renderChips();
  const btn = $('#loc-retry');
  if (btn) { btn.textContent = 'Trying…'; btn.disabled = true; }
  setTimeout(() => {
    if (!$('#sheet-help').hidden) $('#help-body').innerHTML = helpHtml(VERSION, helpEnv());
  }, 2500);
}

function onPosError(err) {
  if (err.code === 1) S.gpsError = 'Location blocked';
  else if (err.code === 2) S.gpsError = 'No GPS signal';
  else S.gpsError = 'GPS slow';
  renderChips();
  renderWelcome();
}

function handleFix(fix) {
  S.fix = fix;
  S.fixReal = Date.now();
  // the last 20 s of good fixes, for your direction of travel off the course
  if (fix.acc <= 30) {
    const tr = S.rawTrail || (S.rawTrail = []);
    tr.push(fix);
    while (tr.length && fix.t - tr[0].t > 20000) tr.shift();
  }
  if (S.tracker) S.tracker.update(fix);
  if (S.free && S.phase === 'running') S.free.update(fix);
  if (S.run && S.track && !S.run.sim) {
    const est = S.tracker ? S.tracker.peek(fix.t) : S.free ? { d: S.free.d } : null;
    S.track.add(fix.t, fix.lat, fix.lon, fix.acc, est ? est.d : null);
  }
  if (S.practiceDraft && S.practiceDraft.needFix) renderPracticeInfo();
}

function watchdog() {
  maybeSuggestWind();
  if (S.sim) return;
  if (S.phase === 'running' && Date.now() - S.fixReal > 20000 && !(S.course && S.tracker && S.tracker.x && S.course.inTunnel(S.tracker.peek(clock.now()).d, 80))) {
    startGps(); // iOS sometimes stalls the watch; restarting it helps
  }
  if (S.track) S.track.flush();
  renderChips();
}

function onOrient(e) {
  let h = null;
  if (typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0) h = e.webkitCompassHeading;
  else if (e.absolute && typeof e.alpha === 'number') h = (360 - e.alpha) % 360;
  if (h === null) return;
  const so = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
  h = (h + so + 360) % 360;
  S.heading = S.heading === null ? h : (S.heading + angleDiff(S.heading, h) * 0.25 + 360) % 360;
  S.headingAt = Date.now();
}

// iPhone: the compass needs a tap and an Allow ("motion and orientation"); elsewhere not.
function compassNeedsTap() {
  return typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function';
}

async function enableCompass() {
  if (S.compass) return true;
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== 'granted') return false;
    }
    S.compass = true;
    updateCompass();
    renderChips();
    return true;
  } catch { return false; }
}

// The compass fires ~60 events a second. It turns the view on the start screen; on the run
// the map turns with the course, so it is off there to save battery, except to show which
// way you face when you are off the course or have unlocked the map.
function updateCompass() {
  setCompassListening(S.phase !== 'running' || S.freeMap || !!S.offNow);
}

function setCompassListening(on) {
  on = !!(on && S.compass);
  if (on === !!S.compassListening) return;
  S.compassListening = on;
  const f = on ? 'addEventListener' : 'removeEventListener';
  window[f]('deviceorientation', onOrient);
  window[f]('deviceorientationabsolute', onOrient);
  if (!on) S.heading = null;
}

// ---------------------------------------------------------------- runs
function gunMs() {
  return S.marathon.gun + (S.settings.gunOffset || 0) * 1000;
}

function newRun(kind, mode, extra = {}) {
  const now = clock.now();
  const base = {
    id: `r${now}`, v: 1, kind, mode, created: now,
    t0: now, t0Source: 'tap', gunMs: gunMs(), crossing: null, finish: null, replan: null,
    target: S.settings.target, wind: { ...S.settings.wind }, aidSeconds: S.settings.aidSeconds,
    sim: !!S.sim, stopped: false,
  };
  if (mode === 'live') { base.t0 = base.gunMs; base.t0Source = 'gun'; }
  return { ...base, ...extra };
}

async function beginRun(run) {
  S.voice.unlock();
  S.voiceUnlocked = true;
  if (!S.gpsWanted) startGps();
  S.wake.enable().then((m) => { if (!m) S.needWakeTap = true; });
  S.run = run;
  if (!run.sim) {
    TrackLog.clearAll();
    saveRun(run);
    S.track = new TrackLog(run.id);
    try { localStorage.setItem('pacer.lastrun', JSON.stringify({ id: run.id, kind: run.kind, created: run.created })); } catch { /* ignore */ }
  } else S.track = null;
  setupRunObjects();
  enterPhase('running');
  // the time the clock counts from, to the second: "Start time: 8:04 a.m. and 12 seconds";
  // LIVE after the gun (started mid-race): "Gun time: 8 a.m. exactly" (the gun as set in
  // Settings)
  const early = clock.now() < run.t0;
  if (run.rehearsal) S.voice.say('Live rehearsal. The gun is in one minute.');
  else if (early) S.voice.say(`Live mode. The gun is at ${spokenTimeOfDay(run.t0)}.`);
  else S.voice.say(`${run.t0Source === 'gun' ? 'Gun time' : 'Start time'}: ${spokenTimeOfDay(run.t0)}.`);
}

function startManual() {
  beginRun(newRun('race', 'manual'));
}

function startLive() {
  const now = clock.now();
  const g = gunMs();
  if (g - now > 3 * 3600e3) {
    toast(`LIVE counts from the ${fmtTimeOfDay(g)} gun on Sunday, October 4. You can press it from ${fmtTimeOfDay(g - 3 * 3600e3)} that morning, in the corral; it waits for the gun by itself. To try it now: Practice → LIVE rehearsal.`, 8000);
    return;
  }
  if (now - g > 7 * 3600e3) { toast('The race is over — use START.', 4000); return; }
  beginRun(newRun('race', 'live'));
}

function saveRunState() {
  if (S.run && !S.run.sim) saveRun(S.run);
}

function stopRun() {
  const r = S.run;
  if (!r) return;
  r.stopped = true;
  if (S.track) S.track.flush();
  if (!r.sim) clearRun();
  S.wake.disable();
  S.voice.say('Pacer stopped.');
  if (S.sim) endSim(false);
  S.run = null;
  S.track = null;
  S.free = null;
  S.resume = null;
  if (S.mapReady) { S.map.clearTrail(); S.map.setGhost(null); }
  useCourse(S.marathon, S.readyPlan);
  $('#finish').hidden = true;
  $('#pocket').hidden = true;
  enterPhase('ready');
}

function setT0(t0, source, message) {
  S.run.t0 = t0;
  S.run.t0Source = source;
  saveRunState();
  S.gap.reset();
  S.alert = { level: 0 };
  if (message) toast(message);
}

// ---------------------------------------------------------------- main loop
function loop() {
  const step = () => {
    try { frame(); } catch (e) { console.error(e); }
    // 5 frames a second is smooth enough at running speed; pocket mode needs no drawing
    setTimeout(step, S.phase === 'running' && pocketOn() ? 500 : 200);
  };
  step();
}

function frame() {
  if (document.hidden || S.phase === 'boot') return;
  const now = clock.now();
  const real = Date.now();
  const dtReal = S.cam.lastReal ? Math.min(1, (real - S.cam.lastReal) / 1000) : 0.1;
  S.cam.lastReal = real;
  if (S.sim) feedSim(now);
  if (S.phase === 'running') runningFrame(now, dtReal);
  else readyFrame(now, dtReal);
}

function readyFrame(now, dt) {
  if (!S.mapReady) return;
  const fix = S.fix;
  const fresh = fix && Date.now() - S.fixReal < 30000;
  if (fresh) {
    const heading = S.compass && Date.now() - S.headingAt < 3000 ? S.heading : null;
    S.map.setMe(fix.lat, fix.lon, { heading });
  }
  const start = S.course ? S.course.line.latLonAt(0) : null;
  const nearStart = fresh && start && haversine(fix.lat, fix.lon, start[0], start[1]) < 1500;
  // (while the practice sheet shows a route, the whole route stays in view)
  if (S.follow && fresh && nearStart && !S.practiceDraft) {
    const target = S.compass && S.heading !== null ? S.heading : 0;
    S.cam.bearing = smoothAngle(S.cam.bearing, target, dt, 0.6);
    S.map.follow({ lat: fix.lat, lon: fix.lon, bearing: S.cam.bearing, zoom: 16.2, pitch: 45 });
    S.overviewShown = false;
  } else if (!S.overviewShown && S.follow) {
    S.map.overview(fresh ? [fix.lat, fix.lon] : null);
    S.overviewShown = true;
    S.cam.bearing = 0;
  }
  renderReadyLive(now);
}

function runningFrame(now, dt) {
  const r = S.run;
  const el = (now - r.t0) / 1000;
  let est = null;
  let d = null;
  // Clearly off the course (a wrong turn): no place on the course, so no gap, no calls; the
  // map shows where the GPS has you. Back on it: the gap starts over from where you are.
  const off = !S.free && S.tracker && S.tracker.tracking ? S.tracker.off : null;
  if (!!off !== !!S.offNow) {
    S.offNow = off;
    if (!off) S.gap.reset();
    updateCompass();
    S.lastPanel.cls = null;
  } else if (off) S.offNow = off;
  if (S.free) {
    const f = S.free.peek(now);
    if (f) { est = f; d = f.d; }
  } else if (S.tracker && S.tracker.tracking && !off) {
    est = S.tracker.peek(now);
    d = est.d;
  }
  const estimating = !!(est && est.mode === 'estimating' && (est.age > 6 || (S.course && S.course.inTunnel(d, 30))));
  // gap
  let raw = null;
  if (el >= 0 && d !== null) {
    raw = S.free ? el - (d / 1000) * r.free.pace : el - S.plan.timeAt(Math.max(0, d));
    S.gap.push(raw, now);
  }
  if (S.course && !S.free && (S.course.id === 'marathon' || r.mode === 'live')) detectCrossing(now, el);
  if (S.resume) catchUp(now, raw, est);
  // LIVE: count down to the gun out loud, so you know it is running ("Start in 5 minutes"
  // … "15 seconds"), then "Gun time" (the rehearsal says "Go!": there is no real gun)
  if (r.mode === 'live') countdown((now - r.gunMs) / 1000, r);
  // In LIVE, between the gun and your start-line crossing the clock runs from the gun: no
  // gap talk until chip time has taken over (it does ~60 m past the line; if it never
  // finds your crossing, the gap from the gun is spoken from 100 m on).
  const waiting = r.mode === 'live' && r.t0Source === 'gun' && (d === null || d < 100);
  // what to say this frame: a bar, the next aid station, the gap every N metres
  const words = [];
  if (el >= 0 && !r.finish) offCourseWords(now, words);
  const bar = barDue(d, el);
  if (bar) words.push(bar.caf ? 'Take caffeinated bar.' : 'Take regular bar.');
  const aid = waterDue(d, el);
  if (aid) words.push(isGel(aid) ? 'Gel in 200 meters.' : 'Water in 200 meters.');
  const every = voiceEvery();
  if (every && d !== null && el > 0 && !waiting) {
    const k = Math.floor(d / every);
    if (S.lastVoiceK === null) S.lastVoiceK = k;
    else if (k > S.lastVoiceK) {
      S.lastVoiceK = k;
      // (while catching up after a pause, catchUp() speaks instead)
      if (!r.finish && el > 20 && !S.resume) {
        const g = S.gap.state().value ?? 0;
        words.push((estimating ? 'About ' : '') + spokenGap(g));
      }
    }
  }
  // or only when off pace: from 10 s, every 5 s step out and back in, then "on pace" at the
  // ghost
  const g = S.gap.state();
  if (voiceMode() === 'offpace' && d !== null && el > 30 && !waiting && !r.finish && !S.resume && g.shown !== null &&
      now - (S.alertAt || 0) > 20000) {
    const cue = offPaceCue(S.alert, g.shown, offPace());
    if (cue) {
      S.alertAt = now;
      sayCue(cue, estimating, words);
    }
  }
  if (words.length && !r.finish) S.voice.say(words.join(' '));
  // remember where you are (for re-acquisition after a reload)
  if (est && !S.free && !r.sim && est.mode === 'gps' && Date.now() - (S.lastPosSaved || 0) > 15000) {
    S.lastPosSaved = Date.now();
    saveLastPos(r.id, { t: now, d: est.d, v: est.v });
  }
  // finish
  const total = S.course ? S.course.total : null;
  if (!r.finish && total && d !== null && d >= total - 0.5 && el > 60) finishRun(now, el, d, est);
  // Pocket mode: nothing to draw, the voice does the talking.
  const pocket = pocketOn();
  if (S.lastPanel.pocket !== pocket) {
    $('#pocket').hidden = !pocket;
    // black again: close the run settings and lock the map again, so a touch in the
    // pocket cannot land on them
    if (pocket) { closeSheets(); exitFreeMap(); renderPocket(); }
    S.lastPanel = { pocket };
  }
  if (pocket) return;
  renderRunPanel(now, el, d, est, estimating);
  if (S.mapReady) renderRunMap(now, el, d, est, dt);
}

// Off course: "Off course: 60 meters from the course." when it is clear, again as it grows
// past 100 m, 200 m, 500 m, 1 km, 2 km; "Back on course." when you are.
const OFF_SAY = [0, 100, 200, 500, 1000, 2000];

function offCourseWords(now, words) {
  const off = S.offNow;
  if (off) {
    const k = OFF_SAY.filter((x) => off.r >= x).length;
    if (!S.offSaid || (k > S.offSaid.k && now - S.offSaid.at > 20000)) {
      S.offSaid = { k, at: now };
      words.push(`Off course: ${spokenDist(off.r)} from the course.`);
    }
  } else if (S.offSaid) {
    S.offSaid = null;
    words.push('Back on course.');
  }
}

function spokenDist(m) {
  return m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} meters` : `${(m / 1000).toFixed(1)} kilometers`;
}

// The off-pace rules with the first warning at 5 or 10 s (Settings)
function offPace() { return offPaceConfig(S.settings.voiceBand === 10 ? 10 : 5); }

// "5, 10, 15, 20, 25, 30, 45 s, 1 min, 90 s, 2, 3, 4 and 5 min"
function ladderText(band) {
  const st = offPaceConfig(band).steps;
  const s = st.filter((x) => x < 60).join(', ');
  return `${s} s, 1 min, 90 s, ${st.filter((x) => x >= 120).map((x) => x / 60).join(', ').replace(/, (\d+)$/, ' and $1')} min`;
}

// An off-pace cue in words: "15 seconds behind", "On pace."
function sayCue(cue, estimating, words) {
  words.push(cue.pace ? 'On pace.' : (estimating ? 'About ' : '') + spokenGap(cue.gap));
}

// The countdown marks (seconds before the gun) said out loud in LIVE: every 5 minutes from
// half an hour, every minute from 10, then 2:30, 2:00, 1:30, 1:00, 0:45, 0:30, 0:15.
const COUNTDOWN = [1800, 1500, 1200, 900, 600, 540, 480, 420, 360, 300, 240, 180, 150, 120, 90, 60, 45, 30, 15];

function countdownWords(sec) {
  if (sec === 150) return 'Start in 2 and a half minutes.';
  if (sec === 90) return 'Start in a minute and a half.';
  if (sec >= 60) return `Start in ${sec / 60} minute${sec === 60 ? '' : 's'}.`;
  return `Start in ${sec} seconds.`;
}

// el: seconds since the gun
function countdown(el, r) {
  const left = -el;
  // the first frame: marks already behind are not said
  if (S.countdownAt === null) S.countdownAt = el < 0 ? COUNTDOWN.find((m) => m < left) ?? 0 : -1;
  if (S.countdownAt === -1) return;
  if (el >= 0) {
    S.countdownAt = -1;
    if (el < 5) S.voice.say(r.rehearsal ? 'Go!' : `Gun time: ${spokenTimeOfDay(r.gunMs)}.`, { force: !!r.rehearsal });
    renderChips();
    return;
  }
  if (S.countdownAt > 0 && left <= S.countdownAt) {
    const mark = S.countdownAt;
    S.countdownAt = COUNTDOWN.find((m) => m < mark) ?? 0;
    if (left > mark - 3) S.voice.say(countdownWords(mark));
  }
}

// After iOS paused the app (screen locked, another app in front), say where you stand as
// soon as GPS has placed you on the course again. When off pace, the same rules as always:
// the gap from 10 s, "on pace" if you met the ghost after a warning, else nothing.
function catchUp(now, raw, est) {
  const R = S.resume;
  const lastFix = S.free ? S.free.lastT : S.tracker && S.tracker.lastFix;
  if (!R.fixAt) {
    if (lastFix && lastFix > R.at && est && est.mode === 'gps') {
      R.fixAt = now;
      S.gap.reset();
      if (raw !== null) S.gap.push(raw, now);
    } else if (now - R.at > 120000) S.resume = null;
  } else if (now - R.fixAt > 3000) {
    S.resume = null;
    const g = S.gap.state().value ?? 0;
    const shown = Math.round(g);
    if (S.run.finish || raw === null) return;
    if (voiceMode() !== 'offpace') {
      S.voice.say(spokenGap(g));
      S.caughtUp = { at: now, gap: shown, said: spokenGap(g) };
      return;
    }
    const cue = offPaceCue(S.alert, shown, offPace()) || (Math.abs(shown) >= offPace().band ? { gap: shown } : null);
    const words = [];
    if (cue) { sayCue(cue, false, words); S.voice.say(words.join(' ')); S.alertAt = now; }
    S.caughtUp = { at: now, gap: shown, said: words.join(' ') || null };
  }
}

// Fuel and water on the marathon. Each bar is announced where you planned it, 1 km before
// an aid station: "Take caffeinated bar" or "Take regular bar" (about 2 min to eat
// it, 2 more to get ready). Every aid station is announced 200 m before it: "Water in 250
// meters", or "Gel in 200 meters" at the two gel stations.
const WATER_CALL = 200;

function barList() {
  return S.course && S.course.id === 'marathon' ? (S.settings.bars || []) : [];
}

function aidList() {
  return S.course && S.course.id === 'marathon' ? S.course.aid : [];
}

function isGel(a) { return a.what === 'gels' && S.settings.raceGels !== false; }

function barDue(d, el) {
  const bars = barList();
  if (!bars.length || d === null || el <= 0) return null;
  const passed = bars.filter((b) => d >= b.km * 1000).length;
  if (S.lastBar === null) { S.lastBar = passed; return null; }
  if (passed > S.lastBar) { S.lastBar = passed; return bars[passed - 1]; }
  return null;
}

// the aid station you just came within 200 m of (once each)
function waterDue(d, el) {
  const aid = aidList();
  if (!aid.length || d === null || el <= 0) return null;
  const passed = aid.filter((a) => d >= a.d - WATER_CALL).length;
  if (S.lastWater === null) { S.lastWater = passed; return null; }
  if (passed > S.lastWater) { S.lastWater = passed; return aid[passed - 1]; }
  return null;
}

// Status line: "REG bar in 240 m", "REG bar now" while you eat it, "Water in 180 m"
// (or "Gel in 180 m") before each aid station, "Water: now" at it.
function fuelStatus(d) {
  if (d === null) return '';
  const m = (x) => `${Math.max(10, Math.round(x / 10) * 10)} m`;
  for (const b of barList()) {
    const to = b.km * 1000 - d, name = b.caf ? 'CAF bar' : 'REG bar';
    if (to > 0 && to <= 300) return `${name} in ${m(to)}`;
    if (to <= 0 && to > -450) return `${name} now`;
  }
  for (const a of aidList()) {
    const to = a.d - d, name = isGel(a) ? 'Gel' : 'Water';
    if (to > 0 && to <= WATER_CALL) return `${name} in ${m(to)}`;
    if (to <= 0 && to > -80) return `${name}: now`;
  }
  return '';
}

// 'offpace' (default), 'every' (every voiceEvery metres) or 'off'; pocket mode never stays
// silent: there it falls back to 'offpace'.
function voiceMode() {
  const m = S.settings.voiceMode || 'offpace';
  return m === 'off' && S.settings.pocket ? 'offpace' : m;
}

function voiceEvery() {
  return voiceMode() === 'every' ? (S.settings.voiceEvery || 1000) : 0;
}

function voiceDesc() {
  const m = voiceMode();
  return m === 'every' ? `every ${voiceLabel(voiceEvery())}` : m === 'offpace' ? 'when off pace' : 'off';
}

function pocketOn() {
  return S.phase === 'running' && !!S.settings.pocket && !!S.run && !S.run.finish && Date.now() >= S.peekUntil;
}

function renderPocket() {
  $('#pk-sub').textContent = `Voice ${voiceDesc()} · tap to look`;
}

// When did you actually cross the start line? LIVE switches to it (chip time); after a
// START tap it is offered in the run menu if it differs by more than a few seconds.
function detectCrossing(now, el) {
  const r = S.run;
  if (el > 40 * 60 || (r.mode === 'live' && (r.t0Source !== 'gun' || r.noAutoChip))) return;
  if (r.mode === 'live') {
    const c = S.tracker.crossingOf(0, r.gunMs - 30000);
    if (c && c <= r.gunMs + 25 * 60000) {
      r.crossing = c;
      setT0(c, 'chip', `Chip time: you crossed the start line at ${fmtTimeOfDay(c, true)}.`);
      S.voice.say(`Chip time: ${spokenTimeOfDay(c)}.`);
    }
    return;
  }
  const all = S.tracker.crossingsOf(0, r.t0 - 5 * 60000).filter((c) => c <= r.t0 + 20 * 60000);
  if (!all.length) return;
  const best = all.reduce((a, b) => (Math.abs(b - r.t0) < Math.abs(a - r.t0) ? b : a));
  if (best === r.crossing) return;
  r.crossing = best;
  saveRunState();
  if (Math.abs(best - r.t0) > 8000 && r.t0Source === 'tap') S.crossHintUntil = clock.now() + 3 * 60000;
}

function finishRun(now, el, d, est) {
  const r = S.run;
  const v = est && est.v > 0.5 ? est.v : 3.9;
  const tFin = now - ((d - S.course.total) / v) * 1000;
  const elapsed = (tFin - r.t0) / 1000;
  const gap = S.gap.state().value ?? 0;
  r.finish = { t: tFin, elapsed, gap };
  saveRunState();
  if (S.track) S.track.flush();
  $('#fin-time').textContent = fmtClock(elapsed);
  const a = Math.abs(Math.round(gap));
  $('#fin-gap').textContent = a === 0 ? 'Exactly on the ghost'
    : `${fmtGap(gap)}${a < 100 ? ' s' : ''} · ${gap > 0 ? 'behind' : 'ahead of'} the ghost`;
  $('#finish').hidden = false;
  S.voice.say(`Finish. ${spokenClock(elapsed)}.`);
}

// ---------------------------------------------------------------- rendering: running
function renderRunPanel(now, el, d, est, estimating) {
  const r = S.run;
  const bottom = $('#bottom');
  let cls, num, word = '', status = '';
  const g = S.gap.state();
  // "Estimating" shows only for a real outage (the tunnel, or 6 s without GPS): a missed
  // fix or two is normal at 1 Hz and should not make the display flicker.
  if (r.finish) {
    cls = 'even';
    num = fmtClock(r.finish.elapsed);
    word = 'FINISHED';
  } else if (el < 0) {
    cls = 'wait';
    num = fmtCountdown(-el);
    word = r.mode === 'live' ? 'TO THE GUN' : 'TO START';
  } else if (S.offNow) {
    // how far off, in big: "90 m", "1.2 km"
    cls = 'nolock';
    num = S.offNow.r < 1000 ? `${Math.max(10, Math.round(S.offNow.r / 10) * 10)} m` : `${(S.offNow.r / 1000).toFixed(1)} km`;
    word = 'OFF COURSE';
  } else if (d === null) {
    cls = 'nolock';
    num = '—';
    word = S.free ? 'WAITING FOR GPS' : 'FINDING COURSE';
  } else {
    // +3 = 3 s behind the ghost, −3 = 3 s ahead: the sign says it, no words needed
    const s = g.shown ?? 0;
    cls = s > 0 ? 'behind' : s < 0 ? 'ahead' : 'even';
    num = (estimating ? '~' : '') + fmtGap(s);
  }
  // status line
  const fixAge = S.fix ? (Date.now() - S.fixReal) / 1000 : Infinity;
  if (S.offNow && el >= 0) status = 'No gap until you are back on the course';
  else if (el >= 0 && d === null && S.tracker && S.tracker.offCourse) status = `You are ${Math.round(S.tracker.offCourse)} m from the course`;
  else if (estimating) status = S.course && S.course.inTunnel(d, 30) ? 'TUNNEL · no GPS · estimating' : `No GPS for ${Math.round(est.age)} s · estimating`;
  else if (fixAge > 8 && !S.sim) status = `No GPS for ${Math.round(fixAge)} s`;
  else if (S.crossHintUntil > now && r.crossing) {
    const diff = (r.crossing - r.t0) / 1000;
    status = `Start line crossed ${Math.abs(diff).toFixed(0)} s ${diff > 0 ? 'after' : 'before'} START · hold the gear to fix`;
  } else if (el < 0 && r.mode === 'live') status = `Gun at ${fmtTimeOfDay(r.t0, true)} · ${r.rehearsal ? 'wait for “Go!”' : 'stay in the corral'}`;
  else if (r.mode === 'live' && r.t0Source === 'gun' && el >= 0 && el < 600 && d !== null && d < 0) status = `Start line in ${Math.round(-d)} m · then chip time`;
  else if (fuelStatus(d)) status = fuelStatus(d);
  else if (S.fix && S.fix.acc > 25) status = `Weak GPS ±${Math.round(S.fix.acc)} m`;
  else if (S.needWakeTap) status = 'Tap the screen once to keep it awake';
  const full = cls + (estimating ? ' est' : '');
  const P = S.lastPanel;
  if (P.cls !== full) {
    bottom.className = full; P.cls = full;
  }
  let refit = false;
  if (P.word !== word) { $('#gap-word').textContent = word; P.word = word; refit = true; }
  if (P.num !== num || refit) {
    const numEl = $('#gap-num');
    if (num.startsWith('~')) numEl.innerHTML = `<span class="tilde">~</span>${escapeHtml(num.slice(1))}`;
    else numEl.textContent = num;
    P.num = num;
    fitGap(num);
  }
  if (P.status !== status) { $('#status-line').textContent = status; P.status = status; }
  const elapsedTxt = r.finish ? fmtClock(r.finish.elapsed) : el >= 0 ? fmtClock(el) : '0:00:00';
  if (P.el !== elapsedTxt) { $('#v-elapsed').textContent = elapsedTxt; P.el = elapsedTxt; }
  const kmTxt = d !== null ? (Math.max(0, d) / 1000).toFixed(2) : '—';
  if (P.km !== kmTxt) { $('#v-km').textContent = kmTxt; P.km = kmTxt; }
  let pace = '—';
  if (S.free) pace = fmtPace(r.free.pace);
  else if (S.plan && d !== null) pace = fmtPace(S.plan.paceAt(Math.max(0, Math.min(S.course.total, d))));
  else if (S.plan) pace = fmtPace(S.plan.paceAt(50));
  if (P.pace !== pace) { $('#v-pace').textContent = pace; P.pace = pace; }
  renderBadges(el, g);
}

function fitGap(text) {
  const el = $('#gap-num');
  const wrap = $('#gap-wrap');
  const H = wrap.clientHeight, W = wrap.clientWidth;
  if (!H || !W) return;
  let size = (H / 0.78) * 0.97;
  if (text === '—') size *= 0.4; // no number yet: a small dash, not a white slab
  el.style.fontSize = `${size}px`;
  const w = el.scrollWidth;
  const maxW = W * 0.95;
  if (w > maxW) { size *= maxW / w; el.style.fontSize = `${size}px`; }
}

function renderBadges(el, g) {
  const r = S.run;
  const parts = [];
  if (r.sim) parts.push('<div class="badge">SIM</div>');
  parts.push(clockBadge(r));
  if (r.kind === 'race') {
    if (el > 0 && g.value !== null && S.plan) {
      const proj = S.plan.target + g.value;
      parts.push(`<div class="badge big${proj >= 3 * 3600 ? ' over' : ''}">→ ${fmtClock(proj)}</div>`);
    }
  } else if (r.kind === 'practice') parts.push(`<div class="badge">PRACTICE · ${fmtPace(r.practice.pace)}</div>`);
  else if (r.kind === 'free') parts.push(`<div class="badge">FREE RUN · ${fmtPace(r.free.pace)}</div>`);
  const html = parts.join('');
  if (S.lastPanel.badges !== html) { $('#badges').innerHTML = html; S.lastPanel.badges = html; }
}

// How the run's clock started and at what time of day, to the second, so a glance tells
// it started right: "LIVE · CHIP 8:00:05" (you crossed the start line at 8:00:05),
// "LIVE · GUN 8:00:00", "START 8:00:03" (you tapped START), "ADJUSTED 8:00:06".
function clockBadge(r) {
  const how = { chip: 'CHIP', gun: 'GUN', adjusted: 'ADJUSTED' }[r.t0Source] || 'START';
  const live = r.mode === 'live' ? (r.kind === 'race' ? 'LIVE · ' : 'LIVE TEST · ') : '';
  return `<div class="badge">${live}${how} ${fmtTimeOfDay(r.t0, true)}</div>`;
}

function renderRunMap(now, el, d, est, dt) {
  const map = S.map;
  const r = S.run;
  const free = S.freeMap; // unlocked: markers move, the camera stays where you put it
  if (S.free) {
    const f = S.free;
    if (f.pos) {
      if (f.trail.length - (S.lastTrailN || 0) > 3) { map.setTrail(f.trail, f.cum); S.lastTrailN = f.trail.length; }
      // the ghost runs your pace on your own trail: bright from the ghost to you
      const gd = el > 0 ? (el / r.free.pace) * 1000 : -1;
      map.setTrailGhostAt(gd);
      const gp = gd > 0 ? f.pointAt(gd) : null;
      const gb = gp ? f.pointAt(Math.max(0, gd - 8)) : null;
      map.setGhost(gp ? gp[0] : null, gp ? gp[1] : null, gp && gb ? bearingDeg(gb[0], gb[1], gp[0], gp[1]) : 0);
      const target = f.bearing ?? S.cam.bearing;
      S.cam.bearing = smoothAngle(S.cam.bearing, target, dt, 1.5);
      S.cam.zoom = smooth(S.cam.zoom, map.zoomForAhead(300), dt, 2);
      if (!free) map.follow({ lat: f.pos[0], lon: f.pos[1], bearing: S.cam.bearing, zoom: S.cam.zoom });
      map.setMe(f.pos[0], f.pos[1], { travel: f.bearing, heading: compassHeading() });
    }
    return;
  }
  const course = S.course;
  // the ghost is the front of the bright line, with its white arrow on top; before the
  // clock starts it waits on the start line (official km 0)
  const gd = el > 0 && S.plan ? Math.min(course.total, S.plan.distAt(el)) : Math.max(course.line.d0, 0);
  map.setGhostAt(gd);
  if (gd < course.total) {
    const [ga, go] = course.line.latLonAt(gd);
    map.setGhost(ga, go, course.line.bearingAt(gd, 12, 4));
  } else map.setGhost(null);
  // Off the course, not placed on it yet, or the map unlocked: you are where the GPS says,
  // pointing where you are going (and the way you face, with the compass on).
  if (d === null || free) {
    if (S.fix && Date.now() - S.fixReal < 30000) {
      const travel = rawTravel();
      if (!free) {
        if (travel !== null) S.cam.bearing = smoothAngle(S.cam.bearing, travel, dt, 1.5);
        // off the course: flat, you in the middle, far enough out to see the course too
        const want = S.offNow ? map.zoomToSee(S.fix.lat, S.offNow.r * 1.3) : 16;
        S.cam.zoom = smooth(S.cam.zoom, want, dt, 1);
        map.follow({ lat: S.fix.lat, lon: S.fix.lon, bearing: S.cam.bearing, zoom: S.cam.zoom, pitch: S.offNow ? 0 : 40 });
      }
      map.setMe(S.fix.lat, S.fix.lon, { travel, heading: compassHeading() });
    }
    return;
  }
  const dc = Math.max(course.line.d0, Math.min(course.total, d));
  const [la, lo] = course.line.latLonAt(dc);
  const travel = course.line.bearingAt(dc, 12, 4);
  const target = course.line.bearingAt(dc + 20, 35, 5);
  S.cam.bearing = smoothAngle(S.cam.bearing, target, dt, 1.1);
  S.cam.zoom = smooth(S.cam.zoom, map.zoomForAhead(course.lookaheadAt(Math.max(0, dc))), dt, 2.5);
  map.follow({ lat: la, lon: lo, bearing: S.cam.bearing, zoom: S.cam.zoom });
  map.setMe(la, lo, { travel });
}

// Your direction of travel from the GPS alone: from where you were 8+ m back, within the
// last 20 s; else the phone's own course when moving; else unknown (a dot).
function rawTravel() {
  const tr = S.rawTrail || [];
  const f = S.fix;
  if (!f) return null;
  for (let i = tr.length - 1; i >= 0; i--) {
    if (haversine(tr[i].lat, tr[i].lon, f.lat, f.lon) >= 8) return bearingDeg(tr[i].lat, tr[i].lon, f.lat, f.lon);
  }
  return Number.isFinite(f.heading) && f.heading >= 0 && f.speed > 1 ? f.heading : null;
}

function compassHeading() {
  return S.compass && S.compassListening && Date.now() - S.headingAt < 3000 ? S.heading : null;
}

// ---------------------------------------------------------------- rendering: ready
function renderReady() {
  const s = S.settings;
  $('#rt-name').textContent = 'Marathon de Québec · Sun Oct 4';
  let sub = `Target ${fmtClock(s.target)} · even effort`;
  if (s.wind.kmh > 0) sub += ` · wind ${dirName(s.wind.fromDeg)} ${s.wind.kmh}`;
  $('#rt-sub').textContent = sub;
  S.lastPanel.preBar = null;
  renderReadyLive(clock.now());
}

function renderReadyLive(now) {
  const g = gunMs();
  let sub;
  if (now < g && g - now < 3 * 3600e3) sub = `· gun in ${fmtCountdown((g - now) / 1000)}`;
  else if (now >= g && now - g < 7 * 3600e3) sub = `· since ${fmtTimeOfDay(g, true)}`;
  else sub = `· gun ${fmtTimeOfDay(g, true)}`;
  if (S.lastPanel.liveSub !== sub) { $('#live-sub').textContent = sub; S.lastPanel.liveSub = sub; }
  // the bar before the start, until the gun
  const pre = S.settings.preBar || 'caf';
  const fuel = pre !== 'none' && now < g ? `${pillHtml(pre === 'caf')} bar at ${fmtTimeOfDay(g - 40 * 60000)}, before the gun` : '';
  if (S.lastPanel.preBar !== fuel) {
    const el = $('#rt-fuel');
    el.innerHTML = fuel;
    el.hidden = !fuel;
    S.lastPanel.preBar = fuel;
  }
}

function renderChips() {
  const chips = [];
  const fixAge = S.fix ? (Date.now() - S.fixReal) / 1000 : Infinity;
  if (S.sim) chips.push(chip('ok', 'Simulated GPS'));
  else if (S.gpsError === 'Location blocked') chips.push('<button class="chip tap bad" data-act="location"><span class="dot"></span>Location blocked · tap to fix</button>');
  else if (!S.gpsWanted) chips.push('<button class="chip tap" data-act="locate">Tap: turn on location</button>');
  else if (!S.fix) chips.push(chip('warn', S.gpsError || 'Waiting for GPS…'));
  else if (fixAge > 20) chips.push(chip('bad', `GPS lost ${Math.round(fixAge)} s`));
  else {
    const a = Math.round(S.fix.acc);
    chips.push(chip(a <= 12 ? 'ok' : a <= 30 ? 'warn' : 'bad', `GPS ±${a} m`));
  }
  if (S.phase === 'ready') {
    if (S.offline === true) chips.push(chip('ok', 'Works offline'));
    else if (S.offline === false) chips.push(chip('warn', 'Saving for offline…'));
    if (!S.compass && typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      chips.push('<button class="chip tap" data-act="compass">Tap: compass (optional)</button>');
    }
    if (S.fix && S.course && S.course.id === 'marathon' && fixAge < 60) {
      const [la, lo] = S.course.line.latLonAt(0);
      const dist = haversine(S.fix.lat, S.fix.lon, la, lo);
      if (dist > 150) chips.push(chip('', `Start line ${dist >= 1000 ? (dist / 1000).toFixed(1) + ' km' : Math.round(dist) + ' m'} away`));
    }
    if (S.windSuggest) {
      const w = S.windSuggest;
      chips.push(`<button class="chip tap" data-act="wind">Forecast wind: ${dirName(w.dir8)} ${Math.round(w.kmh)} km/h · tap to use</button>`);
    }
    if (S.updateReady) chips.push('<button class="chip tap" data-act="update">Update ready · tap to reload</button>');
  } else if (S.phase === 'running' && S.needWakeTap) {
    chips.push('<button class="chip tap" data-act="wake">Tap: keep screen awake</button>');
  }
  // waiting for the gun in LIVE: the check is one tap away
  if (S.phase === 'running' && S.run && S.run.mode === 'live' && !S.run.rehearsal && clock.now() < S.run.t0) {
    chips.push('<button class="chip tap" data-act="check">Pre-race check</button>');
  }
  const html = chips.join('');
  if (S.lastPanel.chips !== html) { $('#chips').innerHTML = html; S.lastPanel.chips = html; }
  if (S.phase === 'ready' && S.lastPanel.badges !== '') { $('#badges').innerHTML = ''; S.lastPanel.badges = ''; }
}

function chip(kind, text) {
  return `<div class="chip ${kind}"><span class="dot"></span>${escapeHtml(text)}</div>`;
}

// ---------------------------------------------------------------- UI bindings
function bindUi() {
  $('#btn-start').addEventListener('click', startManual);
  $('#btn-live').addEventListener('click', startLive);
  $$('[data-open]').forEach((b) => b.addEventListener('click', () => openSheet(b.dataset.open)));
  $$('[data-close]').forEach((b) => b.addEventListener('click', closeSheets));
  $('#scrim').addEventListener('click', () => {
    if (!$('#sheet-menu').hidden) return;
    if (!$('#sheet-welcome').hidden) { closeWelcome(); return; }
    closeSheets();
  });
  $('#help-body').addEventListener('click', (e) => { if (e.target.closest('#loc-retry')) retryLocation(); });
  $('#wl-loc').addEventListener('click', () => {
    if (S.gpsError === 'Location blocked') { closeWelcome(); openSheet('help'); return; }
    S.gpsError = null;
    startGps();
    renderWelcome();
  });
  $('#wl-compass').addEventListener('click', async () => {
    const ok = await enableCompass();
    S.compassDenied = !ok;
    renderWelcome();
  });
  $('#wl-done').addEventListener('click', closeWelcome);
  $('#chips').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'compass') await enableCompass();
    if (b.dataset.act === 'wake') { const ok = await S.wake.enable(); S.needWakeTap = !ok; }
    if (b.dataset.act === 'update') applyUpdate();
    if (b.dataset.act === 'location') { openSheet('help'); return; }
    if (b.dataset.act === 'locate') startGps();
    if (b.dataset.act === 'check') { openSheet('check'); return; }
    if (b.dataset.act === 'wind' && S.windSuggest) {
      const w = S.windSuggest;
      S.windSuggest = null;
      applyWind(w);
      toast(`Wind set: from ${dirName(w.dir8)}, ${Math.round(w.kmh)} km/h. The ghost now eases into it and uses the tailwind; same finish time.`, 6000);
    }
    renderChips();
  });
  document.addEventListener('pointerdown', async () => {
    if (S.phase === 'running' && !S.voiceUnlocked) { S.voice.unlock(); S.voiceUnlocked = true; }
    if (S.needWakeTap && S.phase === 'running') {
      const ok = await S.wake.enable();
      if (ok) { S.needWakeTap = false; renderChips(); }
    }
  }, { capture: true });
  $('#btn-recenter').addEventListener('click', () => {
    if (S.phase === 'running') { centerFreeMapOnMe(); return; }
    S.follow = true; S.overviewShown = false; enableCompass();
  });
  $('#map-close').addEventListener('click', exitFreeMap);
  // using the unlocked map keeps it open
  ['pointerdown', 'wheel'].forEach((ev) => $('#top').addEventListener(ev, () => { if (S.freeMap) armFreeMapTimer(); }, { passive: true }));
  $('#btn-overview').addEventListener('click', () => { S.follow = false; S.map.overview(S.fix ? [S.fix.lat, S.fix.lon] : null); });
  if (S.mapReady) {
    S.map.map.on('dragstart', () => { if (S.phase === 'ready') S.follow = false; });
  }
  bindHoldFx($('#info'), 'menu', openRunMenu, {
    when: () => S.phase === 'running',
    onTap: () => toast('Hold 5 s to open the settings', 2000),
  });
  bindHoldFx($('#map'), 'map', enterFreeMap, { when: () => S.phase === 'running' && !S.freeMap });
  $('#pocket').addEventListener('click', () => {
    S.peekUntil = Date.now() + 12000; // look for 12 s, then back to black
    frame();
  });
  bindRunMenu();
  bindSettings();
  bindPractice();
  $('#btn-sim-stop').addEventListener('click', () => endSim(true));
  $('#fin-close').addEventListener('click', () => { $('#finish').hidden = true; });
  $('#fin-export').addEventListener('click', () => exportGpx(S.run));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      S.lastPanel = {};
      if (!S.sim && S.gpsWanted && Date.now() - S.fixReal > 5000) startGps();
      // iOS froze the app (screen locked or another app in front): no GPS, no voice, no
      // logic ran meanwhile. Catch up and say the gap as soon as GPS has you again.
      const away = S.hiddenAt ? Date.now() - S.hiddenAt : 0;
      S.hiddenAt = 0;
      if (S.phase === 'running' && S.run && !S.run.finish && away > 15000) {
        S.resume = { at: clock.now(), fixAt: null };
        toast(`The app was paused for ${fmtAway(away)} while the screen was off. Catching up…`, 5000);
      }
    } else {
      S.hiddenAt = Date.now();
      if (S.track) S.track.flush();
    }
  });
  window.addEventListener('pagehide', () => { if (S.track) S.track.flush(); });
}

// ---- long holds: the gear row opens the run settings (5 s), the map unlocks the map
// (5 s), "End run" ends the run (10 s). Long and deliberate, so a pocket or a sweaty thumb
// cannot do them. While held, a fill slides across the whole screen, top to bottom, with a
// countdown; letting go early, or moving the finger, does nothing.
const HOLDS = {
  menu: { ms: 5000, title: 'Settings', sub: 'Keep holding to open', color: 'var(--num)' },
  map: { ms: 5000, title: 'Map', sub: 'Keep holding to move the map freely', color: 'var(--num)' },
  stop: { ms: 10000, title: 'End run', sub: 'Keep holding to end the run', color: '#ff1f1f', danger: true },
};
let holdNow = null; // the hold in progress: {kind, cancel}

function cancelHold() { if (holdNow) holdNow.cancel(); }

function bindHoldFx(el, kind, fn, { slop = 30, when = () => true, onTap = null } = {}) {
  const cfg = HOLDS[kind];
  const fx = $('#holdfx');
  let id = null, t0 = 0, raf = 0, sx = 0, sy = 0, shown = false, last = -1;
  const end = (done) => {
    if (id === null) return;
    id = null;
    cancelAnimationFrame(raf);
    if (holdNow && holdNow.kind === kind) holdNow = null;
    fx.hidden = true;
    if (!done && !shown && onTap) onTap();
  };
  el.addEventListener('pointerdown', (e) => {
    if (id !== null) { end(false); return; } // a second finger: a pinch, not a hold
    if (holdNow || !when(e)) return;
    id = e.pointerId; t0 = performance.now(); sx = e.clientX; sy = e.clientY; shown = false; last = -1;
    holdNow = { kind, cancel: () => end(false) };
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    keepLit(cfg.ms + 12000);
    const step = () => {
      if (id === null) return;
      const t = performance.now() - t0;
      const p = Math.min(1, t / cfg.ms);
      if (!shown && t > 200) {
        shown = true;
        fx.classList.toggle('danger', !!cfg.danger);
        fx.style.setProperty('--hf', cfg.color);
        $$('#holdfx .hf-title').forEach((x) => { x.textContent = cfg.title; });
        $$('#holdfx .hf-sub').forEach((x) => { x.textContent = cfg.sub; });
        fx.hidden = false;
      }
      if (shown) {
        fx.style.setProperty('--p', p.toFixed(4));
        const left = Math.max(1, Math.ceil((cfg.ms - t) / 1000));
        if (left !== last) { last = left; $$('#holdfx .hf-count').forEach((x) => { x.textContent = left; }); }
      }
      if (p >= 1) { end(true); fn(); return; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  });
  el.addEventListener('pointermove', (e) => { if (e.pointerId === id && Math.hypot(e.clientX - sx, e.clientY - sy) > slop) end(false); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => el.addEventListener(ev, (e) => { if (e.pointerId === id) end(false); }));
}

// Pocket mode: the screen stays lit while you use it (a hold, the run settings), then goes
// black again.
function keepLit(ms) {
  if (S.phase === 'running' && S.settings.pocket) S.peekUntil = Math.max(S.peekUntil, Date.now() + ms);
}

// ---- the free map: after the 5 s hold on the map, it stops following you, lies flat and
// north up, and can be dragged and pinched; your position is the GPS's own. ◎ follows you
// again.
// It closes like the run settings: "Close" at the top right, by itself after a while
// untouched, and when the screen goes black in pocket mode. ◎ centres it on you.
function enterFreeMap() {
  if (S.phase !== 'running' || S.freeMap || !S.mapReady) return;
  S.freeMap = true;
  S.map.setInteractive(true);
  S.map.flat(S.fix ? [S.fix.lat, S.fix.lon] : null, 16);
  $('#app').classList.add('free-map');
  $('#map-head').hidden = false;
  $('#btn-recenter').hidden = false;
  $('#btn-overview').hidden = !S.course;
  updateCompass();
  armFreeMapTimer();
}

function exitFreeMap() {
  clearTimeout(S.freeMapTimer);
  if (!S.freeMap) return;
  S.freeMap = false;
  if (S.mapReady) { S.map.setInteractive(S.phase === 'ready'); S.map.cam = null; }
  $('#app').classList.remove('free-map');
  $('#map-head').hidden = true;
  $('#btn-recenter').hidden = S.phase !== 'ready';
  $('#btn-overview').hidden = S.phase !== 'ready';
  updateCompass();
}

// back to following you after freeMapIdleMs without a touch on the map
function armFreeMapTimer() {
  if (!S.freeMap) return;
  keepLit(12000);
  clearTimeout(S.freeMapTimer);
  S.freeMapTimer = setTimeout(exitFreeMap, S.freeMapIdleMs);
}

function centerFreeMapOnMe() {
  armFreeMapTimer();
  if (S.fix && S.mapReady) S.map.map.easeTo({ center: [S.fix.lon, S.fix.lat], duration: 300 });
}

// A button that acts only after being held still for `ms`. A finger that moves is
// scrolling the menu, not holding the button: that cancels it (and the menu scrolls).
function bindHold(btn, ms, fn) {
  let t0 = 0, raf = 0, active = false, sx = 0, sy = 0;
  const reset = () => { active = false; cancelAnimationFrame(raf); btn.style.setProperty('--p', 0); };
  btn.addEventListener('pointerdown', (e) => {
    active = true; t0 = performance.now(); sx = e.clientX; sy = e.clientY;
    armMenuTimer();
    const step = () => {
      if (!active) return;
      const p = (performance.now() - t0) / ms;
      btn.style.setProperty('--p', Math.min(1, p));
      if (p >= 1) { reset(); fn(); return; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  });
  btn.addEventListener('pointermove', (e) => { if (active && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) reset(); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => btn.addEventListener(ev, reset));
  btn.addEventListener('click', (e) => e.preventDefault());
}

// ---------------------------------------------------------------- sheets
function openSheet(name) {
  closeSheets();
  const el = $(`#sheet-${name}`);
  if (!el) return;
  if (name === 'settings') renderSettings();
  if (name === 'plan') renderPlan();
  if (name === 'help') { $('#help-body').innerHTML = helpHtml(VERSION, helpEnv()); $('#help-body').scrollTop = 0; }
  if (name === 'practice') openPractice();
  if (name === 'check') {
    renderCheck();
    clearInterval(S.checkTimer);
    S.checkTimer = setInterval(() => { if ($('#sheet-check').hidden) clearInterval(S.checkTimer); else renderCheck(); }, 1000);
  }
  $('#scrim').hidden = false;
  el.hidden = false;
}

function closeSheets() {
  cancelHold();
  $$('.sheet').forEach((s) => { s.hidden = true; });
  $('#scrim').hidden = true;
  clearTimeout(S.menuTimer);
  if (S.practiceDraft && S.phase === 'ready') cancelPracticePreview();
}

// ---- run menu
let pendingTarget = null;

function openRunMenu() {
  if (S.phase !== 'running') return;
  pendingTarget = null;
  renderRunMenu();
  $('#scrim').hidden = false;
  $('#sheet-menu').hidden = false;
  armMenuTimer();
}

function armMenuTimer() {
  keepLit(12000);
  clearTimeout(S.menuTimer);
  S.menuTimer = setTimeout(() => { if (!$('#sheet-menu').hidden) closeSheets(); }, 20000);
}

function renderRunMenu() {
  const r = S.run;
  let started;
  if (r.t0Source === 'adjusted') {
    // say what the nudges moved it from: your start-line crossing, or else the gun
    const ref = r.crossing ? ['your start-line crossing', r.crossing] : r.mode === 'live' ? ['the gun', r.gunMs] : null;
    const diff = ref ? Math.round((r.t0 - ref[1]) / 1000) : null;
    started = ref
      ? `Clock started at ${fmtTimeOfDay(r.t0, true)}: ${diff === 0 ? 'same as' : `${Math.abs(diff)} s ${diff < 0 ? 'before' : 'after'}`} ${ref[0]} (${fmtTimeOfDay(ref[1], true)}), moved by hand with “Nudge start”.`
      : `Clock started at ${fmtTimeOfDay(r.t0, true)}, moved by hand with “Nudge start”.`;
  } else {
    const src = { tap: 'when you tapped START', gun: 'at the gun', chip: 'when you crossed the start line (chip time)' }[r.t0Source] || r.t0Source;
    started = `Clock started at ${fmtTimeOfDay(r.t0, true)}, ${src}.`;
  }
  $('#menu-summary').textContent = `${started} ` +
    (r.kind === 'race' ? `Finish target ${fmtClock(S.plan ? S.plan.target : r.target)}.` : '');
  const sync = [];
  if (r.kind === 'race' || r.mode === 'live') {
    if (r.crossing && Math.abs(r.crossing - r.t0) >= 500) {
      sync.push(`<button type="button" class="wide hold primary" data-sync="crossing">Hold: start the clock at your start-line crossing (${fmtTimeOfDay(r.crossing, true)})</button>`);
    }
    if (r.t0 !== r.gunMs) sync.push(`<button type="button" class="wide hold" data-sync="gun">Hold: use gun time (${fmtTimeOfDay(r.gunMs, true)})</button>`);
  }
  $('#menu-sync').innerHTML = sync.join('');
  $$('#menu-sync [data-sync]').forEach((b) => bindHold(b, 1000, () => {
    if (b.dataset.sync === 'crossing') {
      setT0(r.crossing, 'chip', `Clock now starts at your crossing, ${fmtTimeOfDay(r.crossing, true)}.`);
      S.voice.say(`Chip time: ${spokenTimeOfDay(r.crossing)}.`);
    } else {
      r.noAutoChip = true;
      setT0(r.gunMs, 'gun', `Clock now starts at the gun, ${fmtTimeOfDay(r.gunMs, true)}.`);
      S.voice.say(`Gun time: ${spokenTimeOfDay(r.gunMs)}.`);
    }
    S.crossHintUntil = 0;
    renderRunMenu();
  }));
  $('#menu-vmode').innerHTML = voiceModeButtons();
  $('#menu-voice').innerHTML = voiceButtons();
  $('#menu-voice').hidden = (S.settings.voiceMode || 'offpace') !== 'every';
  $('#menu-theme').innerHTML = themeButtons();
  $('#menu-pocket').innerHTML = pocketButtons();
  const rt = $('#btn-retarget');
  if (pendingTarget !== null) {
    rt.hidden = false;
    rt.textContent = `Hold: finish in ${fmtClock(pendingTarget)} from here`;
  } else rt.hidden = true;
  $('#sheet-menu [data-retarget]')?.closest('.menu-row')?.toggleAttribute('hidden', r.kind === 'free');
}

function bindRunMenu() {
  $$('#sheet-menu [data-nudge]').forEach((b) => bindHold(b, 1000, () => {
    const s = Number(b.dataset.nudge);
    setT0(S.run.t0 + s * 1000, 'adjusted', `Start moved ${s > 0 ? 'later' : 'earlier'} by ${Math.abs(s)} s.`);
    renderRunMenu();
  }));
  $$('#sheet-menu [data-retarget]').forEach((b) => b.addEventListener('click', () => {
    armMenuTimer();
    if (!S.plan) return;
    const base = pendingTarget ?? S.plan.target;
    pendingTarget = Math.max(600, base + Number(b.dataset.retarget));
    renderRunMenu();
  }));
  bindHold($('#btn-retarget'), 1000, () => {
    if (pendingTarget === null || !S.plan) return;
    const now = clock.now();
    const el = (now - S.run.t0) / 1000;
    const est = S.tracker && S.tracker.tracking ? S.tracker.peek(now) : null;
    if (!est || el <= 0) { toast('Needs a GPS position on the course.'); return; }
    S.run.replan = { d: est.d, t: el, target: pendingTarget };
    S.plan = planFor(S.course, S.run);
    saveRunState();
    S.gap.reset();
    S.alert = { level: 0 };
    toast(`New plan: finish in ${fmtClock(pendingTarget)}. Gap reset to 0 here.`);
    pendingTarget = null;
    renderRunMenu();
  });
  $('#menu-vmode').addEventListener('click', (e) => {
    const b = e.target.closest('[data-vm]'); if (!b) return;
    setVoiceMode(b.dataset.vm);
    renderRunMenu(); armMenuTimer();
  });
  $('#menu-voice').addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    setVoiceEvery(Number(b.dataset.v));
    renderRunMenu(); armMenuTimer();
  });
  $('#menu-theme').addEventListener('click', (e) => {
    const b = e.target.closest('[data-theme]'); if (!b) return;
    setTheme(b.dataset.theme);
    renderRunMenu(); armMenuTimer();
  });
  $('#menu-pocket').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pocket]'); if (!b) return;
    setPocket(b.dataset.pocket === '1');
    if (S.settings.pocket) {
      closeSheets();
      toast(`Pocket mode: black screen, voice ${voiceDesc()}. Tap the screen to look.`, 5000);
    } else { renderRunMenu(); armMenuTimer(); }
  });
  $('#btn-export').addEventListener('click', () => exportGpx(S.run));
  bindHoldFx($('#btn-stop'), 'stop', () => { closeSheets(); stopRun(); }, { slop: 12, when: () => { armMenuTimer(); return true; } });
}

// ---- settings
function bindSettings() {
  const upd = () => { saveSettings(S.settings); S.readyPlan = planFor(S.marathon, null); if (S.course === S.marathon) S.plan = S.readyPlan; renderSettings(); renderReady(); };
  $$('#sheet-settings [data-target]').forEach((b) => b.addEventListener('click', () => {
    S.settings.target = Math.max(2 * 3600, Math.min(6 * 3600, S.settings.target + Number(b.dataset.target))); upd();
  }));
  $$('#sheet-settings [data-wind]').forEach((b) => b.addEventListener('click', () => {
    const v = Number(b.dataset.wind);
    S.settings.wind.kmh = v === 0 ? 0 : Math.max(0, Math.min(50, S.settings.wind.kmh + v)); upd();
  }));
  $('#wind-dirs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-dir]'); if (!b) return;
    S.settings.wind.fromDeg = Number(b.dataset.dir);
    if (S.settings.wind.kmh === 0) S.settings.wind.kmh = 15;
    upd();
  });
  $$('#sheet-settings [data-aid]').forEach((b) => b.addEventListener('click', () => {
    S.settings.aidSeconds = Math.max(0, Math.min(15, S.settings.aidSeconds + Number(b.dataset.aid))); upd();
  }));
  $$('#sheet-settings [data-gun]').forEach((b) => b.addEventListener('click', () => {
    const v = Number(b.dataset.gun);
    S.settings.gunOffset = v === 0 ? 0 : S.settings.gunOffset + v; upd(); renderReadyLive(clock.now());
  }));
  $('#set-vmode').addEventListener('click', (e) => {
    const b = e.target.closest('[data-vm]'); if (!b) return;
    S.voice.unlock();
    setVoiceMode(b.dataset.vm);
    renderSettings();
  });
  $('#set-band').addEventListener('click', (e) => {
    const b = e.target.closest('[data-band]'); if (!b) return;
    S.settings.voiceBand = Number(b.dataset.band);
    saveSettings(S.settings);
    S.alert = { level: 0 };
    S.voice.unlock();
    const sample = S.settings.voiceBand;
    S.voice.say(`${spokenGap(sample)}.`, { force: true });
    renderSettings();
  });
  $('#set-voice').addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    S.voice.unlock();
    setVoiceEvery(Number(b.dataset.v));
    renderSettings();
  });
  $('#set-wind-fc').addEventListener('click', async () => {
    const b = $('#set-wind-fc');
    const note = $('#set-wind-fc-note');
    b.disabled = true;
    note.textContent = 'Getting the forecast…';
    try {
      applyWind(await raceForecast());
    } catch (e) {
      note.textContent = navigator.onLine === false
        ? 'No connection. Set the wind by hand, or leave it: still air is fine.'
        : `Could not get the forecast (${e.message}). Set the wind by hand, or leave it.`;
    }
    b.disabled = false;
  });
  $('#set-bars').addEventListener('change', (e) => {
    S.settings.bars = parseBars(e.target.value, S.marathon.total / 1000);
    saveSettings(S.settings);
    renderSettings();
    showBars();
  });
  $('#set-bars').addEventListener('blur', () => renderSettings());
  $('#set-bars-suggest').addEventListener('click', () => {
    S.settings.bars = SUGGESTED_BARS.map((b) => ({ ...b }));
    S.settings.preBar = 'caf';
    S.settings.raceGels = true;
    saveSettings(S.settings);
    renderSettings();
    renderReady();
    showBars();
  });
  $('#set-fuel-opts').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pre],[data-gels]'); if (!b) return;
    if (b.dataset.pre) S.settings.preBar = b.dataset.pre;
    if (b.dataset.gels) S.settings.raceGels = b.dataset.gels === '1';
    saveSettings(S.settings);
    renderSettings();
    renderReady();
    showBars();
  });
  $('#set-theme').addEventListener('click', (e) => {
    const b = e.target.closest('[data-theme]'); if (!b) return;
    setTheme(b.dataset.theme);
    renderSettings();
  });
  $('#set-pocket').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pocket]'); if (!b) return;
    setPocket(b.dataset.pocket === '1');
    renderSettings();
  });
  $('#btn-sim').addEventListener('click', () => startSim(20));
}

// ---- fuel plan: the bar before the start, your bars and the race's gels, in order. Each
// bar is checked: 1 km before an aid station, not uphill, not a steep downhill, no tunnel.
function fuelPlanHtml(s) {
  const plan = S.readyPlan, c = S.marathon;
  const pre = s.preBar || 'caf';
  const gels = s.raceGels !== false ? c.aid.filter((a) => a.what === 'gels') : [];
  const items = (s.bars || []).map((b) => ({ d: b.km * 1000, bar: true, caf: b.caf }))
    .concat(gels.map((a) => ({ d: a.d, gel: true })))
    .sort((a, b) => a.d - b.d);
  const rows = [];
  if (pre !== 'none') {
    rows.push(`<div class="bar-row"><b>before the start</b> ${fmtTimeOfDay(gunMs() - 40 * 60000)} · ${pillHtml(pre === 'caf')} bar, 30–45 min before the gun</div>`);
  }
  let prevT = null;
  for (const it of items) {
    const t = plan.timeAt(it.d);
    const gap = prevT === null ? null : Math.round((t - prevT) / 60);
    prevT = t;
    let what = '';
    let bad = false;
    if (it.bar) {
      const sp = c.spotAt(it.d);
      const w = sp.water;
      const onCue = w && Math.abs(w.m - 1000) <= 100;
      const hard = sp.terrain === 'uphill' || sp.terrain === 'steep downhill' || sp.terrain === 'in the tunnel';
      bad = hard || !onCue;
      const terrain = sp.terrain === 'flat' || sp.tunnel ? sp.terrain : `${sp.terrain} ${sp.grade > 0 ? '+' : '−'}${Math.abs(sp.grade).toFixed(1)} %`;
      what = ` · ${hard ? `<b class="warn">${terrain}</b>` : terrain}${sp.street ? `, ${escapeHtml(sp.street)}` : ''} · ` +
        (!w ? '<b class="warn">no aid station after it</b>'
          : onCue ? `water at ${w.km}, 1 km on`
            : `<b class="warn">water at ${w.km} is ${w.m < 1000 ? 'only ' : ''}${fmtDist(w.m)} on: make it ${(w.km - 1).toFixed(1)}</b>`);
    }
    const km = it.gel ? String(it.d / 1000) : (it.d / 1000).toFixed(1);
    const close = gap !== null && gap < 12 ? ' <b class="warn">close to the one before</b>' : '';
    const name = it.gel ? 'race gel' : `${pillHtml(it.caf)} bar`;
    rows.push(`<div class="bar-row${bad ? ' bad' : ''}${it.gel ? ' gel' : ''}"><b>km ${km}</b> ${fmtClock(t).slice(0, 4)}${gap !== null ? ` (+${gap} min)` : ''} · ${name}${close}${what}</div>`);
  }
  const onCourse = (s.bars || []).length;
  const nBars = onCourse + (pre !== 'none' ? 1 : 0);
  const nCaf = (s.bars || []).filter((b) => b.caf).length + (pre === 'caf' ? 1 : 0);
  const grams = (onCourse + gels.length) * 25;
  const perHour = Math.round(grams / (plan.timeAt(c.total) / 3600));
  rows.push(`<div class="bar-row total">In the race: ${onCourse} bar${onCourse === 1 ? '' : 's'}${gels.length ? ` + ${gels.length} gels` : ''} × ~25 g ≈ ${grams} g of carbs, ${perHour} g/h${pre !== 'none' ? ', plus 25 g before the start' : ''}. ` +
    `Caffeine ${nCaf * 50} mg (${nCaf} CAF × 50 mg). ${nBars} bar${nBars === 1 ? '' : 's'} in all: ${nCaf} CAF, ${nBars - nCaf} REG.</div>`);
  return rows.join('');
}

// your bars on the map, and the one before the start at the start line (until a run starts:
// then the ghost waits there)
function showBars() {
  if (S.mapReady && S.course === S.marathon) S.map.setBars(S.marathon, S.settings.bars, S.run ? 'none' : S.settings.preBar || 'caf');
}

function pillHtml(caf) { return `<span class="pill">${caf ? 'CAF' : 'REG'}</span>`; }

function fmtDist(m) { return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`; }

// ---- wind forecast (optional: needs a connection, asked once)
function raceDay() {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(gunMs()));
  } catch { return '2026-10-04'; }
}

function fmtRaceDay() {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', month: 'short', day: 'numeric' }).format(new Date(gunMs())); } catch { return 'Oct 4'; }
}

function raceForecast() {
  const [la, lo] = S.marathon.line.latLonAt(S.marathon.total / 2);
  return fetchRaceWind({ lat: la, lon: lo, date: raceDay() });
}

function settingsChanged() {
  saveSettings(S.settings);
  S.readyPlan = planFor(S.marathon, null);
  if (S.course === S.marathon && S.phase !== 'running') S.plan = S.readyPlan;
  if (!$('#sheet-settings').hidden) renderSettings();
  if (S.phase === 'ready') renderReady();
}

function applyWind(w) {
  const kmh = Math.round(w.kmh);
  S.settings.wind = { fromDeg: w.dir8, kmh };
  S.settings.windSource = { at: Date.now(), fromDeg: w.fromDeg, dir8: w.dir8, kmh: w.kmh, gust: w.gust };
  settingsChanged();
}

// Race morning (from 3 h before the gun), on the start screen, with a connection: look at
// the forecast once and offer it on a chip. Never during the run, never again after.
function maybeSuggestWind(now = Date.now()) {
  if (S.windTried || S.phase !== 'ready' || S.sim || !S.marathon) return;
  const g = gunMs();
  if (now < g - 3 * 3600e3 || now > g) return;
  const src = S.settings.windSource;
  if (src && now - src.at < 4 * 3600e3) return; // already fetched this morning
  S.windTried = true;
  raceForecast().then((w) => {
    if (Math.round(w.kmh) < 3 && S.settings.wind.kmh === 0) return; // still air already
    S.windSuggest = w;
    renderChips();
  }).catch(() => { /* no connection: nothing to suggest */ });
}

const DIRS = [['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SW', 225], ['W', 270], ['NW', 315]];
function dirName(deg) { return DIRS.reduce((b, d) => (Math.abs(angleDiff(d[1], deg)) < Math.abs(angleDiff(b[1], deg)) ? d : b))[0]; }

function renderSettings() {
  const s = S.settings;
  $('#set-target').textContent = fmtClock(s.target);
  const margin = 3 * 3600 - s.target;
  const marginTxt = margin < 60 ? `${margin} s` : `${Math.floor(margin / 60)} min${margin % 60 ? ` ${margin % 60} s` : ''}`;
  $('#set-target-note').textContent = margin > 0
    ? `${marginTxt} of margin under 3:00:00. Flat-ground pace about ${fmtPace(flatPace())} /km.`
    : 'That is not under three hours.';
  $('#set-wind').textContent = s.wind.kmh > 0 ? `From ${dirName(s.wind.fromDeg)} · ${s.wind.kmh} km/h` : 'Still air';
  $('#wind-dirs').innerHTML = DIRS.map(([n, deg]) =>
    `<button type="button" data-dir="${deg}" class="${s.wind.kmh > 0 && Math.round(s.wind.fromDeg) === deg ? 'on' : ''}">${n}</button>`).join('');
  if (s.wind.kmh > 0) {
    const still = S.marathon.plan({ target: s.target, aidSeconds: s.aidSeconds });
    const p = S.readyPlan;
    const seg = (pl, a, b) => pl.timeAt(b) - pl.timeAt(a);
    const river = seg(p, 25700, 35000) - seg(still, 25700, 35000);
    const upper = seg(p, 13000, 25000) - seg(still, 13000, 25000);
    $('#set-wind-note').textContent = `River (km 25.7–35): ${signed(river)} s. Upper town (km 13–25): ${signed(upper)} s. Same finish time.`;
  } else {
    $('#set-wind-note').textContent = 'Optional, on race morning: the forecast direction the wind comes FROM and its speed. The ghost eases into headwinds and speeds up with tailwinds, weighted by how exposed each stretch is. Same finish time.';
  }
  const src = s.windSource;
  if (src && document.activeElement !== $('#set-wind-fc')) {
    $('#set-wind-fc-note').textContent = `Forecast for ${fmtRaceDay()} 8:00–11:00 (Open-Meteo, fetched ${fmtTimeOfDay(src.at)}): from ${dirName(src.dir8)} (${Math.round(src.fromDeg)}°), ${Math.round(src.kmh)} km/h${src.gust ? `, gusts to ${Math.round(src.gust)}` : ''}. ${s.wind.kmh === Math.round(src.kmh) && s.wind.fromDeg === src.dir8 ? 'In use.' : 'Changed by hand since.'}`;
  }
  $('#set-aid').textContent = `${s.aidSeconds} s`;
  $('#set-aid-list').innerHTML = S.marathon.aid.map((a) => `km ${a.km}${a.what ? ` <b>${escapeHtml(a.what)}</b>` : ''}`).join(' · ');
  $('#set-vmode').innerHTML = voiceModeButtons();
  $('#set-voice').innerHTML = voiceButtons();
  $('#set-voice').hidden = (s.voiceMode || 'offpace') !== 'every';
  const band = offPace().band;
  $('#set-band').hidden = (s.voiceMode || 'offpace') !== 'offpace';
  $('#set-band').innerHTML = [5, 10].map((b) => `<button type="button" data-band="${b}" class="${band === b ? 'on' : ''}">Warn from ${b} s</button>`).join('');
  const bars = s.bars || [];
  const barsEl = $('#set-bars');
  if (document.activeElement !== barsEl) barsEl.value = fmtBars(bars);
  $('#set-bars-list').innerHTML = fuelPlanHtml(s);
  $('#set-fuel-opts').innerHTML =
    `<div class="seg compact">${[['caf', 'CAF bar'], ['bar', 'REG bar'], ['none', 'Nothing']].map(([k, t]) => `<button type="button" data-pre="${k}" class="${(s.preBar || 'caf') === k ? 'on' : ''}">${t}</button>`).join('')}</div>` +
    `<div class="seg compact stack">${[['1', 'Take the race gels'], ['0', 'Skip them']].map(([k, t]) => `<button type="button" data-gels="${k}" class="${(s.raceGels !== false) === (k === '1') ? 'on' : ''}">${t}</button>`).join('')}</div>`;
  const gels = S.marathon.aid.filter((a) => a.what === 'gels').map((a) => a.km).join(' and ');
  $('#set-bars-note').textContent = `Type the km where each bar is announced, 1 km before an aid station; add “c” for a caffeinated one (21.9c). The map shows them (CAF, REG) and the voice says “Take caffeinated bar” or “Take regular bar” there: about 2 min to eat it, 2 to get ready. Every aid station is announced 200 m before it: “Water in 200 meters”, or “Gel in 200 meters” at km ${gels}. Spots are checked for slope, the tunnels and the station 1 km on.`;
  $('#set-bars-suggest').hidden = JSON.stringify(bars) === JSON.stringify(SUGGESTED_BARS) && (s.preBar || 'caf') === 'caf' && s.raceGels !== false;
  const vm = s.voiceMode || 'offpace';
  $('#set-voice-note').textContent = vm === 'offpace'
    ? `Warnings start ${band} s from the ghost, either way, then come at ${ladderText(band)}, getting worse and getting better, and stop past 5 minutes: “${band}, ${band + 5}, ${band + 10} seconds behind”, then “${band + 5}”, “${band}” as you come back; the same ahead. Right after a warning, “on pace” the moment you meet the ghost again. Nothing else. ${band === 5 ? 'Expect one every 10 minutes or so.' : 'Rarely speaks; 5 s keeps you closer.'} Also your bars (“Take caffeinated bar”) and every aid station (“Water in 200 meters”).`
    : vm === 'every'
      ? `Every ${voiceLabel(s.voiceEvery || 1000)} of official distance: “3 seconds behind”, “5 seconds ahead” or “on pace”. Also your bars and every aid station.`
      : 'No voice. (Pocket mode still speaks when off pace.)';
  $('#set-theme').innerHTML = themeButtons();
  $('#set-theme-note').textContent = THEME_NOTES[s.theme];
  $('#set-pocket').innerHTML = pocketButtons();
  $('#set-gun').textContent = fmtTimeOfDay(gunMs(), true);
  $('#about').textContent = `Version ${VERSION}${S.build ? ` · build ${S.build.slice(0, 7)}` : ''}. Map data © OpenStreetMap contributors, Overture Maps Foundation. Terrain: AWS Terrain Tiles.`;
}

const VOICE_STEPS = [250, 500, 1000, 2000];
function voiceLabel(m) { return m < 1000 ? `${m} m` : `${m / 1000} km`; }

function voiceModeButtons() {
  const m = S.settings.voiceMode || 'offpace';
  return [['off', 'Off'], ['offpace', 'When off pace'], ['every', 'Every…']]
    .map(([k, t]) => `<button type="button" data-vm="${k}" class="${m === k ? 'on' : ''}">${t}</button>`).join('');
}

function voiceButtons() {
  const v = S.settings.voiceEvery || 1000;
  return VOICE_STEPS.map((m) => `<button type="button" data-v="${m}" class="${v === m ? 'on' : ''}">${voiceLabel(m)}</button>`).join('');
}

function themeButtons() {
  const t = S.settings.theme;
  return THEME_ORDER.map((k) => `<button type="button" data-theme="${k}" class="${t === k ? 'on' : ''}">` +
    `<span class="swatch" style="background:${THEMES[k].line}"></span>${THEMES[k].label}</button>`).join('');
}

function pocketButtons() {
  const p = !!S.settings.pocket;
  return `<button type="button" data-pocket="0" class="${p ? '' : 'on'}">Off</button><button type="button" data-pocket="1" class="${p ? 'on' : ''}">On</button>`;
}

function setVoiceMode(m) {
  S.settings.voiceMode = m;
  saveSettings(S.settings);
  S.voice.enabled = voiceMode() !== 'off';
  S.lastVoiceK = null;
  S.alert = { level: offPaceLevel(S.gap.state().shown ?? 0, offPace()) }; // start from where you are
  if (m === 'every') setVoiceEvery(S.settings.voiceEvery || 1000);
  else if (m === 'offpace') {
    const g = S.phase === 'running' ? S.gap.state().value : null;
    const say = g === null ? 10 : g;
    S.voice.say(`Only when off pace. ${spokenGap(say)}.`, { force: true });
  }
}

function setVoiceEvery(m) {
  S.settings.voiceEvery = m;
  S.settings.voiceMode = 'every';
  saveSettings(S.settings);
  S.voice.enabled = true;
  S.lastVoiceK = null; // count the new interval from here
  if (m > 0) {
    // a sample on the start screen; the real gap during a run
    const g = (S.phase === 'running' ? S.gap.state().value : null) ?? 3;
    const every = m < 1000 ? `${m} metres` : m === 1000 ? 'kilometre' : `${m / 1000} kilometres`;
    S.voice.say(`Every ${every}. ${spokenGap(g)}.`, { force: true });
  }
}

function setTheme(name) {
  S.settings.theme = themeName(name);
  saveSettings(S.settings);
  applyTheme(S.settings.theme);
  if (S.mapReady) S.map.setTheme(S.settings.theme);
  S.lastPanel = {};
}

function setPocket(on) {
  S.settings.pocket = on;
  saveSettings(S.settings);
  S.voice.enabled = voiceMode() !== 'off';
  S.peekUntil = 0;
  S.lastPanel = {};
}

function flatPace() {
  const p = S.readyPlan;
  // pace of the flattest kilometres (median of splits)
  const splits = [];
  for (let k = 1; k <= 42; k++) splits.push(p.split(k));
  splits.sort((a, b) => a - b);
  return splits[Math.floor(splits.length * 0.4)];
}

function renderPlan() {
  const p = S.readyPlan;
  const c = S.marathon;
  const gun = gunMs();
  const rows = [];
  const flat = flatPace();
  for (let k = 1; k <= 43; k++) {
    const a = (k - 1) * 1000, b = Math.min(k * 1000, c.total);
    if (a >= c.total) break;
    const split = p.timeAt(b) - p.timeAt(a);
    const per = split / ((b - a) / 1000);
    const up = c.elevationAt(b) - c.elevationAt(a);
    const notes = [];
    for (const aid of c.aid) if (aid.d > a && aid.d <= b) notes.push(`aid ${aid.km}${aid.what ? ` ${aid.what}` : ''}`);
    for (const bar of S.settings.bars || []) if (bar.km * 1000 > a && bar.km * 1000 <= b) notes.push(`${bar.caf ? 'CAF' : 'REG'} bar ${bar.km.toFixed(1)}`);
    for (const [ta, tb] of c.tunnels) if (tb - ta > 300 && ta < b && tb > a) notes.push('tunnel');
    const cls = per > flat + 12 ? 'climb' : per < flat - 8 ? 'down' : '';
    rows.push(`<tr class="${cls}"><td>${b === c.total ? '42.2' : k}</td><td class="pace">${fmtPace(split)}</td>` +
      `<td>${fmtClock(p.timeAt(b))}</td><td>${fmtTimeOfDay(gun + p.timeAt(b) * 1000)}</td>` +
      `<td class="elev">${Math.round(up) > 0 ? '+' : Math.round(up) < 0 ? '−' : ''}${Math.abs(Math.round(up))}</td><td class="note">${notes.join(' · ')}</td></tr>`);
  }
  $('#plan-body').innerHTML =
    `<p class="muted small">Even effort for ${fmtClock(S.settings.target)}${S.settings.wind.kmh ? `, wind from ${dirName(S.settings.wind.fromDeg)} ${S.settings.wind.kmh} km/h` : ''}. ` +
    `The ghost follows this to the metre; you only watch the number. Times of day assume the gun at ${fmtTimeOfDay(gun, true)}.</p>` +
    `<table class="splits"><thead><tr><th>km</th><th>split</th><th>clock</th><th>time</th><th>m</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

// ---- practice: Sommet 3V → DKN or DKN → Sommet 3V, one way
function bindPractice() {
  $('#pr-route').addEventListener('click', (e) => {
    const b = e.target.closest('[data-route]'); if (!b) return;
    S.settings.practiceRoute = b.dataset.route; saveSettings(S.settings); buildPracticeRoute();
  });
  $$('#sheet-practice [data-ppace]').forEach((b) => b.addEventListener('click', () => {
    S.settings.practicePace = Math.max(180, Math.min(480, S.settings.practicePace + Number(b.dataset.ppace)));
    saveSettings(S.settings); buildPracticeRoute();
  }));
  $('#pr-start').addEventListener('click', () => {
    const dr = S.practiceDraft;
    if (!dr || !dr.spec) return;
    const pace = S.settings.practicePace;
    const spec = dr.spec;
    S.practiceDraft = null;
    beginRun(newRun('practice', 'manual', { target: (spec.distance / 1000) * pace, practice: { spec, pace }, wind: { fromDeg: 0, kmh: 0 }, aidSeconds: 0 }));
  });
  $('#pr-live').addEventListener('click', () => {
    const dr = S.practiceDraft;
    if (!dr || !dr.spec) return;
    const pace = S.settings.practicePace;
    const spec = withStartLine(dr.spec, 30);
    const gun = Math.ceil((clock.now() + 60000) / 1000) * 1000;
    S.practiceDraft = null;
    beginRun(newRun('practice', 'live', {
      gunMs: gun, t0: gun, t0Source: 'gun', rehearsal: true,
      target: (spec.distance / 1000) * pace, practice: { spec, pace }, wind: { fromDeg: 0, kmh: 0 }, aidSeconds: 0,
    }));
  });
  $('#pr-free').addEventListener('click', () => {
    const pace = S.settings.practicePace;
    S.practiceDraft = null;
    beginRun(newRun('free', 'manual', { target: 0, free: { pace }, wind: { fromDeg: 0, kmh: 0 }, aidSeconds: 0 }));
  });
}

function practiceRoute() {
  return PRACTICE_ROUTES.find((r) => r.id === S.settings.practiceRoute) || PRACTICE_ROUTES[0];
}

// "Sommet → DKN" on the buttons, "Sommet 3V → DKN" as the run's name
function routeLabel(r, key = 'name') { return `${S.places[r.from][key]} → ${S.places[r.to][key]}`; }

async function openPractice() {
  if (!S.gpsWanted) startGps();
  if (!S.practiceDraft) S.practiceDraft = { spec: null, needFix: false };
  $('#pr-info').textContent = 'Loading the street map…';
  $('#pr-start').disabled = true;
  $('#pr-live').disabled = true;
  try {
    if (!S.graph) {
      const [g, d, places] = await Promise.all([
        fetch('data/practice-graph.bin').then((r) => r.arrayBuffer()),
        fetch('data/practice-dem.bin').then((r) => r.arrayBuffer()),
        fetch('data/practice-places.json').then((r) => r.json()),
      ]);
      S.graph = new Graph(g);
      S.dem = new Dem(d);
      S.places = places;
    }
  } catch (e) {
    $('#pr-info').textContent = 'Could not load the practice map. Use Free run.';
    return;
  }
  // standing at one end: that is where the run starts
  const fix = S.fix && Date.now() - S.fixReal < 60000 ? S.fix : null;
  if (fix) {
    const near = PRACTICE_ROUTES.map((r) => ({ r, m: haversine(fix.lat, fix.lon, S.places[r.from].lat, S.places[r.from].lon) }))
      .sort((x, y) => x.m - y.m)[0];
    if (near.m < 1000 && near.r.id !== practiceRoute().id) { S.settings.practiceRoute = near.r.id; saveSettings(S.settings); }
  }
  buildPracticeRoute();
}

function buildPracticeRoute() {
  const dr = S.practiceDraft;
  if (!dr || !S.graph) return;
  const r = practiceRoute();
  $('#pr-route').innerHTML = PRACTICE_ROUTES.map((x) =>
    `<button type="button" data-route="${x.id}" class="${x.id === r.id ? 'on' : ''}">${escapeHtml(routeLabel(x, 'short'))}</button>`).join('');
  $('#pr-pace').textContent = `${fmtPace(S.settings.practicePace)} /km`;
  const a = S.places[r.from], b = S.places[r.to];
  S.practiceSpecs = S.practiceSpecs || {};
  let spec = S.practiceSpecs[r.id];
  if (!spec) {
    const route = S.graph.route(a.lat, a.lon, b.lat, b.lon);
    if (!route) {
      $('#pr-info').textContent = 'Could not find the route on the street map. Use Free run.';
      dr.spec = null;
      return;
    }
    spec = S.practiceSpecs[r.id] = practiceSpec(route, S.dem, { name: routeLabel(r) });
  }
  dr.spec = spec;
  renderPracticeInfo();
  $('#pr-start').disabled = false;
  $('#pr-live').disabled = false;
  const pace = S.settings.practicePace;
  const course = new Course(spec);
  useCourse(course, course.plan({ target: (spec.distance / 1000) * pace }));
  S.follow = true;
  if (S.mapReady) S.map.overview(null);
  S.overviewShown = true;
}

// "2.83 km one way · ghost 12:02 …", and how far you are from the start
function renderPracticeInfo() {
  const dr = S.practiceDraft;
  if (!dr || !dr.spec) return;
  const r = practiceRoute(), spec = dr.spec, start = S.places[r.from];
  const pace = S.settings.practicePace;
  const km = spec.distance / 1000;
  const climb = spec.profile.ele.reduce((acc, v, i, x) => acc + (i && v > x[i - 1] ? v - x[i - 1] : 0), 0);
  let where = '';
  const fix = S.fix && Date.now() - S.fixReal < 60000 ? S.fix : null;
  dr.needFix = !fix;
  if (fix) {
    const m = haversine(fix.lat, fix.lon, spec.line[0][0], spec.line[0][1]);
    if (m > 150) where = ` <b>You are ${fmtDist(m)} from the start, ${escapeHtml(start.name)}.</b>`;
  }
  $('#pr-info').innerHTML = `<b>${km.toFixed(2)} km</b> one way, ${escapeHtml(start.full)} to ${escapeHtml(S.places[r.to].full)} · ghost ${fmtClock(km * pace)} at ${fmtPace(pace)} /km average · ${Math.round(climb)} m of climbing. The ghost uses even effort on the hills, like race day.${where}`;
}

function cancelPracticePreview() {
  S.practiceDraft = null;
  useCourse(S.marathon, S.readyPlan);
}

// ---------------------------------------------------------------- simulation
function startSim(speed, opts = {}) {
  closeSheets();
  let spec = opts.practiceSpec || null;
  const live = !!(spec && opts.live); // LIVE rehearsal on a practice route
  if (live) spec = withStartLine(spec, 30);
  const course = spec ? new Course(spec) : S.marathon;
  const pace = S.settings.practicePace;
  const target = spec ? (spec.distance / 1000) * pace : S.settings.target;
  const plan = spec ? course.plan({ target }) : planFor(course, null);
  const realStart = Date.now();
  const virtStart = spec ? realStart : gunMs() - 20000; // race: 20 s before the gun
  const gunAt = live ? virtStart + 10000 : null;
  const crossAt = live ? gunAt + 5000 : virtStart + (spec ? 3000 : 26000);
  S.sim = {
    speed, realStart, virtStart, crossAt,
    // A different race every time: a new random runner, on average between 0.5 % faster
    // and 0.4 % slower than the ghost, with pace swings of their own.
    gen: simulate(course, plan, {
      startMs: crossAt, preStartS: live ? 15 : spec ? 3 : 45, seed: opts.seed ?? 1 + Math.floor(Math.random() * 1e9),
      bias: opts.bias ?? -0.005 + Math.random() * 0.009, wobble: 0.02, outlierRate: 0.01, detour: opts.detour || null,
    }),
    next: null,
  };
  clock.now = () => S.sim.virtStart + (Date.now() - S.sim.realStart) * S.sim.speed;
  $('#sim-banner').hidden = false;
  $('#sim-speed').textContent = `${speed}×`;
  S.practiceDraft = null;
  if (spec) {
    beginRun(newRun('practice', live ? 'live' : 'manual', {
      t0: live ? gunAt : crossAt, target, practice: { spec, pace }, wind: { fromDeg: 0, kmh: 0 }, aidSeconds: 0,
      ...(live ? { gunMs: gunAt, t0Source: 'gun', rehearsal: true } : {}),
    }));
  } else beginRun(newRun('race', 'live'));
}

function feedSim(now) {
  const sim = S.sim;
  for (let i = 0; i < 200; i++) {
    if (!sim.next) {
      const n = sim.gen.next();
      if (n.done) { sim.next = null; return; }
      sim.next = n.value;
    }
    if (sim.next.tMs > now) return;
    if (sim.next.fix) { S.fixReal = Date.now(); handleFix(sim.next.fix); }
    sim.next = null;
  }
}

function endSim(stop) {
  if (!S.sim) return;
  S.sim = null;
  clock.now = () => Date.now();
  $('#sim-banner').hidden = true;
  S.fix = null;
  if (stop && S.run) stopRun();
  startGps();
}

// ---------------------------------------------------------------- export
async function exportGpx(run) {
  if (!run) return;
  if (S.track) S.track.flush();
  const pts = TrackLog.load(run.id);
  if (!pts.length) { toast('No GPS points recorded for this run yet.'); return; }
  const name = run.kind === 'race' ? 'Marathon Beneva de Québec 2026' : 'Pacer practice';
  const gpx = toGpx(pts, name);
  const fname = `${name.replace(/[^A-Za-z0-9]+/g, '-')}-${new Date(run.created).toISOString().slice(0, 10)}.gpx`;
  const file = new File([gpx], fname, { type: 'application/gpx+xml' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = fname; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 20000);
}

// ---------------------------------------------------------------- service worker
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  // A new version activates as soon as it is downloaded. Reload onto it right away on the
  // start screen; during a run, never (it is used from the next launch).
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return; // first visit: the worker just took over, same version
    if (S.phase === 'running') { S.updateReady = true; renderChips(); return; }
    toast('New version · reloading', 1500);
    setTimeout(() => location.reload(), 600);
  });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const check = () => {
      if (reg.waiting && navigator.serviceWorker.controller) { S.updateReady = true; renderChips(); }
    };
    check();
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (w) w.addEventListener('statechange', check);
    });
    const look = () => { if (S.phase !== 'running') reg.update().catch(() => {}); };
    setTimeout(look, 3000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') look(); });
  }).catch(() => { S.offline = false; });
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'status') {
      S.offline = !!e.data.complete;
      if (e.data.version) S.build = e.data.version;
      renderChips();
    }
  });
  navigator.serviceWorker.ready.then((reg) => {
    const ask = () => reg.active && reg.active.postMessage({ type: 'status' });
    ask();
    setTimeout(ask, 3000);
    setTimeout(ask, 15000);
  });
}

function applyUpdate() {
  if (S.phase === 'running') { toast('Finish or stop the run first.'); return; }
  navigator.serviceWorker.getRegistration().then((reg) => {
    if (reg && reg.waiting) {
      navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
      reg.waiting.postMessage({ type: 'skipWaiting' });
    } else location.reload();
  });
}

function loadLastPos(runId) {
  try {
    const v = JSON.parse(localStorage.getItem('pacer.lastpos') || 'null');
    return v && v.run === runId ? v : null;
  } catch { return null; }
}

function saveLastPos(runId, p) {
  try { localStorage.setItem('pacer.lastpos', JSON.stringify({ run: runId, ...p })); } catch { /* ignore */ }
}

// ---------------------------------------------------------------- helpers
function smooth(cur, target, dt, tau) { return cur + (target - cur) * (1 - Math.exp(-dt / tau)); }
function smoothAngle(cur, target, dt, tau) { return (cur + angleDiff(cur, target) * (1 - Math.exp(-dt / tau)) + 360) % 360; }
function signed(s) { const r = Math.round(s); return `${r > 0 ? '+' : r < 0 ? '−' : '±'}${Math.abs(r)}`; }
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }

function fmtCountdown(sec) {
  const s = Math.ceil(sec);
  if (s >= 3600) return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function fmtAway(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
}

// hour, minute, second of the day in Québec (the race's time zone, whatever the phone's)
function timeParts(ms) {
  const d = new Date(ms);
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Toronto', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(d);
    const g = (t) => Number(parts.find((p) => p.type === t).value);
    return [g('hour'), g('minute'), g('second')];
  } catch {
    return [d.getHours(), d.getMinutes(), d.getSeconds()];
  }
}

function fmtTimeOfDay(ms, seconds = false) {
  const [h, m, sec] = timeParts(ms);
  const mm = String(m).padStart(2, '0');
  return seconds ? `${h}:${mm}:${String(sec).padStart(2, '0')}` : `${h}:${mm}`;
}

// A time of day to the second, for the voice: "8 a.m. and 5 seconds" (8:00:05), "7:59 a.m.
// and 55 seconds", "8 a.m. exactly", "5:42 p.m. and 1 second".
function spokenTimeOfDay(ms) {
  const [h, m, sec] = timeParts(ms);
  const hm = m ? `${h % 12 || 12}:${String(m).padStart(2, '0')}` : `${h % 12 || 12}`;
  return `${hm} ${h < 12 ? 'a.m.' : 'p.m.'}${sec ? ` and ${sec} second${sec === 1 ? '' : 's'}` : ' exactly'}`;
}

function spokenClock(sec) {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return `${h ? `${h} hour${h > 1 ? 's' : ''} ` : ''}${m} minute${m === 1 ? '' : 's'} ${r} second${r === 1 ? '' : 's'}`;
}

let toastTimer = null;
function toast(msg, ms = 3000) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// test hook (used by the automated browser tests)
window.__pacer = { S, clock, handleFix, startSim, stopRun, openSheet, maybeSuggestWind };

boot();
