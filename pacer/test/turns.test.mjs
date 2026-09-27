import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Course } from '../js/course.js';
import { findTurns, turnCall, TurnCaller, CALL_AT } from '../js/turns.js';
import { lineFromLatLon, makeProjection, CourseLine } from '../js/geo.js';
import { Graph, Dem, practiceSpec, PRACTICE_ROUTES } from '../js/practice.js';

// A course drawn in metres east/north of a point, as a CourseLine
function drawn(pts) {
  const p = makeProjection(46.8, -71.2);
  const ll = pts.map(([x, y]) => [p.lat(y), p.lon(x)]);
  return new CourseLine(lineFromLatLon(ll), p);
}

// Every call along the course, walking it a metre at a time
function calls(turns, total) {
  const tc = new TurnCaller(turns);
  const out = [];
  for (let d = 0; d <= total; d += 1) { const c = tc.at(d); if (c) out.push({ d, ...c }); }
  return out;
}

test('directions: right then left 40 m later is one call; a U-turn; a road bend says nothing', () => {
  // north 300 m, right (east) 40 m, left (north) 300 m, a gentle bend, U-turn, back south
  const bend = [];
  for (let k = 1; k <= 8; k++) bend.push([40 + 60 * Math.sin((k / 8) * 0.5), 600 + 60 * k]);
  const line = drawn([[0, 0], [0, 300], [40, 300], [40, 600], ...bend, [bend[7][0] + 12, bend[7][1] + 6], [bend[7][0] + 14, bend[7][1] - 300]]);
  const turns = findTurns(line, { from: 0, min: 35 });
  const said = calls(turns, line.d1).map((c) => c.text);
  assert.deepEqual(said, ['Turn right in 50 meters, then left.', 'U-turn to the right in 50 meters.']);
  // each call 50 m before its turn
  for (const c of calls(turns, line.d1)) assert.ok(Math.abs(turns[c.first].d - c.d - CALL_AT) <= 1);
});

test('directions: the wording', () => {
  const T = (...a) => a.map(([d, angle]) => ({ d, angle }));
  assert.equal(turnCall(T([100, 90]), 0, 50).text, 'Turn right in 50 meters.');
  assert.equal(turnCall(T([100, -45]), 0, 50).text, 'Bear left in 50 meters.');
  assert.equal(turnCall(T([100, -130]), 0, 50).text, 'Turn sharp left in 50 meters.');
  assert.equal(turnCall(T([100, 170]), 0, 50).text, 'U-turn to the right in 50 meters.');
  assert.equal(turnCall(T([100, 90], [140, 90]), 0, 50).text, 'Turn right in 50 meters, then right again.');
  assert.equal(turnCall(T([100, 90], [130, -80], [170, 85], [200, 90]), 0, 50).text, 'Turn right in 50 meters, then left, then right.');
  assert.equal(turnCall(T([100, -90], [150, -170]), 0, 50).text, 'Turn left in 50 meters, then a U-turn to the left.');
  assert.equal(turnCall(T([100, 90]), 0, 23).text, 'Turn right in 20 meters.');
});

test('directions on the marathon: the real turns only, both U-turns, each said once and in time', () => {
  const c = new Course({ ...JSON.parse(readFileSync(new URL('../data/course.json', import.meta.url))), id: 'marathon' });
  const turns = findTurns(c.line, { from: 0, min: 60 });
  assert.ok(turns.length >= 45 && turns.length <= 80, `${turns.length} turns`);
  const uturns = turns.filter((t) => Math.abs(t.angle) >= 150).map((t) => +(t.d / 1000).toFixed(1));
  assert.deepEqual(uturns, [11.6, 15.2]);
  // the curving river path from km 8.2 to 10.6 is not a list of turns
  assert.equal(turns.filter((t) => t.d > 8200 && t.d < 10600).length, 0);
  const all = calls(turns, c.total);
  const covered = all.flatMap((x) => Array.from({ length: x.last - x.first + 1 }, (_, k) => x.first + k));
  assert.deepEqual(covered, turns.map((_, i) => i)); // every turn once, in order
  for (const x of all) {
    const ahead = turns[x.first].d - x.d;
    assert.ok(ahead >= 0 && ahead <= CALL_AT, `call at ${x.d} for a turn ${ahead} m ahead`);
    if (x.first > 0) assert.ok(x.d >= turns[x.first - 1].d, 'said before the turn before it was behind');
  }
  console.log(`   marathon: ${turns.length} turns in ${all.length} calls, e.g. ${all.slice(0, 3).map((x) => `km ${(x.d / 1000).toFixed(2)} “${x.text}”`).join(' ')}`);
});

test('directions on the practice routes: every corner', () => {
  const buf = (p) => { const b = readFileSync(new URL(p, import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
  const graph = new Graph(buf('../data/practice-graph.bin'));
  const dem = new Dem(buf('../data/practice-dem.bin'));
  const P = JSON.parse(readFileSync(new URL('../data/practice-places.json', import.meta.url)));
  for (const r of PRACTICE_ROUTES) {
    const spec = practiceSpec(graph.route(P[r.from].lat, P[r.from].lon, P[r.to].lat, P[r.to].lon), dem, { name: r.id });
    const c = new Course(spec);
    const turns = findTurns(c.line, { from: c.line.d0 + 5, min: 35 });
    const all = calls(turns, c.total);
    assert.ok(turns.length >= 10, `${r.id}: ${turns.length} turns`);
    assert.ok(all.every((x) => /^(Turn|Bear|U-turn)/.test(x.text)));
    console.log(`   ${r.id}: ${turns.length} turns in ${all.length} calls`);
  }
});
