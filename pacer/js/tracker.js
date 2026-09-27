// Where am I on the course? A Kalman filter on (official distance, speed) fed by GPS
// fixes snapped onto the course line.
//
// Snapping each fix to the course turns GPS error into a bounded ±5 m position error
// instead of an accumulating distance error. Once tracking, the filter only looks at
// the stretch you can plausibly have reached since the last fix, which keeps apart the
// sections the course runs twice, the Quai des Cageux hairpin and the two passes through
// Tunnel Joseph-Samson.
//
// Without GPS (tunnel), position is carried forward along the ghost's own speed profile
// (so the ghost's hills are in it), scaled by how fast you were going relative to the
// ghost over the last minute. That is far steadier than the instantaneous speed.

const Q_ACC = 0.25;         // m/s^2/sqrt(Hz): how quickly the runner's speed may change
const GEOM_SIGMA = 2.5;     // m: course geometry error
const LATERAL = 5.5;        // m: runners spread across the road around the centreline
const GATE = 30;            // Mahalanobis^2 gate for accepting a fix
const MAX_SPEED = 7.5;      // m/s
const REACQUIRE_AFTER = 20; // consecutive rejected fixes before a global search
const DR_AFTER = 3;         // s without an accepted fix before dead reckoning kicks in
const DR_SPEED_SD = 0.05;   // relative uncertainty of the dead-reckoning speed
// Off course: well away from every part of the course, on fixes good enough to say so, for
// long enough that it is not the GPS. In the city a fix can land 20-50 m off for a few
// seconds (tall buildings, the tunnels' mouths); that must not count.
const OFF_R = 40;           // m from the course, at least...
const OFF_MARGIN = 25;      // ...and this much more than the fix's own accuracy
const OFF_ACC = 30;         // m: less accurate fixes say nothing either way
const OFF_AFTER = 12000;    // ms: far that long without a break
const OFF_TUNNEL = 150;     // m: not around the tunnels (the fixes there are wild)
const BACK_R = 25;          // m: back on course within this

export class Tracker {
  /**
   * course: Course
   * hint(tMs) -> {d, v, sd} expected position (the ghost) used to (re)acquire, or null
   * plan() -> object with timeAt(d) and distAt(t) (the ghost's schedule), or null
   */
  constructor(course, { hint = null, plan = null } = {}) {
    this.course = course;
    this.line = course.line;
    this.hint = hint;
    this.plan = plan;
    this.reset();
  }

  reset() {
    this.x = null;          // [d, v] at time this.t
    this.P = null;
    this.t = null;
    this.lastFix = null;    // ms of last accepted fix
    this.fixState = null;   // {d, v, P00} right after the last accepted fix
    this.vLong = null;      // average speed over the last ~60 s of accepted fixes
    this.ratio = null;      // ghost seconds covered per real second over that span
    this.rejected = 0;
    this.history = [];      // {t, d} of accepted estimates, last 20 min
    this.offCourse = null;  // metres from the course when we cannot lock on
    this.off = null;        // {since, r} while clearly off the course (see OFF_*)
    this._farSince = null;  // first of the current run of far fixes (ms)
    this.lastRaw = null;
  }

  get tracking() { return this.x !== null; }

  // State (d, v, sd) at time t (ms) without changing the filter.
  peek(t) {
    if (!this.x) return null;
    const age = this.lastFix ? (t - this.lastFix) / 1000 : Infinity;
    if (age > DR_AFTER && this.fixState) return this._deadReckon(t, age);
    const dt = Math.max(0, (t - this.t) / 1000);
    const q2 = Q_ACC * Q_ACC;
    const P = this.P;
    const pdd = P[0][0] + 2 * dt * P[0][1] + dt * dt * P[1][1] + (q2 * dt ** 3) / 3;
    return { d: this.x[0] + this.x[1] * dt, v: this.x[1], sd: Math.sqrt(Math.max(pdd, 0)), age, mode: 'gps' };
  }

  _deadReckon(t, age) {
    const f = this.fixState;
    const plan = this.plan && this.plan();
    let d, v;
    if (plan && this.ratio !== null && f.d >= 0 && f.d < this.course.total) {
      const tg = plan.timeAt(f.d) + this.ratio * age;
      d = plan.distAt(tg);
      v = this.ratio * (plan.speedAt ? plan.speedAt(d) : this.vLong ?? f.v);
    } else {
      v = this.vLong ?? f.v;
      d = f.d + f.v * Math.min(age, DR_AFTER) + v * Math.max(0, age - DR_AFTER);
    }
    const sd = Math.sqrt(f.P00 + (DR_SPEED_SD * v * age) ** 2 + 4);
    return { d, v, sd, age, mode: 'estimating' };
  }

  _predict(t) {
    const age = this.lastFix ? (t - this.lastFix) / 1000 : 0;
    if (age > DR_AFTER && this.fixState) {
      const dr = this._deadReckon(t, age);
      this.x = [dr.d, dr.v];
      this.P = [[dr.sd * dr.sd, 0], [0, 0.35 * 0.35]];
      this.t = t;
      return;
    }
    const dt = Math.max(0, (t - this.t) / 1000);
    if (dt === 0) return;
    const [d, v] = this.x;
    const P = this.P;
    const q2 = Q_ACC * Q_ACC;
    const p00 = P[0][0] + 2 * dt * P[0][1] + dt * dt * P[1][1] + (q2 * dt ** 3) / 3;
    const p01 = P[0][1] + dt * P[1][1] + (q2 * dt * dt) / 2;
    const p11 = P[1][1] + q2 * dt;
    this.x = [d + v * dt, v];
    this.P = [[p00, p01], [p01, p11]];
    this.t = t;
  }

  _updatePos(z, R) {
    const P = this.P;
    const S = P[0][0] + R;
    const k0 = P[0][0] / S, k1 = P[0][1] / S;
    const y = z - this.x[0];
    this.x = [this.x[0] + k0 * y, this.x[1] + k1 * y];
    this.P = [[(1 - k0) * P[0][0], (1 - k0) * P[0][1]], [(1 - k0) * P[0][1], P[1][1] - k1 * P[0][1]]];
  }

  _updateSpeed(z, R) {
    const P = this.P;
    const S = P[1][1] + R;
    const k0 = P[0][1] / S, k1 = P[1][1] / S;
    const y = z - this.x[1];
    this.x = [this.x[0] + k0 * y, this.x[1] + k1 * y];
    this.P = [[P[0][0] - k0 * P[0][1], (1 - k1) * P[0][1]], [(1 - k1) * P[0][1], (1 - k1) * P[1][1]]];
  }

  _clamp() {
    this.x[1] = Math.min(MAX_SPEED, Math.max(0, this.x[1]));
    this.x[0] = Math.max(this.line.d0, Math.min(this.line.d1 + 50, this.x[0]));
  }

  _init(d, v, t, sd) {
    this.x = [d, v];
    this.P = [[sd * sd, 0], [0, 1.2 * 1.2]];
    this.t = t;
    this.rejected = 0;
    this.history = [];
    this.vLong = null;
  }

  // Global search: best course position for a fix, preferring the expected position.
  _acquire(px, py, t, sigma) {
    const cands = this.line.candidates(px, py, this.line.d0, this.line.d1)
      .filter((c) => c.r < Math.max(45, 3 * sigma));
    if (!cands.length) return null;
    const h = this.hint ? this.hint(t) : null;
    let best = null;
    for (const c of cands) {
      let cost = (c.r / Math.max(sigma, 8)) ** 2;
      if (h) cost += ((c.d - h.d) / Math.max(h.sd || 400, 150)) ** 2;
      if (!best || cost < best.cost) best = { ...c, cost };
    }
    return best;
  }

  /**
   * fix: {t (ms), lat, lon, acc (m), speed (m/s, <0 or null if unknown)}
   * returns {accepted, reason}
   */
  update(fix) {
    const { t, lat, lon } = fix;
    const acc = Number.isFinite(fix.acc) ? fix.acc : 20;
    const px = this.line.proj.x(lon), py = this.line.proj.y(lat);
    this.lastRaw = { t, px, py, acc };
    const sigma = Math.max(3, 0.7 * acc);
    this._checkOff(t, px, py, acc);

    if (!this.x || this.rejected >= REACQUIRE_AFTER) {
      if (acc > 60) return { accepted: false, reason: 'inaccurate' };
      const c = this._acquire(px, py, t, sigma);
      if (!c) {
        const near = this.line.nearest(px, py);
        this.offCourse = near ? near.r : null;
        if (this.x) this.rejected++;
        return { accepted: false, reason: 'off-course' };
      }
      const h = this.hint ? this.hint(t) : null;
      const v0 = fix.speed > 0.5 ? fix.speed : h && h.v ? h.v : 0;
      this._init(c.d, v0, t, Math.max(sigma, 10));
      this.offCourse = null;
      this._accepted(t);
      return { accepted: true, reason: 'acquired' };
    }

    const pre = this.peek(t);
    // In a tunnel the phone may still report positions from cell towers: ignore poor ones.
    if (acc > 20 && this.course.inTunnel(pre.d, 40)) return { accepted: false, reason: 'tunnel' };
    if (acc > 80) return { accepted: false, reason: 'inaccurate' };

    this._predict(t);
    const sd = Math.sqrt(this.P[0][0]);
    const back = Math.max(40, 4 * sd), ahead = Math.max(60, 4 * sd);
    const cands = this.line.candidates(px, py, this.x[0] - back, this.x[0] + ahead);
    const R = sigma * sigma + GEOM_SIGMA * GEOM_SIGMA;
    let best = null;
    for (const c of cands) {
      const rOff = Math.max(0, c.r - LATERAL);
      const m = (rOff * rOff) / R + ((c.d - this.x[0]) ** 2) / (this.P[0][0] + R);
      if (!best || m < best.m) best = { ...c, m };
    }
    if (!best || best.m > GATE) {
      this.rejected++;
      this._clamp();
      return { accepted: false, reason: 'outlier' };
    }
    this.rejected = 0;
    this._updatePos(best.d, R);
    if (fix.speed != null && fix.speed >= 0 && acc < 25) this._updateSpeed(fix.speed, 0.45 * 0.45);
    this._clamp();
    this._accepted(t);
    return { accepted: true, reason: 'ok' };
  }

  // Off course or back on it, from how far the fix is from the nearest part of the course.
  // Only once the course was found (before that, offCourse says how far it is).
  _checkOff(t, px, py, acc) {
    if (!this.x || acc > OFF_ACC) return;
    const near = this.line.nearest(px, py);
    const r = near ? near.r : Infinity;
    if (this.off) {
      this.off.r = r;
      if (r <= BACK_R) {
        this.off = null;
        this._farSince = null;
        this.rejected = REACQUIRE_AFTER; // find where you came back: anywhere on the course
      }
      return;
    }
    const nearTunnel = (near && this.course.inTunnel(near.d, OFF_TUNNEL)) || this.course.inTunnel(this.peek(t).d, OFF_TUNNEL);
    if (r > Math.max(OFF_R, acc + OFF_MARGIN) && !nearTunnel) {
      if (this._farSince === null) this._farSince = t;
      if (t - this._farSince >= OFF_AFTER) this.off = { since: this._farSince, r };
    } else this._farSince = null;
  }

  _accepted(t) {
    this.lastFix = t;
    this.fixState = { d: this.x[0], v: this.x[1], P00: this.P[0][0] };
    const h = this.history;
    h.push({ t, d: this.x[0] });
    const cut = t - 20 * 60 * 1000;
    while (h.length && h[0].t < cut) h.shift();
    // average speed over the last 45-90 s of accepted fixes
    let j = h.length - 1;
    while (j > 0 && t - h[j - 1].t <= 90000) j--;
    const span = (t - h[j].t) / 1000;
    if (span >= 45) {
      this.vLong = Math.max(0, (this.x[0] - h[j].d) / span);
      const plan = this.plan && this.plan();
      if (plan && h[j].d >= 0) {
        const r = (plan.timeAt(this.x[0]) - plan.timeAt(h[j].d)) / span;
        this.ratio = Math.min(1.6, Math.max(0, r));
      } else this.ratio = null;
    } else {
      this.vLong = null;
      this.ratio = null;
    }
  }

  // Times (ms) at which you left the line at official distance dLine for good, oldest
  // first, from the last 20 minutes of estimates. A pass counts once the estimate is 60 m
  // past the line within 90 s of leaving it: standing at the line, GPS noise moves the
  // estimate back and forth across it, and that does not count. The time is the last
  // forward crossing on the way out, interpolated between estimates; or, when the GPS had
  // put you a few metres past the line while you stood at it (so there was no crossing on
  // the way out), the moment you started moving.
  crossingsOf(dLine, afterT = -Infinity) {
    const h = this.history;
    const out = [];
    let up = null;
    for (let i = 1; i < h.length; i++) {
      const a = h[i - 1], b = h[i];
      if (a.d < dLine && b.d >= dLine) {
        const f = (dLine - a.d) / (b.d - a.d);
        up = a.t + f * (b.t - a.t);
      }
      if (a.d < dLine + 60 && b.d >= dLine + 60) {
        const s = h[this._moveStart(i)];
        let c = up;
        if (s.d >= dLine && s.d <= dLine + 12 && (c === null || c < s.t)) c = s.t;
        if (c !== null && c >= afterT && b.t - c <= 90000) out.push(c);
        up = null;
      }
    }
    return out;
  }

  // Index of the estimate where the unbroken forward movement that led to estimate i began
  // (moving means at least 2 m in 3 s).
  _moveStart(i) {
    const h = this.history;
    for (let j = i; ; j--) {
      let k = j;
      while (k > 0 && h[j].t - h[k - 1].t <= 3000) k--;
      if (k === j || h[j].d - h[k].d < 2) return j;
    }
  }

  crossingOf(dLine, afterT = -Infinity) {
    const c = this.crossingsOf(dLine, afterT);
    return c.length ? c[0] : null;
  }
}
