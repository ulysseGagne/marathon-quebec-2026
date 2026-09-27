// Virtual Pacer — Marathon Beneva de Québec 2026.
// One number: seconds behind (+) or ahead (−) of a perfect even-effort run, measured
// where you are on the course.
import { Course } from './course.js';
import { Tracker } from './tracker.js';
import { GapDisplay, fmtGap, spokenGap, gapClips, offPaceCue, offPaceLevel } from './gap.js';
import { fmtClock, fmtPace } from './model.js';
import { MapView } from './mapview.js';
import { Graph, Dem, practiceSpec, withStartLine } from './practice.js';
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
  holdMsg: null,         // status line text while the menu is being held open
  offline: null, updateReady: false,
  graph: null, dem: null, dest: null,
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
  S.voice.setMix(S.settings.voiceMix !== false);
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
  startGps();
  if (typeof DeviceOrientationEvent === 'undefined' || typeof DeviceOrientationEvent.requestPermission !== 'function') {
    enableCompass(); // Android / desktop: no permission prompt
  }
  const saved = loadRun();
  if (saved && !saved.stopped && clock.now() - saved.t0 < 8 * 3600e3) {
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
  S.goSaid = false;
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
  setCompassListening(p !== 'running');
  const app = $('#app');
  app.classList.remove('phase-boot', 'phase-ready', 'phase-running');
  app.classList.add(`phase-${p}`);
  closeSheets();
  if (S.mapReady) S.map.setInteractive(p === 'ready');
  $('#btn-recenter').hidden = p !== 'ready';
  $('#btn-overview').hidden = p !== 'ready';
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
  if (!('geolocation' in navigator)) { S.gpsError = 'No GPS on this device'; renderChips(); return; }
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
  S.gpsError = null;
  handleFix({ t, lat: c.latitude, lon: c.longitude, acc: c.accuracy, speed: c.speed ?? -1, heading: c.heading });
}

function onPosError(err) {
  if (err.code === 1) S.gpsError = 'Location blocked';
  else if (err.code === 2) S.gpsError = 'No GPS signal';
  else S.gpsError = 'GPS slow';
  renderChips();
}

function handleFix(fix) {
  S.fix = fix;
  S.fixReal = Date.now();
  if (S.tracker) S.tracker.update(fix);
  if (S.free && S.phase === 'running') S.free.update(fix);
  if (S.run && S.track && !S.run.sim) {
    const est = S.tracker ? S.tracker.peek(fix.t) : S.free ? { d: S.free.d } : null;
    S.track.add(fix.t, fix.lat, fix.lon, fix.acc, est ? est.d : null);
  }
  if (S.practiceDraft && S.practiceDraft.waiting) buildPracticeRoute();
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

async function enableCompass() {
  if (S.compass) return true;
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== 'granted') return false;
    }
    S.compass = true;
    setCompassListening(S.phase !== 'running');
    renderChips();
    return true;
  } catch { return false; }
}

// The compass fires ~60 events a second. It only turns the view on the start screen; on
// the run the map turns with the course, so it is switched off there to save battery.
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
  enableCompass();
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
  const early = clock.now() < run.t0;
  if (run.rehearsal) S.voice.say('Live rehearsal. The gun is in one minute.', { clips: ['rehearsal'] });
  else if (early) S.voice.say('Live mode. Waiting for the gun.', { clips: ['live_wait'] });
  else if (run.kind === 'race') S.voice.say('Go. Pacer running.', { clips: ['go_run'] });
  else S.voice.say('Go.', { clips: ['go'] });
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
  S.voice.say('Pacer stopped.', { clips: ['stopped'] });
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
  if (S.follow && fresh && (nearStart || S.course?.id === 'practice')) {
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
  if (S.free) {
    const f = S.free.peek(now);
    if (f) { est = f; d = f.d; }
  } else if (S.tracker && S.tracker.tracking) {
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
  // LIVE rehearsal: there is no real gun, so the voice gives it
  if (r.rehearsal && !S.goSaid && el >= 0) {
    S.goSaid = true;
    if (el < 5) S.voice.say('Go!', { force: true, clips: ['go'] });
  }
  // what to say this frame: a bar, the next aid station, the gap every N metres
  const words = [], clips = [];
  const bar = barDue(d, el);
  if (bar) { words.push(bar.caf ? 'Take caffeinated bar.' : 'Take decaffeinated bar.'); clips.push(bar.caf ? 'take_caf' : 'take_decaf'); }
  const aid = waterDue(d, el);
  if (aid) { const gel = isGel(aid); words.push(gel ? 'Gel in 250 meters.' : 'Water in 250 meters.'); clips.push(gel ? 'gel250' : 'water250'); }
  const every = voiceEvery();
  if (every && d !== null && el > 0) {
    const k = Math.floor(d / every);
    if (S.lastVoiceK === null) S.lastVoiceK = k;
    else if (k > S.lastVoiceK) {
      S.lastVoiceK = k;
      // (while catching up after a pause, catchUp() speaks instead)
      if (!r.finish && el > 20 && !S.resume) {
        const g = S.gap.state().value ?? 0;
        const gc = gapClips(g);
        words.push((estimating ? 'About ' : '') + spokenGap(g));
        if (gc) clips.push(...(estimating ? ['about'] : []), ...gc); else clips.length = 0;
      }
    }
  }
  // or only when off pace: quiet within 10 s, then 10, 15, 20… s, and "on pace" when back
  const g = S.gap.state();
  if (voiceMode() === 'offpace' && d !== null && el > 30 && !r.finish && !S.resume && g.shown !== null &&
      now - (S.alertAt || 0) > 20000) {
    const cue = offPaceCue(S.alert, g.shown);
    if (cue) {
      S.alertAt = now;
      if (cue.pace) { words.push('On pace.'); clips.push('pace'); }
      else {
        const gc = gapClips(cue.gap);
        words.push((estimating ? 'About ' : '') + spokenGap(cue.gap));
        if (gc) clips.push(...(estimating ? ['about'] : []), ...gc); else clips.length = 0;
      }
    }
  }
  if (words.length && !r.finish) S.voice.say(words.join(' '), { clips: clips.length ? clips : null });
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
    if (pocket) renderPocket();
    S.lastPanel = { pocket };
  }
  if (pocket) return;
  renderRunPanel(now, el, d, est, estimating);
  if (S.mapReady) renderRunMap(now, el, d, est, dt);
}

// After iOS paused the app (screen locked, another app in front), say where you stand as
// soon as GPS has placed you on the course again.
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
    if (!S.run.finish && raw !== null) S.voice.say(spokenGap(g), { clips: gapClips(g) });
    S.alert = { level: offPaceLevel(Math.round(g)) };
  }
}

// Fuel and water on the marathon. Each bar is announced where you planned it, 1 km before
// an aid station: "Take caffeinated bar" or "Take decaffeinated bar" (about 2 min to eat
// it, 2 more to get ready). Every aid station is announced 250 m before it: "Water in 250
// meters", or "Gel in 250 meters" at the two gel stations.
const WATER_CALL = 250;

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

// the aid station you just came within 250 m of (once each)
function waterDue(d, el) {
  const aid = aidList();
  if (!aid.length || d === null || el <= 0) return null;
  const passed = aid.filter((a) => d >= a.d - WATER_CALL).length;
  if (S.lastWater === null) { S.lastWater = passed; return null; }
  if (passed > S.lastWater) { S.lastWater = passed; return aid[passed - 1]; }
  return null;
}

// Status line: "DECAF bar in 240 m", "DECAF bar now" while you eat it, "Water in 180 m"
// (or "Gel in 180 m") before each aid station, "Water: now" at it.
function fuelStatus(d) {
  if (d === null) return '';
  const m = (x) => `${Math.max(10, Math.round(x / 10) * 10)} m`;
  for (const b of barList()) {
    const to = b.km * 1000 - d, name = b.caf ? 'CAF bar' : 'DECAF bar';
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
      S.voice.say('Chip time.', { clips: ['chip'] });
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
  if (S.holdMsg && S.holdMsg.until > Date.now()) status = S.holdMsg.text;
  else if (el >= 0 && d === null && S.tracker && S.tracker.offCourse) status = `You are ${Math.round(S.tracker.offCourse)} m from the course`;
  else if (estimating) status = S.course && S.course.inTunnel(d, 30) ? 'TUNNEL · no GPS · estimating' : `No GPS for ${Math.round(est.age)} s · estimating`;
  else if (fixAge > 8 && !S.sim) status = `No GPS for ${Math.round(fixAge)} s`;
  else if (S.crossHintUntil > now && r.crossing) {
    const diff = (r.crossing - r.t0) / 1000;
    status = `Start line crossed ${Math.abs(diff).toFixed(0)} s ${diff > 0 ? 'after' : 'before'} START · hold ••• to fix`;
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
  el.style.fontSize = `${size}px`;
  const w = el.scrollWidth;
  const maxW = W * 0.95;
  if (w > maxW) { size *= maxW / w; el.style.fontSize = `${size}px`; }
}

function renderBadges(el, g) {
  const r = S.run;
  const parts = [];
  if (r.sim) parts.push('<div class="badge">SIM</div>');
  if (r.kind === 'race') {
    const mode = r.mode === 'live' ? (r.t0Source === 'chip' ? 'LIVE · CHIP' : 'LIVE · GUN') : r.t0Source === 'adjusted' ? 'START · ADJUSTED' : 'START';
    parts.push(`<div class="badge">${mode}</div>`);
    if (el > 0 && g.value !== null && S.plan) {
      const proj = S.plan.target + g.value;
      parts.push(`<div class="badge big${proj >= 3 * 3600 ? ' over' : ''}">→ ${fmtClock(proj)}</div>`);
    }
  } else if (r.kind === 'practice') {
    if (r.mode === 'live') parts.push(`<div class="badge">LIVE TEST · ${r.t0Source === 'chip' ? 'CHIP' : r.t0Source === 'gun' ? 'GUN' : 'ADJUSTED'}</div>`);
    parts.push(`<div class="badge">PRACTICE · ${fmtPace(r.practice.pace)}</div>`);
  }
  else if (r.kind === 'free') parts.push(`<div class="badge">FREE RUN · ${fmtPace(r.free.pace)}</div>`);
  const html = parts.join('');
  if (S.lastPanel.badges !== html) { $('#badges').innerHTML = html; S.lastPanel.badges = html; }
}

function renderRunMap(now, el, d, est, dt) {
  const map = S.map;
  const r = S.run;
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
      map.follow({ lat: f.pos[0], lon: f.pos[1], bearing: S.cam.bearing, zoom: S.cam.zoom });
      map.setMe(f.pos[0], f.pos[1], { travel: f.bearing });
    }
    return;
  }
  const course = S.course;
  // the ghost is the front of the bright line, with its white arrow on top
  const gd = el > 0 && S.plan ? Math.min(course.total, S.plan.distAt(el)) : course.line.d0;
  map.setGhostAt(gd);
  if (el > 0 && gd < course.total) {
    const [ga, go] = course.line.latLonAt(gd);
    map.setGhost(ga, go, course.line.bearingAt(gd, 12, 4));
  } else map.setGhost(null);
  if (d === null) {
    if (S.fix) {
      map.follow({ lat: S.fix.lat, lon: S.fix.lon, bearing: S.cam.bearing, zoom: 16, pitch: 40 });
      map.setMe(S.fix.lat, S.fix.lon);
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
  else if (S.gpsError === 'Location blocked') chips.push(chip('bad', 'Location blocked — see Help'));
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
      chips.push('<button class="chip tap" data-act="compass">Tap: turn on compass</button>');
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
  $('#scrim').addEventListener('click', () => { if (!$('#sheet-menu').hidden) return; closeSheets(); });
  $('#chips').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'compass') await enableCompass();
    if (b.dataset.act === 'wake') { const ok = await S.wake.enable(); S.needWakeTap = !ok; }
    if (b.dataset.act === 'update') applyUpdate();
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
  $('#btn-recenter').addEventListener('click', () => { S.follow = true; S.overviewShown = false; enableCompass(); });
  $('#btn-overview').addEventListener('click', () => { S.follow = false; S.map.overview(S.fix ? [S.fix.lat, S.fix.lon] : null); });
  if (S.mapReady) {
    S.map.map.on('dragstart', () => { if (S.phase === 'ready') S.follow = false; });
    S.map.map.on('click', (e) => onMapClick(e.lngLat));
  }
  bindLongPress($('#info'), MENU_HOLD_MS, openRunMenu);
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
      if (!S.sim && Date.now() - S.fixReal > 5000) startGps();
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

// Opening the run menu takes a 5-second hold on the bottom row: a bar fills across the
// row and the line above counts down. Letting go early does nothing.
const MENU_HOLD_MS = 5000;

function bindLongPress(el, ms, fn) {
  let t0 = 0, raf = 0, active = false, sx = 0, sy = 0, shown = -1;
  const run = $('#run');
  const say = (text, until) => {
    S.holdMsg = text ? { text, until } : null;
    const line = $('#status-line');
    if (text && line.textContent !== text) line.textContent = text;
    S.lastPanel.status = text || null;
  };
  const stop = (early) => {
    if (!active) return;
    active = false;
    cancelAnimationFrame(raf);
    run.classList.remove('holding');
    run.style.setProperty('--hold', 0);
    if (early) say('Hold ••• for 5 seconds to open the menu', Date.now() + 2500);
    else say(null);
  };
  el.addEventListener('pointerdown', (e) => {
    if (S.phase !== 'running' || active) return;
    active = true; t0 = performance.now(); sx = e.clientX; sy = e.clientY; shown = -1;
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    run.classList.add('holding');
    const step = () => {
      if (!active) return;
      const p = Math.min(1, (performance.now() - t0) / ms);
      run.style.setProperty('--hold', p);
      const left = Math.ceil((1 - p) * ms / 1000);
      if (left !== shown && p < 1) { shown = left; say(`Keep holding · ${left}`, Infinity); }
      if (p >= 1) { stop(false); fn(); return; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  });
  el.addEventListener('pointermove', (e) => { if (active && Math.hypot(e.clientX - sx, e.clientY - sy) > 30) stop(true); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => el.addEventListener(ev, () => stop(true)));
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
  if (name === 'help') $('#help-body').innerHTML = helpHtml(VERSION);
  if (name === 'practice') openPractice();
  $('#scrim').hidden = false;
  el.hidden = false;
}

function closeSheets() {
  $$('.sheet').forEach((s) => { s.hidden = true; });
  $('#scrim').hidden = true;
  clearTimeout(S.menuTimer);
  if (S.practiceDraft && !S.practiceDraft.picking && S.phase === 'ready') cancelPracticePreview();
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
    if (b.dataset.sync === 'crossing') setT0(r.crossing, 'chip', `Clock now starts at your crossing, ${fmtTimeOfDay(r.crossing, true)}.`);
    else { r.noAutoChip = true; setT0(r.gunMs, 'gun', `Clock now starts at the gun, ${fmtTimeOfDay(r.gunMs, true)}.`); }
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
  bindHold($('#btn-stop'), 5000, () => { closeSheets(); stopRun(); });
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
  $('#set-mix').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mix]'); if (!b) return;
    S.settings.voiceMix = b.dataset.mix === '1';
    saveSettings(S.settings);
    S.voice.setMix(S.settings.voiceMix);
    S.voice.unlock();
    S.voice.say('3 seconds behind.', { force: true, clips: ['b3'] });
    renderSettings();
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
    `Caffeine ${nCaf * 50} mg (${nCaf} CAF × 50 mg). ${nBars} bar${nBars === 1 ? '' : 's'} in all: ${nCaf} CAF, ${nBars - nCaf} DECAF.</div>`);
  return rows.join('');
}

// your bars on the map, and the one before the start at the start line
function showBars() {
  if (S.mapReady && S.course === S.marathon) S.map.setBars(S.marathon, S.settings.bars, S.settings.preBar || 'caf');
}

function pillHtml(caf) { return `<span class="pill">${caf ? 'CAF' : 'DECAF'}</span>`; }

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
  const mix = s.voiceMix !== false;
  $('#set-mix').innerHTML = `<button type="button" data-mix="1" class="${mix ? 'on' : ''}">Keeps playing</button><button type="button" data-mix="0" class="${mix ? '' : 'on'}">Pauses</button>`;
  $('#set-mix-note').textContent = mix
    ? 'A recorded voice talks over Apple Music, which keeps playing. The side switch must be on ring, not silent (on silent this voice is muted); Do Not Disturb keeps calls quiet.'
    : 'The iPhone\'s own voice: Apple Music pauses while it talks, and may not restart by itself.';
  const bars = s.bars || [];
  const barsEl = $('#set-bars');
  if (document.activeElement !== barsEl) barsEl.value = fmtBars(bars);
  $('#set-bars-list').innerHTML = fuelPlanHtml(s);
  $('#set-fuel-opts').innerHTML =
    `<div class="seg compact">${[['caf', 'CAF bar'], ['bar', 'DECAF bar'], ['none', 'Nothing']].map(([k, t]) => `<button type="button" data-pre="${k}" class="${(s.preBar || 'caf') === k ? 'on' : ''}">${t}</button>`).join('')}</div>` +
    `<div class="seg compact stack">${[['1', 'Take the race gels'], ['0', 'Skip them']].map(([k, t]) => `<button type="button" data-gels="${k}" class="${(s.raceGels !== false) === (k === '1') ? 'on' : ''}">${t}</button>`).join('')}</div>`;
  const gels = S.marathon.aid.filter((a) => a.what === 'gels').map((a) => a.km).join(' and ');
  $('#set-bars-note').textContent = `Type the km where each bar is announced, 1 km before an aid station; add “c” for a caffeinated one (21.9c). The map shows them (CAF, DECAF) and the voice says “Take caffeinated bar” or “Take decaffeinated bar” there: about 2 min to eat it, 2 to get ready. Every aid station is announced 250 m before it: “Water in 250 meters”, or “Gel in 250 meters” at km ${gels}. Spots are checked for slope, the tunnels and the station 1 km on.`;
  $('#set-bars-suggest').hidden = JSON.stringify(bars) === JSON.stringify(SUGGESTED_BARS) && (s.preBar || 'caf') === 'caf' && s.raceGels !== false;
  const vm = s.voiceMode || 'offpace';
  $('#set-voice-note').textContent = vm === 'offpace'
    ? 'Quiet while you are within 10 s of the ghost. Then it says the gap at 10, 15, 20… seconds behind or ahead as it gets worse, and “on pace” once you are back within 7 s. Also your bars (“Take caffeinated bar”) and every aid station (“Water in 250 meters”).'
    : vm === 'every'
      ? `Every ${voiceLabel(s.voiceEvery || 1000)} of official distance: “3 seconds behind”, “5 seconds ahead” or “on pace”. Also your bars and every aid station.`
      : 'No voice. (Pocket mode still speaks when off pace.)';
  $('#set-theme').innerHTML = themeButtons();
  $('#set-theme-note').textContent = THEME_NOTES[s.theme];
  $('#set-pocket').innerHTML = pocketButtons();
  $('#set-gun').textContent = fmtTimeOfDay(gunMs(), true);
  $('#about').textContent = `Version ${VERSION}${S.build ? ` · build ${S.build.slice(0, 7)}` : ''}. Map data © OpenStreetMap contributors, Overture Maps Foundation. Terrain: AWS Terrain Tiles. Voice: Piper (joe, CC0).`;
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
  S.alert = { level: offPaceLevel(S.gap.state().shown ?? 0) }; // start from where you are
  if (m === 'every') setVoiceEvery(S.settings.voiceEvery || 1000);
  else if (m === 'offpace') {
    const g = S.phase === 'running' ? S.gap.state().value : null;
    const say = g === null ? 10 : g;
    const gc = gapClips(say);
    S.voice.say(`Only when off pace. ${spokenGap(say)}.`, { force: true, clips: gc ? ['offpace', ...gc] : null });
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
    const gc = gapClips(g);
    S.voice.say(`Every ${every}. ${spokenGap(g)}.`, { force: true, clips: gc ? [`every${m}`, ...gc] : null });
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
    for (const bar of S.settings.bars || []) if (bar.km * 1000 > a && bar.km * 1000 <= b) notes.push(`${bar.caf ? 'CAF' : 'DECAF'} bar ${bar.km.toFixed(1)}`);
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

// ---- practice
function bindPractice() {
  $('#pr-dkn').addEventListener('click', () => { S.practiceDraft.dest = { ...S.dest, label: 'Pavillon Charles-De Koninck (DKN)' }; buildPracticeRoute(); });
  $('#pr-pick').addEventListener('click', () => {
    S.practiceDraft.picking = true;
    $$('.sheet').forEach((s) => { s.hidden = true; });
    $('#scrim').hidden = true;
    S.follow = false;
    toast('Tap your destination on the map', 4000);
  });
  $('#pr-return').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ret]'); if (!b) return;
    S.settings.practiceReturn = b.dataset.ret === '1'; saveSettings(S.settings); buildPracticeRoute();
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

async function openPractice() {
  if (!S.practiceDraft) S.practiceDraft = { dest: null, spec: null, picking: false, waiting: false };
  renderPracticeStatic();
  $('#pr-info').textContent = 'Loading the street map…';
  $('#pr-start').disabled = true;
  $('#pr-live').disabled = true;
  try {
    if (!S.graph) {
      const [g, d, dest] = await Promise.all([
        fetch('data/practice-graph.bin').then((r) => r.arrayBuffer()),
        fetch('data/practice-dem.bin').then((r) => r.arrayBuffer()),
        fetch('data/practice-dest.json').then((r) => r.json()),
      ]);
      S.graph = new Graph(g);
      S.dem = new Dem(d);
      S.dest = dest;
    }
  } catch (e) {
    $('#pr-info').textContent = 'Could not load the practice map. Use Free run.';
    return;
  }
  if (!S.practiceDraft.dest) S.practiceDraft.dest = { ...S.dest, label: 'Pavillon Charles-De Koninck (DKN)' };
  buildPracticeRoute();
}

function renderPracticeStatic() {
  const s = S.settings;
  $('#pr-pace').textContent = `${fmtPace(s.practicePace)} /km`;
  $('#pr-return').innerHTML = `<button type="button" data-ret="1" class="${s.practiceReturn ? 'on' : ''}">There and back</button><button type="button" data-ret="0" class="${s.practiceReturn ? '' : 'on'}">One way</button>`;
  const dr = S.practiceDraft;
  $('#pr-dest').textContent = dr && dr.dest ? dr.dest.label : 'Pavillon Charles-De Koninck (DKN)';
}

function buildPracticeRoute() {
  const dr = S.practiceDraft;
  if (!dr || !S.graph) return;
  renderPracticeStatic();
  const info = $('#pr-info');
  const startBtn = $('#pr-start');
  startBtn.disabled = true;
  $('#pr-live').disabled = true;
  if (!S.fix || Date.now() - S.fixReal > 60000) {
    dr.waiting = true;
    info.textContent = 'Waiting for your GPS position… (go outside, allow location)';
    return;
  }
  dr.waiting = false;
  const route = S.graph.route(S.fix.lat, S.fix.lon, dr.dest.lat, dr.dest.lon);
  if (!route) {
    info.textContent = 'No route from here: you may be outside the Québec City practice map. Use Free run.';
    dr.spec = null;
    return;
  }
  const spec = practiceSpec(route, S.dem, { name: `Practice to ${dr.dest.label}`, outAndBack: S.settings.practiceReturn });
  dr.spec = spec;
  const pace = S.settings.practicePace;
  const km = spec.distance / 1000;
  const climb = spec.profile.ele.reduce((acc, v, i, a) => acc + (i && v > a[i - 1] ? v - a[i - 1] : 0), 0);
  info.innerHTML = `<b>${km.toFixed(2)} km</b> ${S.settings.practiceReturn ? 'there and back' : 'one way'} · ghost ${fmtClock(km * pace)} at ${fmtPace(pace)} /km average · ${Math.round(climb)} m of climbing. The ghost uses even effort on the hills, like race day.`;
  startBtn.disabled = false;
  $('#pr-live').disabled = false;
  const course = new Course(spec);
  useCourse(course, course.plan({ target: km * pace }));
  S.follow = true;
  if (S.mapReady) S.map.overview([S.fix.lat, S.fix.lon]);
  S.overviewShown = true;
}

function cancelPracticePreview() {
  S.practiceDraft = null;
  useCourse(S.marathon, S.readyPlan);
}

function onMapClick(lngLat) {
  const dr = S.practiceDraft;
  if (!dr || !dr.picking) return;
  dr.picking = false;
  dr.dest = { lat: lngLat.lat, lon: lngLat.lng, label: 'Point on the map' };
  $('#scrim').hidden = false;
  $('#sheet-practice').hidden = false;
  buildPracticeRoute();
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
      bias: opts.bias ?? -0.005 + Math.random() * 0.009, wobble: 0.02, outlierRate: 0.01,
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

function fmtTimeOfDay(ms, seconds = false) {
  const d = new Date(ms);
  let h, m, sec;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Toronto', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(d);
    const g = (t) => Number(parts.find((p) => p.type === t).value);
    h = g('hour'); m = g('minute'); sec = g('second');
  } catch {
    h = d.getHours(); m = d.getMinutes(); sec = d.getSeconds();
  }
  const mm = String(m).padStart(2, '0');
  return seconds ? `${h}:${mm}:${String(sec).padStart(2, '0')}` : `${h}:${mm}`;
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
