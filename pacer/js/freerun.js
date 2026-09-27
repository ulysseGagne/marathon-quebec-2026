// Free run: no route, anywhere. Distance is the smoothed GPS trail (so it drifts like any
// running app would); the ghost runs your chosen pace behind or ahead of you on that
// trail. It exists so you can feel the display and the voice on any run.
import { makeProjection, bearingDeg } from './geo.js';

export class FreeRun {
  constructor(pace) {
    this.pace = pace;
    this.d = 0;
    this.v = 0;
    this.pos = null;
    this.bearing = null;
    this.trail = [];
    this.cum = [];
    this.proj = null;
    this.sm = null;
    this.lastT = null;
  }

  update(fix) {
    if (!(fix.acc <= 35)) return;
    if (!this.proj) this.proj = makeProjection(fix.lat, fix.lon);
    const x = this.proj.x(fix.lon), y = this.proj.y(fix.lat);
    if (!this.sm) {
      this.sm = { x, y };
      this.pos = [fix.lat, fix.lon];
      this.trail.push(this.pos);
      this.cum.push(0);
      this.lastT = fix.t;
      return;
    }
    const dt = Math.max(0.2, (fix.t - this.lastT) / 1000);
    const a = Math.min(0.7, Math.max(0.25, 6 / Math.max(fix.acc, 3)));
    const nx = this.sm.x + a * (x - this.sm.x), ny = this.sm.y + a * (y - this.sm.y);
    const step = Math.hypot(nx - this.sm.x, ny - this.sm.y);
    this.lastT = fix.t;
    if (fix.speed >= 0 && fix.speed < 0.7 && step < 3) { this.v *= 0.5; return; } // standing still
    const prev = this.pos;
    this.sm = { x: nx, y: ny };
    this.pos = [this.proj.lat(ny), this.proj.lon(nx)];
    this.d += step;
    this.v = this.v * 0.7 + (step / dt) * 0.3;
    if (step > 0.5) this.bearing = bearingDeg(prev[0], prev[1], this.pos[0], this.pos[1]);
    this.trail.push(this.pos);
    this.cum.push(this.d);
  }

  peek(t) {
    if (!this.pos) return null;
    const age = (t - this.lastT) / 1000;
    const extra = age < 6 ? this.v * Math.max(0, age) : this.v * 6;
    return { d: this.d + extra, v: this.v, age, mode: age > 6 ? 'estimating' : 'gps', sd: 10 };
  }

  // Point on the trail at distance d (only behind you), or null.
  pointAt(d) {
    const c = this.cum;
    if (!c.length || d < 0 || d > this.d) return null;
    let lo = 0, hi = c.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= d) lo = m; else hi = m; }
    const f = c[hi] > c[lo] ? (d - c[lo]) / (c[hi] - c[lo]) : 0;
    const a = this.trail[lo], b = this.trail[hi];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  }
}
