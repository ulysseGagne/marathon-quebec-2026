// Rewrites Ulysse's data in map/index.html from the Virtual Pacer, so the map shows
// exactly where the pacer's ghost is: run `node map/tools/sync_pacer.mjs` from the repo root.
//
//   marathon  the pacer's course line (pacer/data/course.json: street centrelines, official
//             start and finish lines, official distance), from the start line to the finish
//   uplan     the ghost's clock (s) every 100 m, then at 42.195 km: the pacer's even-effort
//             plan at its default settings (target, no wind, no time at aid stations)
//   mkm       km markers at the pacer's official distances
//   zone      Plage–Voile: where the two àVélo stations project onto the course
//   mdraw     the purple line: the marathon minus the stretches it shares with the half
//
// The half-marathon (half, hkm) is left as it is.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const { Course } = await import(pathToFileURL(repo + 'pacer/js/course.js'));
const { CourseLine } = await import(pathToFileURL(repo + 'pacer/js/geo.js'));
const { DEFAULT_SETTINGS } = await import(pathToFileURL(repo + 'pacer/js/store.js'));

const course = new Course(JSON.parse(readFileSync(repo + 'pacer/data/course.json', 'utf8')));
const plan = course.plan(DEFAULT_SETTINGS);
const total = course.total;
const line = course.line;

const htmlPath = repo + 'map/index.html';
const html = readFileSync(htmlPath, 'utf8');
const RE = /^const DATA = (\{.*\});$/m;
const D = JSON.parse(html.match(RE)[1]);

const r6 = (v) => Math.round(v * 1e6) / 1e6;
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const ll = ([la, lo]) => [r6(la), r6(lo)];

const marathon = [[...ll(line.latLonAt(0)), 0]];
for (let i = 0; i < line.n; i++) {
  if (line.d[i] > 0 && line.d[i] < total) marathon.push([r6(line.lat[i]), r6(line.lon[i]), r4(line.d[i] / 1000)]);
}
marathon.push([...ll(line.latLonAt(total)), total / 1000]);

const uplan = [];
for (let d = 0; d < total; d += 100) uplan.push(Math.round(plan.timeAt(d) * 10) / 10);
uplan.push(Math.round(plan.timeAt(total) * 10) / 10);

const mkm = [];
for (let k = 1; k * 1000 < total; k++) mkm.push([k, ...ll(line.latLonAt(k * 1000))]);

const onCourse = ([la, lo], lo1, hi1) =>
  line.candidates(course.proj.x(lo), course.proj.y(la), lo1, hi1)[0].d;
const zone = { from: r4(onCourse(D.plage, 28000, 31500) / 1000), to: r4(onCourse(D.voile, 28000, 31500) / 1000) };

// Shared with the half: within 15 m of its line. Gaps under 300 m between shared stretches
// (the tunnel, where the two traces part, and the finish chute) count as shared; each purple
// stretch runs 20 m into the shared road so it meets the orange line without a gap.
const half = new CourseLine(D.half.map(([la, lo, k]) => [la, lo, k * 1000]), course.proj);
const STEP = 5;
const shared = [];
for (let d = 0; d <= total; d += STEP) {
  const [x, y] = line.xyAt(d);
  shared.push(half.nearest(x, y).r < 15);
}
const runs = [];
for (let i = 0; i < shared.length; i++) {
  const last = runs[runs.length - 1];
  if (last && last.s === shared[i]) last.b = i; else runs.push({ s: shared[i], a: i, b: i });
}
for (let j = 1; j < runs.length - 1; j++) {
  if (!runs[j].s && (runs[j].b - runs[j].a + 1) * STEP < 300) runs[j].s = true;
}
const mdraw = [];
let open = null;
for (const run of runs) {
  if (!run.s && open === null) open = run.a;
  if (run.s && open !== null) { mdraw.push([open, run.a]); open = null; }
}
if (open !== null) mdraw.push([open, shared.length - 1]);
const pieces = mdraw.map(([a, b]) =>
  line.slice(Math.max(0, a * STEP - (a ? 20 : 0)), Math.min(total, b * STEP + 20)).map(ll));

const out = Object.assign({ marathon: null, uplan: null, ...D }, { marathon, uplan, mkm, zone, mdraw: pieces });
writeFileSync(htmlPath, html.replace(RE, () => `const DATA = ${JSON.stringify(out)};`));

const fmt = (s) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.round(s % 60)).padStart(2, '0')}`;
console.log(`target ${fmt(plan.target)} · ${marathon.length} points · zone km ${zone.from}–${zone.to} ` +
  `(${fmt(plan.timeAt(zone.from * 1000))}–${fmt(plan.timeAt(zone.to * 1000))}) · purple ` +
  mdraw.map(([a, b]) => `${(a * STEP / 1000).toFixed(2)}–${(b * STEP / 1000).toFixed(2)}`).join(', '));
