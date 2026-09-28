import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Graph, Dem, practiceSpec, PRACTICE_ROUTES, gpxTrack, practiceLine } from '../js/practice.js';
import { Course } from '../js/course.js';
import { Tracker } from '../js/tracker.js';
import { simulate } from '../js/sim.js';
import { haversine } from '../js/geo.js';

const buf = (p) => { const b = readFileSync(new URL(p, import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const graph = new Graph(buf('../data/practice-graph.bin'));
const dem = new Dem(buf('../data/practice-dem.bin'));
const PLACES = JSON.parse(readFileSync(new URL('../data/practice-places.json', import.meta.url)));
const DKN = PLACES.dkn;

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

const TRACK = gpxTrack(readFileSync(new URL('../data/practice-route.gpx', import.meta.url), 'utf8'));

test('the two practice routes: the line drawn by hand, DKN to Sommet 3V and reversed', () => {
  const lines = Object.fromEntries(PRACTICE_ROUTES.map((r) => [r.id, practiceLine(r, TRACK)]));
  assert.deepEqual(lines['home-dkn'], lines['dkn-home'].slice().reverse());
  for (const r of PRACTICE_ROUTES) {
    const pts = lines[r.id], a = PLACES[r.from], b = PLACES[r.to];
    const spec = practiceSpec(pts, dem, { name: r.id });
    // from the door of Sommet 3V, to the corner by DKN where the run starts or ends
    assert.ok(haversine(pts[0][0], pts[0][1], a.lat, a.lon) < 100, `${r.id} start`);
    assert.ok(haversine(pts[pts.length - 1][0], pts[pts.length - 1][1], b.lat, b.lon) < 100, `${r.id} end`);
    assert.ok(spec.distance > 2800 && spec.distance < 2950, `${r.id}: ${spec.distance} m`);
    console.log(`   ${a.name} -> ${b.name}: ${(spec.distance / 1000).toFixed(2)} km, ${pts.length} points`);
  }
});

test('a practice run from Sommet 3V to DKN tracks within 30 m', () => {
  const spec = practiceSpec(practiceLine(PRACTICE_ROUTES[0], TRACK), dem);
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
  console.log(`   Sommet 3V -> DKN ${(course.total / 1000).toFixed(2)} km: max error ${maxErr.toFixed(1)} m over ${n} s`);
  assert.ok(maxErr < 30);
});
