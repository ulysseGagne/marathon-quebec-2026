import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Course } from '../js/course.js';
import { relCost, fmtClock, fmtPace } from '../js/model.js';
import { Tracker } from '../js/tracker.js';
import { GapDisplay, fmtGap, spokenGap } from '../js/gap.js';
import { simulate } from '../js/sim.js';

const spec = JSON.parse(readFileSync(new URL('../data/course.json', import.meta.url)));
const course = new Course(spec);
const TARGET = 2 * 3600 + 59 * 60 + 30;
const plan = course.plan({ target: TARGET });

test('cost curve: Minetti uphill, capped real-world downhill, continuous at 0', () => {
  assert.equal(relCost(0), 1);
  assert.ok(Math.abs(relCost(0.1) - 1.658) < 0.01);
  assert.ok(Math.abs(relCost(-0.1) - 0.88) < 1e-9);
  assert.ok(Math.abs(relCost(1e-6) - relCost(-1e-6)) < 1e-4);
  assert.ok(relCost(-0.05) < 1 && relCost(-0.05) > 0.88);
});

test('plan finishes exactly on target and is monotonic', () => {
  assert.ok(Math.abs(plan.timeAt(course.total) - TARGET) < 1e-3);
  for (let i = 1; i < plan.T.length; i++) assert.ok(plan.T[i] > plan.T[i - 1]);
  for (const t of [1, 600, 3600, 7000, 10000]) {
    assert.ok(Math.abs(plan.timeAt(plan.distAt(t)) - t) < 1e-6);
  }
});

test('plan splits look like a sub-3 marathon on this course', () => {
  const splits = [];
  for (let k = 1; k <= 42; k++) splits.push(plan.split(k));
  const flat = splits.slice(26, 40);
  for (const s of flat) assert.ok(s > 245 && s < 262, `flat split ${fmtPace(s)}`);
  // km 12-13 is the Côte Dinan / Remparts climb: clearly slower
  assert.ok(splits[12] > 290, `km 13 ${fmtPace(splits[12])}`);
  // descents towards the river are faster, but not wildly
  const fastest = Math.min(...splits);
  assert.ok(fastest > 225, `fastest split ${fmtPace(fastest)}`);
  console.log('   splits:', splits.map((s) => fmtPace(s)).join(' '));
  console.log('   flat-ground power', plan.power.toFixed(2), 'W/kg; target', fmtClock(TARGET));
});

test('wind shifts time between exposed stretches but keeps the finish', () => {
  const windy = course.plan({ target: TARGET, wind: { fromDeg: 45, kmh: 25 } });
  assert.ok(Math.abs(windy.timeAt(course.total) - TARGET) < 1e-3);
  // Boulevard Champlain (km 29-31) runs NE, straight into a NE wind: slower than still air
  const still = plan.timeAt(31000) - plan.timeAt(29000);
  const blown = windy.timeAt(31000) - windy.timeAt(29000);
  assert.ok(blown > still + 5, `headwind stretch ${still.toFixed(1)} -> ${blown.toFixed(1)}`);
});

test('aid-station seconds slow the ghost at stations, same finish', () => {
  const p = course.plan({ target: TARGET, aidSeconds: 4 });
  assert.ok(Math.abs(p.timeAt(course.total) - TARGET) < 1e-3);
  const at = (pl) => pl.timeAt(15160) - pl.timeAt(15100);
  assert.ok(at(p) > at(plan) + 3);
});

test('replan keeps the past and lands on the new target', () => {
  const p = plan.replan(30000, plan.timeAt(30000) + 45, TARGET + 90);
  assert.ok(Math.abs(p.timeAt(course.total) - (TARGET + 90)) < 1e-6);
  assert.ok(Math.abs(p.timeAt(30000) - (plan.timeAt(30000) + 45)) < 1e-6);
});

test('gap formatting and speech', () => {
  // on screen + = ahead of the ghost (in the bank), − (a real minus sign) = behind
  assert.equal(fmtGap(7.2), '−7');
  assert.equal(fmtGap(-12.6), '+13');
  assert.equal(fmtGap(0.3), '0');
  assert.equal(fmtGap(-0.4), '0');
  assert.equal(fmtGap(75), '−75');
  assert.equal(fmtGap(135), '−2:15');
  assert.equal(fmtGap(-100), '+1:40');
  assert.equal(spokenGap(3), '3 seconds behind');
  assert.equal(spokenGap(-1), '1 second ahead');
  assert.equal(spokenGap(-10), '10 seconds ahead');
  assert.equal(spokenGap(0.2), 'on pace');
  assert.equal(spokenGap(100), '1 minute 40 seconds behind');
  assert.equal(spokenGap(-121), '2 minutes 1 second ahead');
  assert.equal(spokenGap(180), '3 minutes behind');
});

function runRace({ seed, bias = 0, gpsSigma = 4, outlierRate = 0.01, preStartS = 90 }) {
  const startMs = Date.UTC(2026, 9, 4, 12, 0, 0);
  const tracker = new Tracker(course, {
    hint: (t) => ({ d: plan.distAt((t - startMs) / 1000), v: plan.speedAt(plan.distAt((t - startMs) / 1000)), sd: 400 }),
    plan: () => plan,
  });
  const gd = new GapDisplay();
  const errs = [], tunnelErrs = [], gapErrs = [];
  let lastD = null, maxJump = 0, rejected = 0, fixes = 0, crossing = null;
  for (const { fix, truth, tMs } of simulate(course, plan, { seed, bias, gpsSigma, outlierRate, preStartS, startMs })) {
    if (fix) { fixes++; if (!tracker.update(fix).accepted) rejected++; }
    if (truth.t === 150) crossing = tracker.crossingOf(0);
    const est = tracker.peek(tMs);
    if (!est || truth.t < 20) continue;
    const e = est.d - truth.d;
    if (course.inTunnel(truth.d, 30)) tunnelErrs.push(Math.abs(e)); else errs.push(e);
    if (lastD !== null) maxJump = Math.max(maxJump, Math.abs(est.d - lastD));
    lastD = est.d;
    const gapEst = (tMs - startMs) / 1000 - plan.timeAt(est.d);
    gd.push(gapEst, tMs);
    gapErrs.push(gd.state().value - truth.gap);
  }
  const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
  return {
    rms: rms(errs), max: Math.max(...errs.map(Math.abs)), tunnelMax: Math.max(0, ...tunnelErrs),
    gapRms: rms(gapErrs), gapMax: Math.max(...gapErrs.map(Math.abs)), maxJump, rejected, fixes,
    crossing,
  };
}

for (const seed of [1, 2, 3]) {
  test(`full simulated marathon, seed ${seed}: position and gap stay accurate`, () => {
    const r = runRace({ seed, bias: seed === 2 ? 0.015 : seed === 3 ? -0.01 : 0 });
    console.log(`   seed ${seed}: pos rms ${r.rms.toFixed(2)} m, max ${r.max.toFixed(1)} m, tunnel max ${r.tunnelMax.toFixed(1)} m, ` +
      `gap rms ${r.gapRms.toFixed(2)} s, gap max ${r.gapMax.toFixed(2)} s, max step ${r.maxJump.toFixed(1)} m, rejected ${r.rejected}/${r.fixes}`);
    assert.ok(r.rms < 4, `rms ${r.rms}`);
    assert.ok(r.max < 20, `max ${r.max}`);
    // 580 m without GPS: the simulated runner's pace can swing ~9 % in there (seed 1)
    assert.ok(r.tunnelMax < 45, `tunnel ${r.tunnelMax}`);
    assert.ok(r.maxJump < 45, `jump ${r.maxJump}`);
    assert.ok(r.gapRms < 1.5, `gap rms ${r.gapRms}`);
    const startMs = Date.UTC(2026, 9, 4, 12, 0, 0);
    assert.ok(r.crossing !== null && Math.abs(r.crossing - startMs) < 3000, `crossing ${r.crossing - startMs}`);
  });
}

test('noisy city GPS (8 m, 3 % outliers) still tracks', () => {
  const r = runRace({ seed: 7, gpsSigma: 8, outlierRate: 0.03 });
  console.log(`   noisy: pos rms ${r.rms.toFixed(2)} m, max ${r.max.toFixed(1)} m, gap rms ${r.gapRms.toFixed(2)} s`);
  assert.ok(r.rms < 7);
  assert.ok(r.max < 35);
  assert.ok(r.gapRms < 2.5);
});

test('re-acquires the right pass after a reload mid-race (km 36, same road as km 11)', () => {
  const startMs = Date.UTC(2026, 9, 4, 12, 0, 0);
  const t36 = plan.timeAt(35800);
  const tracker = new Tracker(course, {
    hint: (t) => ({ d: plan.distAt((t - startMs) / 1000), v: 3.9, sd: 400 }),
  });
  let got = null;
  for (const { fix, truth, tMs } of simulate(course, plan, { seed: 11, fromD: 35800, startMs: startMs + t36 * 1000, stopAt: 37200 })) {
    if (fix) tracker.update(fix);
    const est = tracker.peek(tMs);
    if (est && truth.d > 36300 && got === null) got = { est: est.d, truth: truth.d };
  }
  assert.ok(got && Math.abs(got.est - got.truth) < 30, JSON.stringify(got));
});
