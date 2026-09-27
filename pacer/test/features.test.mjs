import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Course } from '../js/course.js';
import { Tracker } from '../js/tracker.js';
import { spokenGap, offPaceCue, offPaceConfig } from '../js/gap.js';
import { parseBars, fmtBars, SUGGESTED_BARS } from '../js/store.js';
import { withStartLine, practiceSpec } from '../js/practice.js';
import { mulberry32, gauss, simulate } from '../js/sim.js';
import { raceWind, forecastUrl } from '../js/weather.js';

const spec = JSON.parse(readFileSync(new URL('../data/course.json', import.meta.url)));
const course = new Course(spec);

test('start line: the crossing that led somewhere, not GPS noise while standing at the line', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const tr = new Tracker(course);
    const rnd = mulberry32(seed);
    const t0 = 1.79e12;
    // standing 2 m behind the line for a minute: the estimate wobbles across it
    for (let s = 0; s < 60; s++) tr.history.push({ t: t0 + s * 1000, d: -2 + 3 * gauss(rnd) });
    // the gun: running at 4 m/s, really crossing at t0 + 60.5 s
    for (let s = 0; s <= 40; s++) tr.history.push({ t: t0 + 60000 + s * 1000, d: -2 + 4 * s + 0.8 * gauss(rnd) });
    const all = tr.crossingsOf(0);
    assert.equal(all.length, 1, `seed ${seed}: one crossing, got ${all.length}`);
    assert.ok(Math.abs(all[0] - (t0 + 60500)) < 1500, `seed ${seed}: off by ${((all[0] - t0 - 60500) / 1000).toFixed(1)} s`);
  }
});

test('start line: standing right at the line for 10 minutes, GPS putting you just past it', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const tr = new Tracker(course);
    const rnd = mulberry32(seed);
    let t = 1.79e12;
    const add = (d) => { tr.history.push({ t, d }); t += 1000; };
    // walk up to the line, then stand 1 m behind it for 10 minutes; the GPS puts you about
    // 3 m further on, drifting, so the estimate sits past the line and wobbles
    let bias = 3;
    for (let s = 0; s < 20; s++) add(-40 + 2 * s + bias + 0.8 * gauss(rnd));
    for (let s = 0; s < 600; s++) { bias = Math.max(1, Math.min(5, bias + 0.1 * gauss(rnd))); add(-1 + bias + 1.2 * gauss(rnd)); }
    // the gun: from a standstill, speeding up to 4 m/s; really crossing ~0.35 s before `go`
    const go = t;
    let d = -1, v = 0;
    for (let s = 0; s < 40; s++) { v = Math.min(4, v + 1.5); d += v; add(d + bias + 0.8 * gauss(rnd)); }
    const truth = go - 330;
    const all = tr.crossingsOf(0, go - 30000);
    assert.equal(all.length, 1, `seed ${seed}: ${all.length} crossings`);
    assert.ok(Math.abs(all[0] - truth) < 2000, `seed ${seed}: off by ${((all[0] - truth) / 1000).toFixed(1)} s`);
  }
});

test('start line: a warm-up stride across the line and back is a separate pass', () => {
  const tr = new Tracker(course);
  const t0 = 1.79e12;
  let t = t0;
  const add = (d) => { tr.history.push({ t, d }); t += 1000; };
  for (let s = 0; s < 10; s++) add(-20);
  for (let s = 0; s < 25; s++) add(-20 + 4 * s);   // stride out to +76 m
  for (let s = 0; s < 25; s++) add(76 - 4 * s);    // and back behind the line
  for (let s = 0; s < 30; s++) add(-24);
  const gunT = t;
  for (let s = 0; s < 40; s++) add(-24 + 4 * s);   // the real start
  const all = tr.crossingsOf(0);
  assert.equal(all.length, 2);
  assert.ok(Math.abs(all[1] - (gunT + 6000)) < 1100);
  assert.equal(tr.crossingOf(0, gunT - 30000), all[1]);
});

test('voice: the bar and aid-station calls, spoken in full', () => {
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  for (const phrase of ['Take caffeinated bar.', 'Take regular bar.', 'Water in 200 meters.', 'Gel in 200 meters.', 'On pace.']) {
    assert.ok(app.includes(`'${phrase}'`), phrase);
  }
  assert.ok(!/decaf/i.test(app), 'no more "decaffeinated" or DECAF');
  assert.ok(!/clips/.test(app), 'no recorded clips left');
});

test('bars: km list typed in Settings, c for caffeine', () => {
  const B = (km, caf = false) => ({ km, caf });
  assert.deepEqual(parseBars('8.1, 22.6c, 32.6c', 42.195), [B(8.1), B(22.6, true), B(32.6, true)]);
  assert.deepEqual(parseBars('24,4 8,1c', 42.195), [B(8.1, true), B(24.4)]);   // decimal commas
  assert.deepEqual(parseBars('8,14C,22', 42.195), [B(8), B(14, true), B(22)]);   // comma-separated
  assert.deepEqual(parseBars('10; 30.25 ; 50 x -3', 42.195), [B(10), B(30.3)]);
  assert.deepEqual(parseBars('', 42.195), []);
  assert.deepEqual(parseBars('15 15.0 15c', 42.195), [B(15, true)]);
  assert.equal(fmtBars([B(8.1), B(22.6, true)]), '8.1, 22.6c');
});

test('LIVE rehearsal route: start line 30 m ahead, official distance from there', () => {
  const pts = [];
  for (let i = 0; i <= 40; i++) pts.push([46.78 + i * 0.0003, -71.28]);
  const base = practiceSpec(pts, null, { name: 'Test' });
  const r = withStartLine(base, 30);
  assert.equal(r.line[0][2], -30);
  assert.ok(Math.abs(r.distance - (base.distance - 30)) < 0.2);
  assert.equal(r.profile.d0, -30);
  const c = new Course(r);
  assert.equal(c.line.d0, -30);
  assert.ok(Math.abs(c.total - r.distance) < 1e-9);
  const p = c.plan({ target: (r.distance / 1000) * 255 });
  assert.ok(Math.abs(p.timeAt(c.total) - (r.distance / 1000) * 255) < 1e-6);
});

test('voice when off pace, from 5 s (default): "on pace" only right after a warning', () => {
  const st = { level: 0 };
  const said = [];
  const run = (gaps) => { for (const g of gaps) { const c = offPaceCue(st, g); if (c) said.push(c.pace ? 'pace' : c.gap); } };
  run([0, 2, -3, 4, -4, 1, 0]);                   // inside ±5 s: nothing
  assert.deepEqual(said, []);
  run([-3, -5, -4, -2, 0]);                       // 5 ahead, then back on the ghost: on pace
  assert.deepEqual(said, [-5, 'pace']);
  run([-1, -2, -1, 0, 1, 0]);                     // 2 ahead and back: nothing (no warning before)
  assert.deepEqual(said, [-5, 'pace']);
  run([3, 5, 8, 10, 12, 9, 5, 3, 1, 0]);          // behind: 5, 10, back to 5, on pace
  assert.deepEqual(said, [-5, 'pace', 5, 10, 5, 'pace']);
  run([3, 5, 4, 5, 4, 6]);                        // wobbling around 5: said once
  assert.deepEqual(said.slice(-1), [5]);
  run([3, 1, 3, 5]);                              // well back in (1 s), out again: warned again
  run([2, -1]);                                   // went past the ghost: on pace
  assert.deepEqual(said.slice(-3), [5, 5, 'pace']);
});

test('voice when off pace, from 10 s: each step both ways, "on pace" at the ghost', () => {
  const st = { level: 0 };
  const said = [];
  const cfg = offPaceConfig(10);
  const run = (gaps) => { for (const g of gaps) { const c = offPaceCue(st, g, cfg); if (c) said.push(c.pace ? 'pace' : c.gap); } };
  run([0, 3, -4, 6, 9, 9, 8, 9, 1, 0]);           // no warning yet: nothing, not even "on pace"
  assert.deepEqual(said, []);
  run([10, 11, 9, 10, 12, 14]);                   // 10 behind once, no chatter around 10
  assert.deepEqual(said, [10]);
  run([15, 16, 18, 20, 23, 25]);                  // worse: 15, 20, 25
  run([24, 22, 20, 19, 16, 15]);                  // better: 20, 15
  run([16, 15, 14, 15, 16, 19]);                  // wobbling around 15: not repeated
  run([13, 11, 10]);                              // better: 10
  assert.deepEqual(said, [10, 15, 20, 25, 20, 15, 10]);
  run([9, 8, 10, 9, 6, 4, 2, 1]);                 // inside: nothing yet
  assert.deepEqual(said.slice(-1), [10]);
  run([0]);                                       // met the ghost: on pace
  run([1, 0, -1, 3, 6, 9]);                       // after that: nothing
  assert.deepEqual(said.slice(-2), [10, 'pace']);
  said.length = 0;
  run([10, 8, 5, 3, 6, 9, 10]);                   // back to 3, out again: warned again
  run([7, 4, 2, 1, -1]);                          // went past the ghost (1 to -1): on pace
  assert.deepEqual(said, [10, 10, 'pace']);
  said.length = 0;
  run([-6, -9, -10, -12, -15, -20, -22, -20, -16, -15, -11, -10, -8, -3, 0]); // ahead, both ways
  assert.deepEqual(said, [-10, -15, -20, -15, -10, 'pace']);
  said.length = 0;
  run([2, 31, -30]);                              // a jump (after a pause): the gap itself
  assert.deepEqual(said, [31, -30]);
});

test('voice when off pace: the ladder 5 … 30, 45, 1 min, 90 s, 2 … 5 min, both ways, nothing past 5 min', () => {
  for (const sign of [1, -1]) {
    const st = { level: 0 };
    const said = [];
    const run = (gaps) => { for (const g of gaps) { const c = offPaceCue(st, sign * g); if (c) said.push(c.pace ? 'pace' : sign * c.gap); } };
    const up = [], down = [];
    for (let g = 0; g <= 420; g++) up.push(g);
    for (let g = 420; g >= 0; g--) down.push(g);
    run(up);
    assert.deepEqual(said, [5, 10, 15, 20, 25, 30, 45, 60, 90, 120, 180, 240, 300]);
    said.length = 0;
    run(down);
    assert.deepEqual(said, [240, 180, 120, 90, 60, 45, 30, 25, 20, 15, 10, 5, 'pace']);
    said.length = 0;
    run([30, 40, 44, 40, 31, 35, 44]);               // between 30 and 45: nothing after "30"
    assert.deepEqual(said, [30]);
    run([45, 40, 31, 30]);                           // 45, then back to 30
    assert.deepEqual(said, [30, 45, 30]);
  }
  // from 10 s: the same ladder from 10
  const st = { level: 0 };
  const said = [];
  for (let g = 0; g <= 100; g++) { const c = offPaceCue(st, g, offPaceConfig(10)); if (c) said.push(c.gap); }
  assert.deepEqual(said, [10, 15, 20, 25, 30, 45, 60, 90]);
});

// Runs a simulated race through a tracker; returns when "off course" came and went (s).
function offRun(c, opts) {
  const plan = c.plan({ target: (c.total / 1000) * 255 });
  const start = Date.UTC(2026, 9, 4, 12, 0, 0);
  const tr = new Tracker(c, { hint: (t) => ({ d: plan.distAt(Math.max(0, (t - start) / 1000)), v: 4, sd: 300 }), plan: () => plan });
  const spans = [];
  let on = null, maxR = 0, errAfter = 0;
  for (const { fix, truth, tMs } of simulate(c, plan, { startMs: start, ...opts })) {
    if (fix) tr.update(fix);
    if (tr.off && on === null) on = truth.t;
    if (tr.off) maxR = Math.max(maxR, tr.off.r);
    if (!tr.off && on !== null) { spans.push([on, truth.t]); on = null; }
    if (opts.checkAfter && truth.d > opts.checkAfter && tr.tracking && !tr.off) errAfter = Math.max(errAfter, Math.abs(tr.peek(tMs).d - truth.d));
  }
  if (on !== null) spans.push([on, Infinity]);
  return { spans, maxR, errAfter };
}

test('off course: never on a normal marathon (tunnels, stray fixes, a poorer GPS)', () => {
  for (const [seed, gpsSigma, outlierRate] of [[1, 4, 0.01], [2, 4, 0.03], [3, 8, 0.02], [4, 10, 0.01]]) {
    const { spans } = offRun(course, { seed, gpsSigma, outlierRate });
    assert.deepEqual(spans, [], `seed ${seed} (GPS ±${gpsSigma} m): off course at ${JSON.stringify(spans)}`);
  }
});

test('off course: a wrong turn 90 m off is caught in ~15 s; a street 30 m off is not', () => {
  const c = new Course(withStartLine(practiceSpec(Array.from({ length: 81 }, (_, i) => [46.77 + i * 0.0004, -71.30 + 0.002 * Math.sin(i / 8)]), null, { name: 'T' }), 0));
  const wrong = offRun(c, { seed: 3, detour: { from: 1000, to: 1800, off: 90 }, checkAfter: 1900 });
  assert.equal(wrong.spans.length, 1, JSON.stringify(wrong.spans));
  const [a, b] = wrong.spans[0];
  // 40 m out is reached ~12 s after leaving at km 1 (4 m/s): flagged 12 s after that
  const out = 1000 / 4;
  console.log(`   90 m detour: off course from ${(a - out).toFixed(0)} s after the turn, back ${(b - 1800 / 4).toFixed(0)} s after rejoining, max ${wrong.maxR.toFixed(0)} m; then within ${wrong.errAfter.toFixed(0)} m`);
  assert.ok(a - out > 10 && a - out < 30, `flagged ${a - out} s after the turn`);
  assert.ok(b - 1800 / 4 < 15 && b - 1800 / 4 > -15);
  assert.ok(wrong.maxR > 75 && wrong.maxR < 110);
  assert.ok(wrong.errAfter < 30, `after rejoining: ${wrong.errAfter} m`);
  const near = offRun(c, { seed: 4, detour: { from: 1000, to: 1800, off: 30 } });
  assert.deepEqual(near.spans, []);
});

test('wind forecast: race hours averaged, direction averaged as vectors (north wraps)', () => {
  const hourly = { time: [], wind_speed_10m: [], wind_direction_10m: [], wind_gusts_10m: [] };
  for (let h = 0; h < 24; h++) {
    const race = h >= 8 && h <= 11;
    hourly.time.push(`2026-10-04T${String(h).padStart(2, '0')}:00`);
    hourly.wind_speed_10m.push(race ? [12, 14, 16, 18][h - 8] : 40);
    hourly.wind_direction_10m.push(race ? [350, 10, 20, 0][h - 8] : 180);
    hourly.wind_gusts_10m.push(race ? 25 + h : 60);
  }
  const w = raceWind({ hourly });
  assert.ok(Math.abs(w.kmh - 15) < 1e-9);
  assert.ok(w.fromDeg < 10 || w.fromDeg > 355, `from ${w.fromDeg}`);
  assert.equal(w.dir8, 0);
  assert.equal(w.gust, 36);
  assert.equal(raceWind({}), null);
  assert.equal(raceWind({ hourly: { time: ['2026-10-04T03:00'], wind_speed_10m: [5], wind_direction_10m: [90] } }), null);
  const u = forecastUrl(46.8, -71.22, '2026-10-04');
  assert.ok(u.startsWith('https://api.open-meteo.com/v1/forecast?'));
  for (const part of ['start_date=2026-10-04', 'end_date=2026-10-04', 'wind_speed_10m', 'wind_direction_10m', 'wind_speed_unit=kmh', 'timezone=America%2FToronto']) {
    assert.ok(u.includes(part), part);
  }
});

test('fuel: each suggested bar is 1 km before water, on easy ground, and fits around the gels', () => {
  const plan = course.plan({ target: 10770 });
  const gels = course.aid.filter((a) => a.what === 'gels').map((a) => a.km);
  assert.deepEqual(gels, [15.1, 27]);
  for (const b of SUGGESTED_BARS) {
    const sp = course.spotAt(b.km * 1000);
    // announced exactly 1 km before an aid station that is not a gel station
    assert.ok(sp.water && Math.abs(sp.water.m - 1000) <= 50, `km ${b.km}: water ${JSON.stringify(sp.water)}`);
    assert.ok(!gels.includes(sp.water.km), `km ${b.km}: bar right before a gel`);
    assert.ok(['flat', 'gentle downhill'].includes(sp.terrain), `km ${b.km}: ${sp.terrain} ${sp.grade.toFixed(1)} %`);
    assert.ok(!sp.tunnel, `km ${b.km}: tunnel while eating`);
    assert.ok(plan.timeAt(b.km * 1000) < 2 * 3600 + 20 * 60, `km ${b.km}: too late to help`);
  }
  // bar, bar, gel, bar, gel, bar: a fuel stop every 15-35 min
  const stops = SUGGESTED_BARS.map((b) => ({ km: b.km, bar: true })).concat(gels.map((km) => ({ km, bar: false }))).sort((a, b) => a.km - b.km);
  assert.deepEqual(stops.map((x) => x.bar), [true, true, false, true, false, true]);
  for (let i = 1; i < stops.length; i++) {
    const min = (plan.timeAt(stops[i].km * 1000) - plan.timeAt(stops[i - 1].km * 1000)) / 60;
    assert.ok(min >= 15 && min <= 35, `${stops[i - 1].km} -> ${stops[i].km}: ${min.toFixed(0)} min`);
  }
  // about 50 g of carbs an hour in the race (25 g per bar or gel)
  const perHour = ((SUGGESTED_BARS.length + gels.length) * 25) / (plan.timeAt(course.total) / 3600);
  assert.ok(perHour >= 45 && perHour <= 60, `${perHour.toFixed(0)} g/h`);
  // caffeine: before the start plus two bars in the second half; 3 CAF + 2 REG of 6 bars
  assert.equal(SUGGESTED_BARS.filter((b) => b.caf).length, 2);
  assert.ok(SUGGESTED_BARS.filter((b) => b.caf).every((b) => b.km > 21));
  assert.equal(SUGGESTED_BARS.filter((b) => !b.caf).length, 2);
  // and the spots it warns about
  assert.equal(course.spotAt(10500).terrain, 'in the tunnel');
  assert.equal(course.spotAt(12100).terrain, 'uphill');
  assert.equal(course.spotAt(14500).terrain, 'uphill');
  assert.equal(course.spotAt(14100).water.km, 15.1);        // 1 km before a gel station
  assert.equal(course.spotAt(21900).terrain, 'gentle downhill'); // -3.9 %: fine to chew on
  assert.equal(course.spotAt(25000).terrain, 'steep downhill');  // down to the river
  assert.ok(Math.abs(course.spotAt(21900).water.m - 1000) < 1);
});

test('bars: earlier suggestions move to the new plan, your own list stays', async () => {
  const stored = {};
  globalThis.localStorage = {
    getItem: (k) => (k in stored ? stored[k] : null), setItem: (k, v) => { stored[k] = String(v); }, removeItem: (k) => { delete stored[k]; },
  };
  const { loadSettings } = await import('../js/store.js');
  const lastPlan = [{ km: 8.1, caf: false }, { km: 22.6, caf: true }, { km: 32.6, caf: true }];
  for (const old of [[8.1, 14.8, 24.4, 32.6], [8.1, 19, 26.7, 32.6], lastPlan]) {
    stored['pacer.settings.v1'] = JSON.stringify({ bars: old });
    assert.deepEqual(loadSettings().bars, SUGGESTED_BARS);
  }
  stored['pacer.settings.v1'] = JSON.stringify({ bars: [10, 20, 30] });
  assert.deepEqual(loadSettings().bars, [{ km: 10, caf: false }, { km: 20, caf: false }, { km: 30, caf: false }]);
  stored['pacer.settings.v1'] = JSON.stringify({ bars: [{ km: 12, caf: true }] });
  assert.deepEqual(loadSettings().bars, [{ km: 12, caf: true }]);
  delete stored['pacer.settings.v1'];
  const d = loadSettings();
  assert.equal(d.preBar, 'caf');
  assert.equal(d.raceGels, true);
  delete globalThis.localStorage;
});

test('every name app.js imports is exported by its module', async () => {
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  let checked = 0;
  for (const m of app.matchAll(/import \{([^}]+)\} from '(\.\/[a-z]+\.js)'/g)) {
    const mod = await import(new URL(`../js/${m[2].slice(2)}`, import.meta.url));
    for (const name of m[1].split(',').map((x) => x.trim()).filter(Boolean)) {
      assert.ok(name in mod, `${m[2]} does not export ${name}`);
      checked++;
    }
  }
  assert.ok(checked > 30, `only ${checked} imports checked`);
});
