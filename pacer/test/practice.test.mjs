import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Graph, Dem, practiceSpec } from '../js/practice.js';
import { Course } from '../js/course.js';
import { Tracker } from '../js/tracker.js';
import { simulate } from '../js/sim.js';
import { haversine } from '../js/geo.js';

const buf = (p) => { const b = readFileSync(new URL(p, import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const graph = new Graph(buf('../data/practice-graph.bin'));
const dem = new Dem(buf('../data/practice-dem.bin'));
const DKN = JSON.parse(readFileSync(new URL('../data/practice-dest.json', import.meta.url)));

function length(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += haversine(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]); return L; }

test('routes from Old Québec to DKN on streets, quickly', () => {
  const t = Date.now();
  const r = graph.route(46.8119, -71.2051, DKN.lat, DKN.lon);
  const ms = Date.now() - t;
  assert.ok(r && r.length > 10);
  const L = length(r);
  const crow = haversine(46.8119, -71.2051, DKN.lat, DKN.lon);
  console.log(`   Château Frontenac -> DKN: ${(L / 1000).toFixed(2)} km (crow ${(crow / 1000).toFixed(2)} km), ${r.length} pts, ${ms} ms`);
  assert.ok(L > crow && L < crow * 1.5);
  assert.ok(haversine(r[r.length - 1][0], r[r.length - 1][1], DKN.lat, DKN.lon) < 120);
});

test('routes from Limoilou and from Sainte-Foy', () => {
  for (const [la, lo, name] of [[46.8290, -71.2270, 'Limoilou'], [46.7760, -71.3050, 'Sainte-Foy west'], [46.8050, -71.2450, 'Saint-Sauveur']]) {
    const r = graph.route(la, lo, DKN.lat, DKN.lon);
    assert.ok(r, name);
    console.log(`   ${name} -> DKN: ${(length(r) / 1000).toFixed(2)} km`);
  }
});

test('DEM gives plausible heights', () => {
  const plains = dem.at(46.8030, -71.2200); // Plains of Abraham, ~90 m
  const expo = dem.at(46.8264, -71.2491);   // marathon start, ~10 m
  assert.ok(plains > 60 && plains < 110, `plains ${plains}`);
  assert.ok(expo < 20, `start ${expo}`);
});

test('an out-and-back practice run tracks through the turnaround', () => {
  const r = graph.route(46.7890, -71.2620, DKN.lat, DKN.lon);
  const spec = practiceSpec(r, dem, { outAndBack: true });
  const course = new Course(spec);
  const plan = course.plan({ target: (course.total / 1000) * 270 });
  const start = Date.UTC(2026, 8, 29, 22, 0, 0);
  const tracker = new Tracker(course, { hint: (t) => ({ d: plan.distAt((t - start) / 1000), v: 3.7, sd: 300 }), plan: () => plan });
  let maxErr = 0, n = 0;
  for (const { fix, truth, tMs } of simulate(course, plan, { seed: 5, startMs: start })) {
    if (fix) tracker.update(fix);
    const est = tracker.peek(tMs);
    if (!est || truth.t < 15) continue;
    maxErr = Math.max(maxErr, Math.abs(est.d - truth.d));
    n++;
  }
  console.log(`   out-and-back ${(course.total / 1000).toFixed(2)} km: max error ${maxErr.toFixed(1)} m over ${n} s`);
  assert.ok(maxErr < 30);
});
