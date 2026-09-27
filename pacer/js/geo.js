// Course geometry: a polyline whose vertices carry official distance (metres).
// Pure functions only, so it runs unchanged in the browser and in Node tests.

export const EARTH_R = 6371008.8;
const DEG = Math.PI / 180;

export function makeProjection(lat0, lon0) {
  const ky = EARTH_R * DEG;
  const kx = ky * Math.cos(lat0 * DEG);
  return {
    lat0, lon0, kx, ky,
    x: (lon) => (lon - lon0) * kx,
    y: (lat) => (lat - lat0) * ky,
    lat: (y) => y / ky + lat0,
    lon: (x) => x / kx + lon0,
  };
}

export function haversine(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * DEG, p2 = lat2 * DEG;
  const dp = p2 - p1, dl = (lon2 - lon1) * DEG;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Bearing in degrees clockwise from north.
export function bearingDeg(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * DEG, p2 = lat2 * DEG, dl = (lon2 - lon1) * DEG;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

export function angleDiff(a, b) {
  // signed smallest difference b - a in degrees, in (-180, 180]
  let d = ((b - a) % 360 + 540) % 360 - 180;
  return d === -180 ? 180 : d;
}

/**
 * A course line: vertices [lat, lon, d] with d strictly increasing.
 * Positions along the course are expressed in official metres d.
 */
export class CourseLine {
  constructor(line, proj) {
    const n = line.length;
    this.n = n;
    this.proj = proj || makeProjection(line[0][0], line[0][1]);
    this.lat = new Float64Array(n);
    this.lon = new Float64Array(n);
    this.x = new Float64Array(n);
    this.y = new Float64Array(n);
    this.d = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const [la, lo, d] = line[i];
      this.lat[i] = la; this.lon[i] = lo; this.d[i] = d;
      this.x[i] = this.proj.x(lo); this.y[i] = this.proj.y(la);
    }
    this.d0 = this.d[0];
    this.d1 = this.d[n - 1];
    // Segment bounding boxes, for fast spatial queries (re-acquisition anywhere on course).
    this.segCount = n - 1;
  }

  // index i such that d[i] <= d < d[i+1] (clamped)
  segAt(d) {
    const a = this.d;
    if (d <= a[0]) return 0;
    if (d >= a[this.n - 1]) return this.n - 2;
    let lo = 0, hi = this.n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (a[mid] <= d) lo = mid; else hi = mid;
    }
    return lo;
  }

  // [x, y] at official distance d (linear along each segment)
  xyAt(d) {
    const i = this.segAt(d);
    const span = this.d[i + 1] - this.d[i];
    const f = span > 0 ? Math.min(1, Math.max(0, (d - this.d[i]) / span)) : 0;
    return [this.x[i] + (this.x[i + 1] - this.x[i]) * f, this.y[i] + (this.y[i + 1] - this.y[i]) * f];
  }

  latLonAt(d) {
    const [x, y] = this.xyAt(d);
    return [this.proj.lat(y), this.proj.lon(x)];
  }

  // Bearing (deg) of the course around d, looking from d - back to d + ahead.
  bearingAt(d, ahead = 15, back = 5) {
    const a = this.latLonAt(Math.max(this.d0, d - back));
    const b = this.latLonAt(Math.min(this.d1, d + ahead));
    if (a[0] === b[0] && a[1] === b[1]) return 0;
    return bearingDeg(a[0], a[1], b[0], b[1]);
  }

  /**
   * Local minima of distance from point (px, py) to the course, restricted to
   * official distances [dLo, dHi]. Returns [{d, r}] sorted by r.
   */
  candidates(px, py, dLo, dHi) {
    const out = [];
    let i0 = this.segAt(Math.max(dLo, this.d0));
    const i1 = this.segAt(Math.min(dHi, this.d1));
    let prev = null; // {d, r, falling}
    for (let i = i0; i <= i1; i++) {
      const ax = this.x[i], ay = this.y[i];
      const bx = this.x[i + 1], by = this.y[i + 1];
      const vx = bx - ax, vy = by - ay;
      const L2 = vx * vx + vy * vy;
      let t = L2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / L2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      let d = this.d[i] + (this.d[i + 1] - this.d[i]) * t;
      if (d < dLo || d > dHi) {
        // clamp to window edge
        d = Math.min(dHi, Math.max(dLo, d));
        const [qx, qy] = this.xyAt(d);
        out.push({ d, r: Math.hypot(px - qx, py - qy), edge: true, i });
        continue;
      }
      const qx = ax + vx * t, qy = ay + vy * t;
      out.push({ d, r: Math.hypot(px - qx, py - qy), edge: false, i });
    }
    // keep local minima along the course (consecutive segments give a sequence of r)
    const minima = [];
    for (let k = 0; k < out.length; k++) {
      const c = out[k];
      const left = k > 0 ? out[k - 1].r : Infinity;
      const right = k < out.length - 1 ? out[k + 1].r : Infinity;
      if (c.r <= left && c.r <= right) {
        // merge with a minimum at nearly the same d (vertex shared by two segments)
        const last = minima[minima.length - 1];
        if (last && Math.abs(last.d - c.d) < 1 && Math.abs(last.r - c.r) < 0.5) continue;
        minima.push({ d: c.d, r: c.r });
      }
    }
    minima.sort((a, b) => a.r - b.r);
    return minima;
  }

  // Nearest point anywhere on the course (brute force, fine for occasional use).
  nearest(px, py) {
    const c = this.candidates(px, py, this.d0, this.d1);
    return c[0] || null;
  }

  // Slice of the course between two distances as [[lat, lon], ...]
  slice(dA, dB) {
    const pts = [this.latLonAt(dA)];
    const i0 = this.segAt(dA) + 1, i1 = this.segAt(dB);
    for (let i = i0; i <= i1; i++) pts.push([this.lat[i], this.lon[i]]);
    pts.push(this.latLonAt(dB));
    return pts;
  }
}

// Build a CourseLine from a plain polyline of [lat, lon] using geodesic length as d.
export function lineFromLatLon(latlon, d0 = 0) {
  const out = [];
  let d = d0;
  for (let i = 0; i < latlon.length; i++) {
    if (i > 0) {
      const step = haversine(latlon[i - 1][0], latlon[i - 1][1], latlon[i][0], latlon[i][1]);
      if (step < 0.01) continue;
      d += step;
    }
    out.push([latlon[i][0], latlon[i][1], d]);
  }
  return out;
}
