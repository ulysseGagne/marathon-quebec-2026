import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { Course } from '../js/course.js';
import { Tracker } from '../js/tracker.js';
import { gapClips, spokenGap, offPaceCue } from '../js/gap.js';
import { parseKms } from '../js/store.js';
import { withStartLine, practiceSpec } from '../js/practice.js';
import { mulberry32, gauss } from '../js/sim.js';
import { raceWind, forecastUrl } from '../js/weather.js';

const spec = JSON.parse(readFileSync(new URL('../data/course.json', import.meta.url)));
const course = new Course(spec);
const voiceDir = new URL('../voice/', import.meta.url);
const clip = (id) => existsSync(new URL(`${id}.mp3`, voiceDir));

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

test('voice: every gap and cue the app says has a recorded clip', () => {
  for (let g = -599; g <= 599; g++) {
    const ids = gapClips(g);
    assert.ok(ids && ids.length, `no clips for ${g}`);
    for (const id of ids) assert.ok(clip(id), `missing voice/${id}.mp3 for ${g} (${spokenGap(g)})`);
  }
  assert.equal(gapClips(640), null); // more than 9 minutes: the iPhone voice reads it
  assert.deepEqual(gapClips(3.4), ['b3']);
  assert.deepEqual(gapClips(-1), ['a1']);
  assert.deepEqual(gapClips(0.2), ['pace']);
  assert.deepEqual(gapClips(100), ['m1', 'b40']);
  assert.deepEqual(gapClips(-120), ['m2', 'ahead']);
  // fixed cues named in the app
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const ids = new Set(['about', 'every250', 'every500', 'every1000', 'every2000']);
  for (const m of app.matchAll(/clips: \[((?:'[a-z0-9_]+'(?:, )?)+)\]/g)) {
    for (const id of m[1].split(', ')) ids.add(id.slice(1, -1));
  }
  assert.ok(ids.has('bar') || app.includes("clips.push('bar')"));
  ids.add('bar');
  for (const id of ids) assert.ok(clip(id), `missing voice/${id}.mp3`);
});

test('bars: km list typed in Settings', () => {
  assert.deepEqual(parseKms('8.1, 14.8, 24.4, 32.6', 42.195), [8.1, 14.8, 24.4, 32.6]);
  assert.deepEqual(parseKms('24,4 8,1', 42.195), [8.1, 24.4]);        // decimal commas
  assert.deepEqual(parseKms('8,14,22', 42.195), [8, 14, 22]);         // comma-separated
  assert.deepEqual(parseKms('10; 30.25 ; 50 x -3', 42.195), [10, 30.3]);
  assert.deepEqual(parseKms('', 42.195), []);
  assert.deepEqual(parseKms('15 15.0 15', 42.195), [15]);
});

test('LIVE rehearsal route: start line 30 m ahead, official distance from there', () => {
  const pts = [];
  for (let i = 0; i <= 40; i++) pts.push([46.78 + i * 0.0003, -71.28]);
  const base = practiceSpec(pts, null, { name: 'Test', outAndBack: true });
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

test('voice when off pace: quiet inside ±10 s, then 10, 15, 20…, "on pace" when back', () => {
  const st = { level: 0 };
  const said = [];
  const run = (gaps) => { for (const g of gaps) { const c = offPaceCue(st, g); if (c) said.push(c.pace ? 'pace' : c.gap); } };
  run([0, 3, -4, 6, 9, 9, 8, 9]);                 // on pace: nothing
  assert.deepEqual(said, []);
  run([10, 11, 9, 10, 12, 14]);                   // 10 behind once, no chatter around 10
  assert.deepEqual(said, [10]);
  run([15, 16, 18, 20]);                          // worse: 15, 20
  assert.deepEqual(said, [10, 15, 20]);
  run([19, 16, 14, 12]);                          // better: quiet
  assert.deepEqual(said, [10, 15, 20]);
  run([15]);                                      // wobbling back to 15: not repeated
  assert.deepEqual(said, [10, 15, 20]);
  run([11, 15]);                                  // worse again after clearly improving: said again
  assert.deepEqual(said, [10, 15, 20, 15]);
  run([11, 8, 7]);                                // back within 7 s: "on pace" once
  assert.deepEqual(said, [10, 15, 20, 15, 'pace']);
  run([5, 2, -3, -9]);                            // quiet
  run([-10, -12, -15]);                           // ahead: 10, 15 ahead
  assert.deepEqual(said, [10, 15, 20, 15, 'pace', -10, -15]);
  run([-6]);
  assert.deepEqual(said.slice(-1), ['pace']);
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
