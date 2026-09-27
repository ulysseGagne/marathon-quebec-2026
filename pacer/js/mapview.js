// MapLibre map: black basemap from the bundled PMTiles, the course and you. Works fully
// offline.
//
// The ghost is not a marker: it is the front of the bright course line. Behind the ghost
// the course is a thin line, from the ghost on it is bright. The front is drawn with a
// line-gradient on one static source, changed in place every frame: no re-tiling, so
// it glides instead of jumping in chunks, and it costs next to nothing.
/* global maplibregl, pmtiles */
import { themeOf } from './theme.js';

const CLEAR = 'rgba(0,0,0,0)';
const THIN = ['interpolate', ['exponential', 1.5], ['zoom'], 11, 1.3, 15, 3, 18, 6];
const THICK = ['interpolate', ['exponential', 1.5], ['zoom'], 11, 2.5, 15, 7, 18, 16];

// Web Mercator, exactly as the map's tiler measures line length (line-progress).
function mercX(lon) { return lon / 360 + 0.5; }
function mercY(lat) {
  const s = Math.sin((lat * Math.PI) / 180);
  const y = 0.5 - (0.25 * Math.log((1 + s) / (1 - s))) / Math.PI;
  return y < 0 ? 0 : y > 1 ? 1 : y;
}

// Line-progress lookup for a polyline: official (or trail) distance -> fraction of the
// line's Mercator length, which is what the map's line-progress measures.
export class Progress {
  constructor(lats, lons, dists) {
    const n = lats.length;
    this.d = dists;
    this.m = new Float64Array(n);
    let x0 = mercX(lons[0]), y0 = mercY(lats[0]);
    for (let i = 1; i < n; i++) {
      const x = mercX(lons[i]), y = mercY(lats[i]);
      this.m[i] = this.m[i - 1] + Math.sqrt((x - x0) ** 2 + (y - y0) ** 2);
      x0 = x; y0 = y;
    }
    this.total = this.m[n - 1] || 1;
    // half a metre, as a fraction: the width of the soft edge at the front
    const len = dists[n - 1] - dists[0];
    this.eps = len > 0 ? 0.5 / len : 1e-6;
  }

  at(dist) {
    const a = this.d, n = a.length;
    if (dist <= a[0]) return 0;
    if (dist >= a[n - 1]) return 1;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (a[mid] <= dist) lo = mid; else hi = mid; }
    const f = a[hi] > a[lo] ? (dist - a[lo]) / (a[hi] - a[lo]) : 0;
    return (this.m[lo] + (this.m[hi] - this.m[lo]) * f) / this.total;
  }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

function icon(w, h, draw) {
  const pr = 2;
  const c = document.createElement('canvas');
  c.width = w * pr; c.height = h * pr;
  const g = c.getContext('2d');
  g.scale(pr, pr);
  draw(g);
  return g.getImageData(0, 0, c.width, c.height);
}

// Where a bar is announced: a small black label, white outline and text (CAF for a
// caffeinated one, DECAF for the others).
function barPill(text) {
  const font = '800 11px -apple-system, system-ui, sans-serif';
  const m = document.createElement('canvas').getContext('2d');
  m.font = font;
  const w = Math.max(38, Math.ceil(m.measureText(text).width) + 16);
  return icon(w, 19, (g) => {
    roundRect(g, 1, 1, w - 2, 17, 5);
    g.fillStyle = '#000000'; g.fill();
    g.lineWidth = 1.5; g.strokeStyle = '#FFFFFF'; g.stroke();
    g.fillStyle = '#FFFFFF';
    g.font = font;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, 10);
  });
}

// Aid station: a small black circle with a white outline, like the km markers, and a
// white drop inside (no colour: they matter less).
function aidDrop() {
  return icon(22, 22, (g) => {
    g.beginPath(); g.arc(11, 11, 9.8, 0, 2 * Math.PI);
    g.fillStyle = '#000000'; g.fill();
    g.lineWidth = 1.6; g.strokeStyle = '#FFFFFF'; g.stroke();
    g.beginPath();
    g.moveTo(11, 4.6);
    g.bezierCurveTo(11, 4.6, 15, 9.6, 15, 12);
    g.arc(11, 12, 4, 0, Math.PI);
    g.bezierCurveTo(7, 9.6, 11, 4.6, 11, 4.6);
    g.closePath();
    g.fillStyle = '#FFFFFF'; g.fill();
  });
}

// Clear before fraction f, bright from f on (256 texels per tile: soft, cheap edge).
function frontGradient(f, eps, color) {
  return ['interpolate', ['linear'], ['line-progress'], f - eps, CLEAR, f, color];
}

class BufferSource {
  constructor(key, buf) { this.key = key; this.buf = buf; }
  getKey() { return this.key; }
  async getBytes(offset, length) { return { data: this.buf.slice(offset, offset + length) }; }
}

function darkStyle() {
  const line = (id, filter, color, widths, extra = {}) => ({
    id, type: 'line', source: 'base', 'source-layer': 'roads', filter,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': color,
      'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], ...widths],
      ...extra,
    },
  });
  const cls = (c) => ['==', ['get', 'c'], c];
  return {
    version: 8,
    // No animated paint transitions: the ghost front changes a paint property 5 times a
    // second, and each change would otherwise keep the map redrawing for 300 ms.
    transition: { duration: 0, delay: 0 },
    glyphs: 'glyphs/{fontstack}/{range}.pbf',
    sources: {
      base: { type: 'vector', url: 'pmtiles://basemap', attribution: '© OpenStreetMap contributors · Overture Maps' },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#000000' } },
      { id: 'green', type: 'fill', source: 'base', 'source-layer': 'green', paint: { 'fill-color': '#0c1d0f' } },
      { id: 'water', type: 'fill', source: 'base', 'source-layer': 'water', paint: { 'fill-color': '#0b2140' } },
      { id: 'waterway', type: 'line', source: 'base', 'source-layer': 'waterway', paint: { 'line-color': '#0b2140', 'line-width': 1.5 } },
      { id: 'buildings', type: 'fill', source: 'base', 'source-layer': 'buildings', minzoom: 14.5,
        paint: { 'fill-color': '#141414', 'fill-outline-color': '#222222' } },
      line('rail', cls('rail'), '#2b2b2b', [12, 0.6, 18, 2.5], { 'line-dasharray': [3, 3] }),
      line('road-path', cls('path'), '#2a2a2a', [14, 0.6, 18, 2.4]),
      line('road-service', cls('service'), '#2a2a2a', [14, 0.8, 18, 5]),
      line('road-minor', cls('minor'), '#333333', [13, 0.8, 18, 9]),
      line('road-tertiary', cls('tertiary'), '#3a3a3a', [12, 0.8, 18, 11]),
      line('road-secondary', cls('secondary'), '#404040', [11, 0.8, 18, 13]),
      line('road-primary', cls('primary'), '#474747', [11, 1, 18, 15]),
      line('road-motorway', cls('motorway'), '#4d4d4d', [11, 1.2, 18, 17]),
      {
        id: 'road-label', type: 'symbol', source: 'base', 'source-layer': 'roads', minzoom: 15,
        filter: ['has', 'n'],
        layout: {
          'text-field': ['get', 'n'], 'text-font': ['Open Sans Semibold'], 'text-size': 13,
          'symbol-placement': 'line', 'text-max-angle': 35, 'text-padding': 12, 'symbol-spacing': 320,
        },
        paint: { 'text-color': '#9a9a9a', 'text-halo-color': '#000000', 'text-halo-width': 1.6 },
      },
    ],
  };
}

function fc(features) { return { type: 'FeatureCollection', features }; }
function lineFeature(coords, props = {}) {
  return { type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: coords } };
}
function pointFeature(lon, lat, props = {}) {
  return { type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [lon, lat] } };
}

export class MapView {
  constructor(container) {
    this.container = container;
    this.map = null;
    this.course = null;
    this.ready = false;
    this.theme = themeOf('mono');
    this.lineColor = this.theme.line; // the bright line and the ghost arrow
    this.prog = null;       // Progress of the course line
    this.front = null;      // fraction currently drawn as the ghost front
    this.trailProg = null;
    this.trailFront = null;
    this.trailGhost = null;
    this.cam = null;        // last camera sent to the map
    this.calib = null;
    this.pitch = 55;
    this.padTopFrac = 0.46;
  }

  async init(basemapBuffer) {
    const protocol = new pmtiles.Protocol();
    protocol.add(new pmtiles.PMTiles(new BufferSource('basemap', basemapBuffer)));
    maplibregl.addProtocol('pmtiles', protocol.tile);
    this.map = new maplibregl.Map({
      container: this.container,
      style: darkStyle(),
      center: [-71.235, 46.805],
      zoom: 12,
      attributionControl: false,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      maxZoom: 19,
      maxPitch: 70,
      fadeDuration: 0,
      renderWorldCopies: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });
    this.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    await new Promise((resolve) => this.map.once('load', resolve));
    this._addCourseLayers();
    this.me = this._makeMe();
    this.ghost = this._makeGhost();
    this.ghost.path.style.fill = this.lineColor;
    this.ready = true;
    new ResizeObserver(() => { this.map.resize(); this.calib = null; }).observe(this.container);
  }

  _addCourseLayers() {
    const m = this.map;
    const T = this.theme;
    const empty = fc([]);
    m.addSource('course', { type: 'geojson', data: empty, lineMetrics: true });
    m.addSource('trail', { type: 'geojson', data: empty, lineMetrics: true });
    for (const id of ['course-tunnel', 'km', 'aid', 'bars', 'ends', 'endbars']) m.addSource(id, { type: 'geojson', data: empty });
    try { m.addImage('decaf-pill', barPill('DECAF'), { pixelRatio: 2 }); m.addImage('caf-pill', barPill('CAF'), { pixelRatio: 2 }); } catch (e) { console.warn('bar icon', e); }
    try { m.addImage('aid-drop', aidDrop(), { pixelRatio: 2 }); } catch (e) { console.warn('aid icon', e); }
    const round = { 'line-cap': 'round', 'line-join': 'round' };
    // free run: your own trail, bright from the ghost to you
    m.addLayer({ id: 'trail-route', type: 'line', source: 'trail', layout: round, paint: { 'line-color': T.route, 'line-width': THIN } });
    m.addLayer({ id: 'trail-live', type: 'line', source: 'trail', layout: round, paint: { 'line-width': THICK, 'line-gradient': frontGradient(2, 0.1, T.line) } });
    // the course: thin everywhere, bright from the ghost on
    m.addLayer({ id: 'course-route', type: 'line', source: 'course', layout: round, paint: { 'line-color': T.route, 'line-width': THIN } });
    m.addLayer({ id: 'course-live', type: 'line', source: 'course', layout: round, paint: { 'line-width': THICK, 'line-gradient': frontGradient(0, 1e-6, T.line) } });
    m.addLayer({
      id: 'course-tunnel', type: 'line', source: 'course-tunnel',
      paint: {
        'line-color': '#000000', 'line-opacity': 0.75,
        'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 11, 1.5, 15, 3.5, 18, 8],
        'line-dasharray': [1.2, 1.2],
      },
    });
    // the start and finish lines, painted across the road like the real ones
    const barW = (extra) => ['interpolate', ['linear'], ['zoom'], 12, 2 + extra, 15, 4 + extra, 18, 8 + extra];
    m.addLayer({ id: 'endbars-case', type: 'line', source: 'endbars', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#000000', 'line-width': barW(3) } });
    m.addLayer({ id: 'endbars', type: 'line', source: 'endbars', layout: { 'line-cap': 'round' }, paint: { 'line-color': T.ends, 'line-width': barW(0) } });
    m.addLayer({
      id: 'aid', type: 'symbol', source: 'aid', minzoom: 12.5,
      layout: {
        'icon-image': 'aid-drop', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 13, 0.65, 17, 1],
        'icon-pitch-alignment': 'viewport', 'icon-rotation-alignment': 'viewport',
        // what is handed out, when it is more than water and electrolytes
        'text-field': ['coalesce', ['get', 'what'], ''], 'text-font': ['Open Sans Bold'],
        'text-size': 12, 'text-anchor': 'left', 'text-offset': [0.9, 0], 'text-optional': true,
      },
      paint: { 'text-color': '#BDBDBD', 'text-halo-color': '#000000', 'text-halo-width': 1.6 },
    });
    m.addLayer({
      id: 'km-dot', type: 'circle', source: 'km', minzoom: 12.5,
      paint: {
        'circle-color': T.kmFill, 'circle-stroke-color': T.kmStroke, 'circle-stroke-width': 2,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 6, 16, 12, 18, 15],
        'circle-pitch-alignment': 'viewport',
      },
    });
    m.addLayer({
      id: 'km-label', type: 'symbol', source: 'km', minzoom: 12.5,
      layout: {
        'text-field': ['to-string', ['get', 'km']], 'text-font': ['Open Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 13, 9, 16, 14, 18, 17],
        'text-allow-overlap': true, 'text-ignore-placement': true,
        'text-pitch-alignment': 'viewport', 'text-rotation-alignment': 'viewport',
      },
      paint: { 'text-color': T.kmText },
    });
    m.addLayer({
      id: 'ends', type: 'symbol', source: 'ends',
      layout: {
        // START and FINISH are ~100 m apart: zoomed out, FINISH moves below its point
        // instead of printing over START (START is placed first).
        'text-field': ['get', 'label'], 'text-font': ['Open Sans Bold'], 'text-size': 14,
        'text-variable-anchor': ['bottom', 'top', 'right', 'left'], 'text-radial-offset': 1.9,
        'text-allow-overlap': false, 'symbol-sort-key': ['get', 'rank'],
      },
      paint: { 'text-color': T.ends, 'text-halo-color': '#000000', 'text-halo-width': 2 },
    });
    // on top, and placed first: START/FINISH and street names move out of its way
    m.addLayer({
      id: 'bars', type: 'symbol', source: 'bars', minzoom: 9,
      layout: {
        'icon-image': ['case', ['get', 'caf'], 'caf-pill', 'decaf-pill'],
        'icon-allow-overlap': true, 'icon-ignore-placement': false, // labels keep clear of it
        'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 13, 0.8, 16, 1, 18, 1.2],
        'icon-pitch-alignment': 'viewport', 'icon-rotation-alignment': 'viewport',
        // the bar before the start sits just below the start line, leaving START room above
        'icon-offset': ['case', ['get', 'pre'], ['literal', [0, 17]], ['literal', [0, 0]]],
      },
    });
  }

  setTheme(name) {
    this.theme = themeOf(name);
    this.lineColor = this.theme.line;
    if (!this.map) return;
    if (this.ghost) this.ghost.path.style.fill = this.lineColor;
    const m = this.map, T = this.theme;
    m.setPaintProperty('course-route', 'line-color', T.route);
    m.setPaintProperty('trail-route', 'line-color', T.route);
    m.setPaintProperty('km-dot', 'circle-color', T.kmFill);
    m.setPaintProperty('km-dot', 'circle-stroke-color', T.kmStroke);
    m.setPaintProperty('km-label', 'text-color', T.kmText);
    m.setPaintProperty('ends', 'text-color', T.ends);
    m.setPaintProperty('endbars', 'line-color', T.ends);
    this._drawFront(this.front ?? 0);
    this._drawTrailFront(this.trailFront ?? 2);
  }

  _makeMe() {
    const el = document.createElement('div');
    el.className = 'me-marker';
    el.innerHTML = `
      <svg viewBox="-60 -60 120 120" width="120" height="120" aria-hidden="true">
        <g class="cone"><path d="M0 0 L-28 -56 A62 62 0 0 1 28 -56 Z" fill="url(#coneGrad)"/></g>
        <defs><radialGradient id="coneGrad" cx="0" cy="0" r="62" gradientUnits="userSpaceOnUse">
          <stop offset="0" class="cone-stop" stop-opacity="0.55"/><stop offset="1" class="cone-stop" stop-opacity="0"/>
        </radialGradient></defs>
        <g class="arrow"><path class="me-fill" d="M0 -32 L24 26 L0 14 L-24 26 Z" stroke="#000" stroke-width="5" stroke-linejoin="round"/></g>
        <circle class="dot me-fill" r="13" stroke="#000" stroke-width="5"/>
      </svg>`;
    const marker = new maplibregl.Marker({ element: el, rotationAlignment: 'viewport', pitchAlignment: 'viewport' })
      .setLngLat([-71.235, 46.805]);
    return {
      el, marker, shown: false,
      cone: el.querySelector('.cone'), arrow: el.querySelector('.arrow'), dot: el.querySelector('.dot'), last: '',
    };
  }

  // The ghost: a white arrow (the line's colour) at the front of the bright line, hiding
  // where the line starts.
  _makeGhost() {
    const el = document.createElement('div');
    el.className = 'ghost-marker';
    el.innerHTML = `
      <svg viewBox="-60 -60 120 120" width="120" height="120" aria-hidden="true">
        <path class="ghost-fill" d="M0 -27 L20 22 L0 12 L-20 22 Z" stroke="#000" stroke-width="5" stroke-linejoin="round"/>
      </svg>`;
    const marker = new maplibregl.Marker({ element: el, rotationAlignment: 'viewport', pitchAlignment: 'viewport' })
      .setLngLat([-71.235, 46.805]);
    return { el, marker, shown: false, path: el.querySelector('path'), rot: null };
  }

  setGhost(lat, lon, travel) {
    const g = this.ghost;
    if (lat === null) { if (g.shown) { g.marker.remove(); g.shown = false; } return; }
    g.marker.setLngLat([lon, lat]);
    if (!g.shown) { g.marker.addTo(this.map); g.shown = true; }
    const rot = Math.round(travel - this.map.getBearing());
    if (rot !== g.rot) { g.rot = rot; g.path.setAttribute('transform', `rotate(${rot})`); }
  }

  setCourse(course) {
    this.course = course;
    const line = course.line;
    const coords = new Array(line.n);
    for (let i = 0; i < line.n; i++) coords[i] = [line.lon[i], line.lat[i]];
    this.prog = new Progress(line.lat, line.lon, line.d);
    this.front = null;
    this.map.getSource('course').setData(fc([lineFeature(coords)]));
    const kms = [];
    for (let k = 1; k * 1000 < course.total; k++) {
      const [la, lo] = line.latLonAt(k * 1000);
      kms.push(pointFeature(lo, la, { km: k }));
    }
    this.map.getSource('km').setData(fc(kms));
    this.map.getSource('aid').setData(fc(course.aid.map((a) => {
      const [la, lo] = line.latLonAt(a.d);
      return pointFeature(lo, la, { km: a.km, what: a.what || null });
    })));
    const [sla, slo] = line.latLonAt(0);
    const [fla, flo] = line.latLonAt(course.total);
    const ends = [pointFeature(slo, sla, { label: 'START', rank: 0 })];
    if (Math.hypot(sla - fla, slo - flo) > 0.0004) ends.push(pointFeature(flo, fla, { label: 'FINISH', rank: 1 }));
    else ends[0].properties.label = 'START · FINISH';
    this.map.getSource('ends').setData(fc(ends));
    // a 22 m bar across the course at the start line (official km 0) and at the finish
    const bar = (d) => {
      const [x, y] = line.xyAt(d);
      const b = (line.bearingAt(d, 10, 10) * Math.PI) / 180;
      const dx = Math.cos(b) * 11, dy = -Math.sin(b) * 11;
      return lineFeature([[line.proj.lon(x - dx), line.proj.lat(y - dy)], [line.proj.lon(x + dx), line.proj.lat(y + dy)]]);
    };
    this.endbars = [bar(0), bar(course.total)];
    this.map.getSource('endbars').setData(fc(this.endbars));
    this.map.getSource('course-tunnel').setData(fc(course.tunnels
      .filter(([a, b]) => b - a > 120)
      .map(([a, b]) => lineFeature(line.slice(a, b).map(([la, lo]) => [lo, la])))));
    // before the start the bright line begins at the start line; the thin stretch behind it
    // is the corral, there so the app can follow you up to the line
    this.setGhostAt(Math.max(line.d0, 0));
  }

  clearCourse() {
    this.course = null;
    this.prog = null;
    for (const id of ['course', 'course-tunnel', 'km', 'aid', 'bars', 'ends', 'endbars']) this.map.getSource(id).setData(fc([]));
  }

  // Bars you planned to eat ([{km, caf}]), at official km on this course, and the one
  // before the start (pre: 'caf', 'bar' or 'none') at the start line.
  setBars(course, bars, pre = 'none') {
    const feats = (bars || []).filter((b) => b.km * 1000 < course.total).map((b) => {
      const [la, lo] = course.line.latLonAt(b.km * 1000);
      return pointFeature(lo, la, { km: b.km, caf: !!b.caf });
    });
    if (pre && pre !== 'none') {
      const [la, lo] = course.line.latLonAt(0);
      feats.push(pointFeature(lo, la, { km: 0, caf: pre === 'caf', pre: true }));
    }
    this.map.getSource('bars').setData(fc(feats));
  }

  // The ghost is at official distance d: the course is bright from there on.
  setGhostAt(d) {
    if (!this.prog) return;
    const f = this.prog.at(d);
    // redraw only when the front moved by more than ~0.2 m
    if (this.front !== null && Math.abs(f - this.front) < this.prog.eps * 0.4) return;
    this._drawFront(f);
  }

  _drawFront(f) {
    this.front = f;
    const eps = this.prog ? this.prog.eps : 1e-6;
    this._setGradient('course-live', frontGradient(f, eps, this.lineColor));
  }

  // Straight onto the style layer rather than map.setPaintProperty(), which would also fire
  // a style "data" event and cost one extra identical redraw per change. The line renderer
  // reads the gradient from the layer and rebuilds it when gradientVersion changes.
  _setGradient(layerId, value) {
    const layer = this.map.getLayer(layerId);
    if (layer && typeof layer.setPaintProperty === 'function' && 'gradientVersion' in layer) {
      layer.setPaintProperty('line-gradient', value, { validate: false });
      this.map.triggerRepaint();
    } else {
      this.map.setPaintProperty(layerId, 'line-gradient', value, { validate: false });
    }
  }

  // Free run: your trail so far ([[lat, lon]], with cumulative distances); the ghost's
  // stretch of it, from the ghost to you, is bright.
  setTrail(latlons, cum) {
    const n = latlons.length;
    if (n < 2) { this.map.getSource('trail').setData(fc([])); this.trailProg = null; return; }
    const lats = new Float64Array(n), lons = new Float64Array(n), ds = new Float64Array(n);
    const coords = new Array(n);
    for (let i = 0; i < n; i++) {
      lats[i] = latlons[i][0]; lons[i] = latlons[i][1]; ds[i] = cum[i];
      coords[i] = [lons[i], lats[i]];
    }
    this.trailProg = new Progress(lats, lons, ds);
    this.map.getSource('trail').setData(fc([lineFeature(coords)]));
    if (this.trailGhost !== null) this.setTrailGhostAt(this.trailGhost, true);
  }

  setTrailGhostAt(d, force = false) {
    this.trailGhost = d;
    if (!this.trailProg) return;
    const P = this.trailProg;
    const f = d < P.d[0] ? 0 : d > P.d[P.d.length - 1] ? 2 : P.at(d);
    if (!force && this.trailFront !== null && Math.abs(f - this.trailFront) < P.eps * 0.4) return;
    this._drawTrailFront(f);
  }

  _drawTrailFront(f) {
    this.trailFront = f;
    const eps = this.trailProg ? this.trailProg.eps : 1e-6;
    this._setGradient('trail-live', frontGradient(f, eps, this.lineColor));
  }

  clearTrail() {
    this.trailProg = null;
    this.trailFront = null;
    this.trailGhost = null;
    this.map.getSource('trail').setData(fc([]));
  }

  setMe(lat, lon, { heading = null, travel = null } = {}) {
    const me = this.me;
    me.marker.setLngLat([lon, lat]);
    if (!me.shown) { me.marker.addTo(this.map); me.shown = true; }
    const bearing = this.map.getBearing();
    const coneRot = heading === null ? null : Math.round(heading - bearing);
    const arrowRot = travel === null ? null : Math.round(travel - bearing);
    const key = `${coneRot}|${arrowRot}`;
    if (key === me.last) return;
    me.last = key;
    if (coneRot === null) me.cone.style.display = 'none';
    else { me.cone.style.display = ''; me.cone.setAttribute('transform', `rotate(${coneRot})`); }
    if (arrowRot === null) { me.arrow.style.display = 'none'; me.dot.style.display = ''; }
    else { me.arrow.style.display = ''; me.dot.style.display = 'none'; me.arrow.setAttribute('transform', `rotate(${arrowRot})`); }
  }

  hideMe() { if (this.me.shown) { this.me.marker.remove(); this.me.shown = false; } }

  setInteractive(on) {
    const m = this.map;
    const handlers = ['scrollZoom', 'boxZoom', 'dragPan', 'keyboard', 'doubleClickZoom', 'touchZoomRotate'];
    for (const h of handlers) on ? m[h].enable() : m[h].disable();
    if (on) m.touchZoomRotate.disableRotation();
  }

  // How far ahead (m) the top edge of the map shows at zoom 16 with the running camera.
  _calibrate() {
    const m = this.map;
    const h = this.container.clientHeight, w = this.container.clientWidth;
    if (!h || !w) return null;
    const save = { center: m.getCenter(), zoom: m.getZoom(), bearing: m.getBearing(), pitch: m.getPitch(), padding: m.getPadding() };
    const pad = { top: h * this.padTopFrac, bottom: 0, left: 0, right: 0 };
    m.jumpTo({ center: [-71.235, 46.805], zoom: 16, bearing: 0, pitch: this.pitch, padding: pad });
    const c = m.project([-71.235, 46.805]);
    const top = m.unproject([w / 2, Math.max(4, h * 0.06)]);
    const dist = haversineLL(46.805, -71.235, top.lat, top.lng);
    m.jumpTo(save);
    this.calib = { L16: dist, meY: c.y / h, h, w };
    return this.calib;
  }

  zoomForAhead(L) {
    const c = this.calib || this._calibrate();
    if (!c) return 16;
    return Math.max(12.5, Math.min(18.3, 16 + Math.log2(c.L16 / L)));
  }

  follow({ lat, lon, bearing, zoom, pitch = this.pitch }) {
    const h = this.container.clientHeight;
    // Skip a camera move nobody could see (standing in the corral): no redraw at all.
    const c = this.cam;
    if (c && c.h === h && c.pitch === pitch && Math.abs(c.zoom - zoom) < 0.004 &&
        Math.abs(((bearing - c.bearing + 540) % 360) - 180) < 0.15 &&
        Math.abs(c.lat - lat) < 2e-6 && Math.abs(c.lon - lon) < 3e-6) return;
    this.cam = { lat, lon, bearing, zoom, pitch, h };
    this.map.jumpTo({
      center: [lon, lat], bearing, zoom, pitch,
      padding: { top: h * this.padTopFrac * (pitch / this.pitch), bottom: 0, left: 0, right: 0 },
    });
  }

  overview(extra = null) {
    if (!this.course) return;
    const line = this.course.line;
    let minLa = 90, maxLa = -90, minLo = 180, maxLo = -180;
    const add = (la, lo) => { minLa = Math.min(minLa, la); maxLa = Math.max(maxLa, la); minLo = Math.min(minLo, lo); maxLo = Math.max(maxLo, lo); };
    for (let i = 0; i < line.n; i++) add(line.lat[i], line.lon[i]);
    if (extra) add(extra[0], extra[1]);
    this.cam = null;
    this.map.fitBounds([[minLo, minLa], [maxLo, maxLa]], { padding: 28, bearing: 0, pitch: 0, duration: 0 });
  }
}

function haversineLL(lat1, lon1, lat2, lon2) {
  const R = 6371008.8, D = Math.PI / 180;
  const dp = (lat2 - lat1) * D, dl = (lon2 - lon1) * D;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(lat1 * D) * Math.cos(lat2 * D) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
