// Practice mode: route from wherever you are to Pavillon Charles-De Koninck (or any point
// you tap), on a bundled street graph of Québec City, fully offline. The route becomes a
// course like the marathon: same tracker, same ghost, same even-effort pacing.
import { haversine, lineFromLatLon } from './geo.js';
import { gaussianSmooth } from './model.js';

export class Graph {
  constructor(buf) {
    const dv = new DataView(buf);
    const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
    if (magic !== 'PGR1') throw new Error('bad graph file');
    const n = dv.getUint32(4, true), e = dv.getUint32(8, true), p = dv.getUint32(12, true);
    let o = 16;
    const i32 = (count) => { const a = new Int32Array(buf, o, count); o += count * 4; return a; };
    const u32 = (count) => { const a = new Uint32Array(buf, o, count); o += count * 4; return a; };
    const f32 = (count) => { const a = new Float32Array(buf, o, count); o += count * 4; return a; };
    this.n = n; this.e = e;
    this.nLat = i32(n); this.nLon = i32(n);
    this.from = u32(e); this.to = u32(e); this.pt0 = u32(e);
    this.len = f32(e); this.cost = f32(e);
    this.ptN = new Uint16Array(buf, o, e); o += e * 2; if (e % 2) o += 2;
    this.pLat = i32(p); this.pLon = i32(p);
    // CSR adjacency
    const deg = new Uint32Array(n + 1);
    for (let k = 0; k < e; k++) { deg[this.from[k] + 1]++; deg[this.to[k] + 1]++; }
    for (let k = 0; k < n; k++) deg[k + 1] += deg[k];
    this.adjStart = deg;
    this.adjEdge = new Uint32Array(2 * e);
    const fill = deg.slice(0, n);
    for (let k = 0; k < e; k++) {
      this.adjEdge[fill[this.from[k]]++] = k;
      this.adjEdge[fill[this.to[k]]++] = k;
    }
    this._buildIndex();
  }

  lat(i) { return this.nLat[i] / 1e6; }
  lon(i) { return this.nLon[i] / 1e6; }

  // Edge geometry from node `a` (one of its ends) to the other end: [[lat, lon], ...]
  edgeCoords(k, fromNode = this.from[k]) {
    const pts = [[this.lat(this.from[k]), this.lon(this.from[k])]];
    const s = this.pt0[k];
    for (let j = 0; j < this.ptN[k]; j++) pts.push([this.pLat[s + j] / 1e6, this.pLon[s + j] / 1e6]);
    pts.push([this.lat(this.to[k]), this.lon(this.to[k])]);
    return fromNode === this.from[k] ? pts : pts.reverse();
  }

  _buildIndex() {
    // grid of ~250 m cells over edge bounding boxes
    this.cell = 0.0025;
    this.index = new Map();
    for (let k = 0; k < this.e; k++) {
      const c = this.edgeCoords(k);
      let a = Infinity, b = -Infinity, cc = Infinity, d = -Infinity;
      for (const [la, lo] of c) { a = Math.min(a, la); b = Math.max(b, la); cc = Math.min(cc, lo); d = Math.max(d, lo); }
      for (let y = Math.floor(a / this.cell); y <= Math.floor(b / this.cell); y++) {
        for (let x = Math.floor(cc / this.cell); x <= Math.floor(d / this.cell); x++) {
          const key = y * 100000 + x;
          let arr = this.index.get(key);
          if (!arr) this.index.set(key, (arr = []));
          arr.push(k);
        }
      }
    }
  }

  // Nearest point on the graph: {edge, dist, lat, lon, along (m from edge.from)}
  nearest(lat, lon, maxM = 400) {
    const kx = 111195 * Math.cos((lat * Math.PI) / 180), ky = 111195;
    let best = null;
    const r = Math.ceil(maxM / 111195 / this.cell) + 1;
    const cy = Math.floor(lat / this.cell), cx = Math.floor(lon / this.cell);
    const seen = new Set();
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        const arr = this.index.get(y * 100000 + x);
        if (!arr) continue;
        for (const k of arr) {
          if (seen.has(k)) continue;
          seen.add(k);
          const c = this.edgeCoords(k);
          let acc = 0;
          for (let j = 0; j < c.length - 1; j++) {
            const ax = (c[j][1] - lon) * kx, ay = (c[j][0] - lat) * ky;
            const bx = (c[j + 1][1] - lon) * kx, by = (c[j + 1][0] - lat) * ky;
            const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy;
            let t = L2 > 0 ? -(ax * vx + ay * vy) / L2 : 0;
            t = Math.max(0, Math.min(1, t));
            const px = ax + vx * t, py = ay + vy * t;
            const dist = Math.hypot(px, py);
            const segL = Math.sqrt(L2);
            if (!best || dist < best.dist) {
              best = { edge: k, dist, lat: lat + py / ky, lon: lon + px / kx, along: acc + t * segL, seg: j, t };
            }
            acc += segL;
          }
        }
      }
    }
    if (best) {
      // scale "along" to the edge's true length
      const geomLen = this._geomLen(best.edge);
      best.along = geomLen > 0 ? (best.along / geomLen) * this.len[best.edge] : 0;
    }
    return best && best.dist <= maxM ? best : null;
  }

  _geomLen(k) {
    const c = this.edgeCoords(k);
    let L = 0;
    for (let j = 0; j < c.length - 1; j++) L += haversine(c[j][0], c[j][1], c[j + 1][0], c[j + 1][1]);
    return L;
  }

  /**
   * Shortest runnable route between two points. Returns [[lat, lon], ...] or null.
   */
  route(aLat, aLon, bLat, bLon) {
    const A = this.nearest(aLat, aLon), B = this.nearest(bLat, bLon);
    if (!A || !B) return null;
    if (A.edge === B.edge) {
      return this._partial(A.edge, A, B);
    }
    const n = this.n;
    const g = new Float64Array(n).fill(Infinity);
    const prevEdge = new Int32Array(n).fill(-1);
    const prevNode = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const heap = new MinHeap();
    const h = (i) => haversine(this.lat(i), this.lon(i), B.lat, B.lon);
    const eA = A.edge;
    const costPerM = (k) => this.cost[k] / Math.max(this.len[k], 1e-6);
    // virtual start: both ends of A's edge
    const s1 = this.from[eA], s2 = this.to[eA];
    g[s1] = A.along * costPerM(eA);
    g[s2] = (this.len[eA] - A.along) * costPerM(eA);
    heap.push(s1, g[s1] + h(s1));
    heap.push(s2, g[s2] + h(s2));
    const eB = B.edge;
    const t1 = this.from[eB], t2 = this.to[eB];
    const endCost = (node) => (node === t1 ? B.along : this.len[eB] - B.along) * costPerM(eB);
    let bestEnd = null, bestTotal = Infinity;
    while (heap.size) {
      const [u, f] = heap.pop();
      if (closed[u]) continue;
      if (f >= bestTotal) break;
      closed[u] = 1;
      if (u === t1 || u === t2) {
        const tot = g[u] + endCost(u);
        if (tot < bestTotal) { bestTotal = tot; bestEnd = u; }
      }
      for (let j = this.adjStart[u]; j < this.adjStart[u + 1]; j++) {
        const k = this.adjEdge[j];
        const v = this.from[k] === u ? this.to[k] : this.from[k];
        const ng = g[u] + this.cost[k];
        if (ng < g[v]) {
          g[v] = ng;
          prevEdge[v] = k;
          prevNode[v] = u;
          heap.push(v, ng + h(v));
        }
      }
    }
    if (bestEnd === null) return null;
    // walk back
    const nodes = [];
    let u = bestEnd;
    while (u !== -1 && u !== s1 && u !== s2) { nodes.push(u); u = prevNode[u]; }
    if (u === -1) return null;
    nodes.push(u);
    nodes.reverse();
    const out = [];
    // from A's projection to the first node along eA
    const first = nodes[0];
    const aPart = this._partialToNode(eA, A, first);
    out.push(...aPart);
    for (let i = 1; i < nodes.length; i++) {
      const v = nodes[i];
      const k = prevEdge[v];
      const c = this.edgeCoords(k, nodes[i - 1]);
      out.push(...c.slice(1));
    }
    const bPart = this._partialToNode(eB, B, bestEnd).reverse();
    out.push(...bPart.slice(1));
    return dedupe(out);
  }

  // Coordinates from point P (on edge k) to node `node` (one end of k).
  _partialToNode(k, P, node) {
    const c = this.edgeCoords(k);
    const pts = [[P.lat, P.lon]];
    if (node === this.to[k]) for (let j = P.seg + 1; j < c.length; j++) pts.push(c[j]);
    else for (let j = P.seg; j >= 0; j--) pts.push(c[j]);
    return pts;
  }

  _partial(k, A, B) {
    const c = this.edgeCoords(k);
    const pts = [[A.lat, A.lon]];
    if (A.along <= B.along) for (let j = A.seg + 1; j <= B.seg; j++) pts.push(c[j]);
    else for (let j = A.seg; j > B.seg; j--) pts.push(c[j]);
    pts.push([B.lat, B.lon]);
    return dedupe(pts);
  }
}

function dedupe(pts) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.abs(q[0] - p[0]) > 1e-7 || Math.abs(q[1] - p[1]) > 1e-7) out.push(p);
  }
  return out;
}

class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    k.push(key); v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (v[p] <= v[i]) break;
      [k[p], k[i]] = [k[i], k[p]]; [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop() {
    const k = this.k, v = this.v;
    const top = [k[0], v[0]];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      k[0] = lk; v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < k.length && v[l] < v[m]) m = l;
        if (r < k.length && v[r] < v[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]]; [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}

export class Dem {
  constructor(buf) {
    const dv = new DataView(buf);
    const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
    if (magic !== 'PDEM') throw new Error('bad dem file');
    this.lat0 = dv.getFloat64(4, true); this.lon0 = dv.getFloat64(12, true);
    this.dLat = dv.getFloat64(20, true); this.dLon = dv.getFloat64(28, true);
    this.nx = dv.getUint32(36, true); this.ny = dv.getUint32(40, true);
    this.z = new Int16Array(buf.slice(44, 44 + this.nx * this.ny * 2));
  }

  at(lat, lon) {
    const fx = (lon - this.lon0) / this.dLon, fy = (lat - this.lat0) / this.dLat;
    const x = Math.max(0, Math.min(this.nx - 1.001, fx)), y = Math.max(0, Math.min(this.ny - 1.001, fy));
    const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j;
    const z = (a, b) => this.z[b * this.nx + a] / 10;
    return z(i, j) * (1 - u) * (1 - v) + z(i + 1, j) * u * (1 - v) + z(i, j + 1) * (1 - u) * v + z(i + 1, j + 1) * u * v;
  }
}

// Course spec (same shape as data/course.json) from a route polyline.
export function practiceSpec(latlon, dem, { name = 'Practice', outAndBack = false } = {}) {
  let pts = latlon;
  if (outAndBack) pts = latlon.concat(latlon.slice(0, -1).reverse());
  const line = lineFromLatLon(pts);
  const total = line[line.length - 1][2];
  const step = 10;
  const n = Math.ceil(total / step) + 1;
  const ele = new Float64Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.min(i * step, total);
    while (j < line.length - 2 && line[j + 1][2] < d) j++;
    const a = line[j], b = line[j + 1] || a;
    const f = b[2] > a[2] ? (d - a[2]) / (b[2] - a[2]) : 0;
    ele[i] = dem ? dem.at(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f) : 0;
  }
  const smooth = gaussianSmooth(ele, 2);
  return {
    id: 'practice',
    name,
    distance: total,
    line: line.map(([la, lo, d]) => [+la.toFixed(6), +lo.toFixed(6), +d.toFixed(1)]),
    profile: { d0: 0, step, ele: Array.from(smooth, (v) => +v.toFixed(2)) },
    tunnels: [],
    aid: [],
    outAndBack,
    turnD: outAndBack ? line[latlon.length - 1][2] : null,
  };
}
