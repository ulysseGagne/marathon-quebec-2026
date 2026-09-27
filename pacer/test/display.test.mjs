import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Course } from '../js/course.js';
import { Progress } from '../js/mapview.js';

const spec = JSON.parse(readFileSync(new URL('../data/course.json', import.meta.url)));
const course = new Course(spec);

test('ghost front: official distance maps onto the line-progress the map draws with', () => {
  const L = course.line;
  const P = new Progress(L.lat, L.lon, L.d);
  assert.equal(P.at(L.d0), 0);
  assert.equal(P.at(L.d1), 1);
  let prev = -1;
  for (let d = L.d0; d <= L.d1; d += 97) {
    const f = P.at(d);
    assert.ok(f >= prev, `progress must not go backwards at ${d}`);
    prev = f;
  }
  // Mercator length is proportional to ground length within a few 0.1 % over this small
  // city: the fraction and the plain distance fraction stay within ~50 m of each other.
  const span = L.d1 - L.d0;
  for (const d of [0, 5000, 10700, 21097, 36400, 42000]) {
    const plain = (d - L.d0) / span;
    assert.ok(Math.abs(P.at(d) - plain) * span < 60, `at ${d}: ${(Math.abs(P.at(d) - plain) * span).toFixed(1)} m`);
  }
  // half a metre of soft edge
  assert.ok(Math.abs(P.eps * span - 0.5) < 1e-9);
});

test('settings: old voice on/off and number-style settings migrate', async () => {
  const stored = { 'pacer.settings.v1': JSON.stringify({ voice: false, panel: 'black', target: 10700 }) };
  globalThis.localStorage = {
    getItem: (k) => (k in stored ? stored[k] : null),
    setItem: (k, v) => { stored[k] = String(v); },
    removeItem: (k) => { delete stored[k]; },
  };
  const { loadSettings } = await import('../js/store.js');
  const s = loadSettings();
  assert.equal(s.voiceEvery, 0);
  assert.equal(s.theme, 'mono');
  assert.equal(s.pocket, false);
  assert.equal(s.target, 10700);
  assert.ok(!('voice' in s) && !('panel' in s));
  stored['pacer.settings.v1'] = JSON.stringify({ voice: true });
  assert.equal(loadSettings().voiceEvery, 1000);
  delete stored['pacer.settings.v1'];
  assert.equal(loadSettings().voiceEvery, 1000);
  delete globalThis.localStorage;
});
