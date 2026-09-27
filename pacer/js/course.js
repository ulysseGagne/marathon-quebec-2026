// A course the pacer can run: the marathon (from data/course.json) or a practice route.
import { CourseLine, makeProjection } from './geo.js';
import { prepareCells, buildPlan } from './model.js';

function runLookup(runs) {
  // runs: [[d0, d1, value], ...] sorted
  return (d) => {
    let lo = 0, hi = runs.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const r = runs[mid];
      if (d < r[0]) hi = mid - 1;
      else if (d >= r[1]) lo = mid + 1;
      else return r[2];
    }
    return undefined;
  };
}

// What the marathon's aid stations hand out besides water and Krono electrolytes (runner's
// guide 2026, p. 6). Every station has water; km 3.2 has nothing else.
const AID_EXTRAS = { 3.2: 'water only', 15.1: 'gels', 24.7: 'sponges', 27: 'gels', 37.4: 'oranges' };

export class Course {
  /**
   * spec: {
   *   id, name, distance, line: [[lat, lon, d]], racing?, profile: {d0, step, ele},
   *   tunnels?: [[d0, d1]], exposure?: [[d0, d1, f]], aid?: [{km}], names?: [[d0, d1, s]],
   *   gun?: ISO string, start_line?, finish_line?
   * }
   */
  constructor(spec) {
    this.spec = spec;
    this.id = spec.id || 'marathon';
    this.name = spec.name;
    this.total = spec.distance;
    const mid = spec.line[Math.floor(spec.line.length / 2)];
    this.proj = makeProjection(mid[0], mid[1]);
    this.line = new CourseLine(spec.line, this.proj);
    this.racing = spec.racing ? spec.racing.map(([la, lo]) => [la, lo]) : null;
    this.tunnels = spec.tunnels || [];
    this.exposureAt = spec.exposure ? (() => { const f = runLookup(spec.exposure); return (d) => f(d) ?? 0.3; })() : () => 0.3;
    this.streetAt = spec.names ? (() => { const f = runLookup(spec.names); return (d) => f(d) || ''; })() : () => '';
    this.aid = (spec.aid || []).map((a) => ({
      ...a, d: a.km * 1000, what: a.what ?? (this.id === 'marathon' ? AID_EXTRAS[a.km] || null : null),
    }));
    this.gun = spec.gun ? Date.parse(spec.gun) : null;
    this._cells = null;
    this.lookahead = null;
  }

  inTunnel(d, margin = 0) {
    for (const [a, b] of this.tunnels) if (d >= a - margin && d <= b + margin) return true;
    return false;
  }

  tunnelAhead(d) {
    for (const [a, b] of this.tunnels) if (b >= d) return [a, b];
    return null;
  }

  cells() {
    if (!this._cells) {
      this._cells = prepareCells({
        profile: this.spec.profile,
        total: this.total,
        bearingAt: (d) => this.line.bearingAt(d, 25, 25),
        exposureAt: this.exposureAt,
      });
    }
    return this._cells;
  }

  plan(opts) {
    const aid = opts.aidSeconds > 0 ? { seconds: opts.aidSeconds, km: this.aid.map((a) => a.km) } : null;
    const wind = opts.wind && opts.wind.kmh > 0 ? opts.wind : null;
    return buildPlan(this.cells(), { target: opts.target, wind, aid });
  }

  elevationAt(d) {
    const { d0, step, ele } = this.spec.profile;
    const f = (d - d0) / step;
    if (f <= 0) return ele[0];
    if (f >= ele.length - 1) return ele[ele.length - 1];
    const i = Math.floor(f);
    return ele[i] + (ele[i + 1] - ele[i]) * (f - i);
  }

  // What a spot is like to eat a bar: slope over the stretch you eat on (-200 m to +400 m),
  // tunnel, the next aid station ahead (water) and the street.
  spotAt(d) {
    const a = Math.max(0, d - 200), b = Math.min(this.total, d + 400);
    const grade = b > a ? ((this.elevationAt(b) - this.elevationAt(a)) / (b - a)) * 100 : 0;
    const water = this.aid.find((x) => x.d >= d && x.d - d <= 700) || null;
    return {
      grade, tunnel: this.inTunnel(d, 60), street: this.streetAt(d),
      water: water ? { km: water.km, m: Math.round(water.d - d) } : null,
      terrain: this.inTunnel(d, 60) ? 'in the tunnel' : grade > 1.5 ? 'uphill' : grade < -2.5 ? 'downhill' : 'flat',
    };
  }

  // Distance ahead worth showing on the map: long on straights, short before turns.
  // Precomputed every 10 m: distance to the point where the course has turned 50°
  // (cumulative) from the current heading, clamped to [220, 900] m.
  lookaheadAt(d) {
    if (!this.lookahead) this.lookahead = computeLookahead(this.line, this.total);
    const la = this.lookahead;
    const i = Math.min(la.length - 1, Math.max(0, Math.round(d / 10)));
    return la[i];
  }
}

function computeLookahead(line, total) {
  const n = Math.ceil(total / 10) + 1;
  const head = new Float64Array(n);
  for (let i = 0; i < n; i++) head[i] = line.bearingAt(i * 10, 10, 10);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let j = i;
    let maxDev = 0;
    while (j < n - 1 && (j - i) * 10 < 900) {
      j++;
      let dev = Math.abs(((head[j] - head[i]) % 360 + 540) % 360 - 180);
      maxDev = Math.max(maxDev, dev);
      if (maxDev > 50) break;
    }
    const distTurn = (j - i) * 10;
    out[i] = Math.min(900, Math.max(220, distTurn + 140));
  }
  // smooth: take a running minimum over the next 150 m (so the zoom starts coming in
  // before the turn) followed by a moving average, which avoids zoom pumping
  const m = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let v = out[i];
    for (let k = 1; k <= 15 && i + k < n; k++) v = Math.min(v, out[i + k] + k * 10);
    m[i] = v;
  }
  const s = new Float64Array(n);
  const W = 8;
  for (let i = 0; i < n; i++) {
    let acc = 0, c = 0;
    for (let k = -W; k <= W; k++) { const t = i + k; if (t >= 0 && t < n) { acc += m[t]; c++; } }
    s[i] = acc / c;
  }
  return s;
}

export async function loadMarathon(fetchJson) {
  const spec = await fetchJson('data/course.json');
  spec.id = 'marathon';
  return new Course(spec);
}
