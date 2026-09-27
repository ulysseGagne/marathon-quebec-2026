// Even-effort pacing model.
//
// The ghost runs at constant metabolic power. On every 10 m of course, its speed v solves
//
//     P = v * ( 3.6 * C(grade) + k_air * psi(v, headwind) )        [W/kg]
//
// C(grade) is the relative energy cost of running on a slope: Minetti et al. (2002) for
// climbs, and a real-world curve for descents (Strava's 2017 model fitted on millions of
// runs finds the best descent is about -10 % and gives only ~12 % more speed there, where
// Minetti's treadmill data promises almost twice that). Air drag is ~3 % of the cost at
// 4:15/km in still air, which also stops the ghost from bombing the descents. P is solved
// so the ghost crosses the finish line exactly at the target time.

export const STEP = 10; // metres per plan cell

const K_AIR = 0.0065;     // J/kg/m per (m/s)^2 : ~3 % of flat cost at 3.9 m/s
const FLAT = 3.6;         // J/kg/m, Minetti's cost of flat running
const TAILWIND_GAIN = 0.5; // a tailwind helps about half as much as a headwind hurts

export function minetti(i) {
  return 155.4 * i ** 5 - 30.4 * i ** 4 - 43.3 * i ** 3 + 46.3 * i ** 2 + 19.5 * i + 3.6;
}

// Relative cost of running at grade g (rise/run), 1 on the flat.
export function relCost(g) {
  if (g >= 0) return minetti(Math.min(g, 0.45)) / FLAT;
  const x = Math.max(g, -0.3);
  return 1 + 2.4 * x + 12 * x * x; // minimum 0.88 at -10 %, back to 1 at -20 %
}

export function gaussianSmooth(arr, sigmaCells) {
  const n = arr.length;
  const k = Math.max(1, Math.ceil(3 * sigmaCells));
  const w = [];
  let sw = 0;
  for (let j = -k; j <= k; j++) { const v = Math.exp(-0.5 * (j / sigmaCells) ** 2); w.push(v); sw += v; }
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = -k; j <= k; j++) {
      let t = i + j;
      if (t < 0) t = -t; else if (t >= n) t = 2 * n - 2 - t;
      t = Math.min(n - 1, Math.max(0, t));
      s += arr[t] * w[j + k];
    }
    out[i] = s / sw;
  }
  return out;
}

/**
 * Per-cell inputs that do not depend on the target: grade, bearing, wind exposure,
 * extra seconds (aid stations).
 *
 * profile: {d0, step, ele[]} (elevation samples)
 * total:   course length in official metres
 * bearingAt(d) -> degrees, exposureAt(d) -> 0..1
 */
export function prepareCells({ profile, total, bearingAt = () => 0, exposureAt = () => 0, gradeSigma = 40 }) {
  const n = Math.ceil(total / STEP);
  const ele = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const d = Math.min(i * STEP, total);
    ele[i] = profileAt(profile, d);
  }
  const sm = gaussianSmooth(ele, gradeSigma / STEP);
  const len = new Float64Array(n);
  const grade = new Float64Array(n);
  const bearing = new Float64Array(n);
  const exposure = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = i * STEP, b = Math.min((i + 1) * STEP, total);
    len[i] = b - a;
    grade[i] = len[i] > 0 ? (sm[i + 1] - sm[i]) / len[i] : 0;
    const mid = (a + b) / 2;
    bearing[i] = bearingAt(mid);
    exposure[i] = exposureAt(mid);
  }
  return { n, total, len, grade, bearing, exposure, ele: sm };
}

export function profileAt(profile, d) {
  const { d0, step, ele } = profile;
  const f = (d - d0) / step;
  if (f <= 0) return ele[0];
  if (f >= ele.length - 1) return ele[ele.length - 1];
  const i = Math.floor(f);
  return ele[i] + (ele[i + 1] - ele[i]) * (f - i);
}

function aero(v, w) {
  // aerodynamic term psi = (v + w)|v + w| (damped when the wind pushes) and d psi / dv
  const a = v + w;
  const s = a * Math.abs(a);
  const still = v * v;
  if (s >= still) return [s, 2 * Math.abs(a)];
  return [still + TAILWIND_GAIN * (s - still), 2 * v + TAILWIND_GAIN * (2 * Math.abs(a) - 2 * v)];
}

// Speed at metabolic power P (W/kg) for cost coefficient c (J/kg/m) and headwind w (m/s).
export function speedFor(P, c, w, vGuess) {
  let v = vGuess > 0 ? vGuess : P / (c + K_AIR * 16);
  for (let it = 0; it < 40; it++) {
    const [ps, dps] = aero(v, w);
    const f = v * (c + K_AIR * ps) - P;
    const df = c + K_AIR * (ps + v * dps);
    let nv = v - f / df;
    if (!(nv > 0.2)) nv = Math.max(0.2, v / 2);
    if (Math.abs(nv - v) < 1e-9) return nv;
    v = nv;
  }
  return v;
}

/**
 * Build a plan: cumulative ghost time at every cell boundary.
 * opts: target (s), wind {fromDeg, kmh}, aid {seconds, km[]}
 */
export function buildPlan(cells, { target, wind = null, aid = null } = {}) {
  const { n, len, grade, bearing, exposure } = cells;
  const cost = new Float64Array(n);
  const head = new Float64Array(n);
  const extra = new Float64Array(n);
  const W = wind && wind.kmh > 0 ? wind.kmh / 3.6 : 0;
  for (let i = 0; i < n; i++) {
    cost[i] = FLAT * relCost(grade[i]);
    if (W) head[i] = W * exposure[i] * Math.cos(((wind.fromDeg - bearing[i]) * Math.PI) / 180);
  }
  if (aid && aid.seconds > 0) {
    // spread over the 60 m after each station: the ghost slows to drink
    for (const km of aid.km) {
      const i0 = Math.floor((km * 1000) / STEP);
      for (let j = 0; j < 6 && i0 + j < n; j++) extra[i0 + j] += aid.seconds / 6;
    }
  }
  const vs = new Float64Array(n);
  const timeFor = (P) => {
    let t = 0;
    for (let i = 0; i < n; i++) {
      const v = speedFor(P, cost[i], head[i], vs[i]);
      vs[i] = v;
      t += len[i] / v + extra[i];
    }
    return t;
  };
  // Solve P so that total time == target. t(P) is close to a power law, so iterate in
  // log space with a secant slope; converges in a handful of passes.
  let P = (FLAT * cells.total) / target;
  let tP = timeFor(P);
  let P0 = P * 1.05, t0 = timeFor(P0);
  for (let it = 0; it < 30 && Math.abs(tP - target) > 1e-4; it++) {
    const slope = (Math.log(tP) - Math.log(t0)) / (Math.log(P) - Math.log(P0)) || -1;
    const next = Math.exp(Math.log(P) + (Math.log(target) - Math.log(tP)) / slope);
    P0 = P; t0 = tP;
    P = Math.min(200, Math.max(0.5, next));
    tP = timeFor(P);
  }
  timeFor(P); // leave vs holding the speeds for the final P
  const T = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) T[i + 1] = T[i] + len[i] / vs[i] + extra[i];
  // remove the last sub-millisecond of solver error so the finish is exactly the target
  const k = target / T[n];
  for (let i = 0; i <= n; i++) T[i] *= k;
  for (let i = 0; i < n; i++) vs[i] /= k;
  return new Plan(cells, T, vs, P, target);
}

export class Plan {
  constructor(cells, T, v, power, target) {
    this.cells = cells;
    this.T = T;       // ghost clock (s) at each cell boundary i*STEP
    this.v = v;       // ghost speed in each cell
    this.power = power;
    this.target = target;
    this.total = cells.total;
  }

  // Ghost clock when reaching official distance d.
  timeAt(d) {
    if (d <= 0) return d / (this.v[0] || 4); // before the line: extrapolate at first-cell speed
    if (d >= this.total) return this.T[this.T.length - 1] + (d - this.total) / this.v[this.v.length - 1];
    const f = d / STEP;
    const i = Math.floor(f);
    return this.T[i] + (this.T[i + 1] - this.T[i]) * (f - i);
  }

  // Ghost position at clock t (seconds since start).
  distAt(t) {
    const T = this.T;
    if (t <= 0) return 0;
    if (t >= T[T.length - 1]) return this.total;
    let lo = 0, hi = T.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (T[mid] <= t) lo = mid; else hi = mid;
    }
    const f = (t - T[lo]) / (T[hi] - T[lo]);
    return Math.min(this.total, (lo + f) * STEP);
  }

  // Ghost pace (s/km) averaged over [d - 50, d + 50].
  paceAt(d, half = 50) {
    const a = Math.max(0, d - half), b = Math.min(this.total, d + half);
    if (b <= a) return 1000 / this.v[0];
    return ((this.timeAt(b) - this.timeAt(a)) / (b - a)) * 1000;
  }

  speedAt(d) {
    const i = Math.min(this.v.length - 1, Math.max(0, Math.floor(d / STEP)));
    return this.v[i];
  }

  // Split for kilometre k (from k-1 to k, last one to the finish).
  split(k) {
    const a = (k - 1) * 1000, b = Math.min(k * 1000, this.total);
    return this.timeAt(b) - this.timeAt(a);
  }

  // A plan that keeps this one up to (dNow, tNow) and then finishes at newTarget,
  // stretching the rest of the course proportionally (same effort distribution).
  replan(dNow, tNow, newTarget) {
    const T = this.T;
    const n = T.length - 1;
    const baseNow = this.timeAt(dNow);
    const remainingOld = T[n] - baseNow;
    const remainingNew = newTarget - tNow;
    if (remainingOld <= 0 || remainingNew <= 0) return this;
    const k = remainingNew / remainingOld;
    const T2 = new Float64Array(n + 1);
    const v2 = new Float64Array(this.v.length);
    for (let i = 0; i <= n; i++) {
      const d = i * STEP;
      T2[i] = d <= dNow ? T[i] - baseNow + tNow : tNow + (T[i] - baseNow) * k;
    }
    for (let i = 0; i < v2.length; i++) {
      v2[i] = this.cells.len[i] / Math.max(1e-6, T2[i + 1] - T2[i]);
    }
    const p = new Plan(this.cells, T2, v2, this.power, newTarget);
    p.replannedAt = { d: dNow, t: tNow };
    return p;
  }
}

export function fmtClock(sec, withHours = true) {
  const s = Math.round(sec);
  const sign = s < 0 ? '-' : '';
  const a = Math.abs(s);
  const h = Math.floor(a / 3600), m = Math.floor((a % 3600) / 60), r = a % 60;
  if (withHours || h > 0) return `${sign}${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return `${sign}${m}:${String(r).padStart(2, '0')}`;
}

export function fmtPace(secPerKm) {
  const s = Math.round(secPerKm);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
