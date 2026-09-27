// MapLibre map: black basemap from the bundled PMTiles, the course in sunlight-readable
// yellow, the ghost in magenta, you in white. Works fully offline.
/* global maplibregl, pmtiles */

export const COLORS = {
  course: '#FFD60A',
  courseDone: '#4d4a3a',
  ghost: '#FF2BD6',
  me: '#FFFFFF',
  aid: '#2EA8FF',
};

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
    this.splitD = null;
    this.ready = false;
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
    this.ready = true;
    new ResizeObserver(() => { this.map.resize(); this.calib = null; }).observe(this.container);
  }

  _addCourseLayers() {
    const m = this.map;
    const empty = fc([]);
    for (const id of ['course-done', 'course-ahead', 'course-tunnel', 'km', 'aid', 'ends', 'trail']) {
      m.addSource(id, { type: 'geojson', data: empty });
    }
    m.addLayer({
      id: 'trail', type: 'line', source: 'trail',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#8a8a8a', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2, 18, 5], 'line-opacity': 0.8 },
    });
    m.addLayer({
      id: 'course-done', type: 'line', source: 'course-done',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': COLORS.courseDone, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 11, 2, 15, 6, 18, 14] },
    });
    m.addLayer({
      id: 'course-ahead', type: 'line', source: 'course-ahead',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': COLORS.course, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 11, 2.5, 15, 7, 18, 16] },
    });
    m.addLayer({
      id: 'course-tunnel', type: 'line', source: 'course-tunnel',
      paint: {
        'line-color': '#000000', 'line-opacity': 0.75,
        'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 11, 1.5, 15, 3.5, 18, 8],
        'line-dasharray': [1.2, 1.2],
      },
    });
    m.addLayer({
      id: 'aid', type: 'circle', source: 'aid', minzoom: 12.5,
      paint: {
        'circle-color': COLORS.aid, 'circle-stroke-color': '#000000', 'circle-stroke-width': 2,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 4, 17, 9],
        'circle-pitch-alignment': 'viewport',
      },
    });
    m.addLayer({
      id: 'km-dot', type: 'circle', source: 'km', minzoom: 12.5,
      paint: {
        'circle-color': '#FFFFFF', 'circle-stroke-color': '#000000', 'circle-stroke-width': 2,
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
      paint: { 'text-color': '#000000' },
    });
    m.addLayer({
      id: 'ends', type: 'symbol', source: 'ends',
      layout: {
        'text-field': ['get', 'label'], 'text-font': ['Open Sans Bold'], 'text-size': 14,
        'text-allow-overlap': true, 'text-offset': [0, -1.4],
      },
      paint: { 'text-color': '#FFFFFF', 'text-halo-color': '#000000', 'text-halo-width': 2 },
    });
  }

  _makeMe() {
    const el = document.createElement('div');
    el.className = 'me-marker';
    el.innerHTML = `
      <svg viewBox="-50 -50 100 100" width="100" height="100" aria-hidden="true">
        <g class="cone"><path d="M0 0 L-24 -46 A52 52 0 0 1 24 -46 Z" fill="url(#coneGrad)"/></g>
        <defs><radialGradient id="coneGrad" cx="0" cy="0" r="52" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#fff" stop-opacity="0.55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
        </radialGradient></defs>
        <g class="arrow"><path d="M0 -17 L12 13 L0 7 L-12 13 Z" fill="#fff" stroke="#000" stroke-width="3" stroke-linejoin="round"/></g>
        <circle class="dot" r="9" fill="#fff" stroke="#000" stroke-width="3"/>
      </svg>`;
    const marker = new maplibregl.Marker({ element: el, rotationAlignment: 'viewport', pitchAlignment: 'viewport' })
      .setLngLat([-71.235, 46.805]);
    return {
      el, marker, shown: false,
      cone: el.querySelector('.cone'), arrow: el.querySelector('.arrow'), dot: el.querySelector('.dot'), last: '',
    };
  }

  _makeGhost() {
    const el = document.createElement('div');
    el.className = 'ghost-marker';
    el.innerHTML = '<div class="ghost-dot"></div>';
    const marker = new maplibregl.Marker({ element: el, pitchAlignment: 'viewport' }).setLngLat([-71.235, 46.805]);
    return { el, marker, shown: false };
  }

  setCourse(course) {
    this.course = course;
    this.splitD = null;
    const line = course.line;
    const kms = [];
    for (let k = 1; k * 1000 < course.total; k++) {
      const [la, lo] = line.latLonAt(k * 1000);
      kms.push(pointFeature(lo, la, { km: k }));
    }
    this.map.getSource('km').setData(fc(kms));
    this.map.getSource('aid').setData(fc(course.aid.map((a) => {
      const [la, lo] = line.latLonAt(a.d);
      return pointFeature(lo, la, { km: a.km });
    })));
    const [sla, slo] = line.latLonAt(0);
    const [fla, flo] = line.latLonAt(course.total);
    const ends = [pointFeature(slo, sla, { label: course.id === 'marathon' ? 'START' : 'START' })];
    if (Math.hypot(sla - fla, slo - flo) > 0.0004) ends.push(pointFeature(flo, fla, { label: 'FINISH' }));
    else ends[0].properties.label = 'START · FINISH';
    this.map.getSource('ends').setData(fc(ends));
    this.map.getSource('course-tunnel').setData(fc(course.tunnels
      .filter(([a, b]) => b - a > 120)
      .map(([a, b]) => lineFeature(line.slice(a, b).map(([la, lo]) => [lo, la])))));
    this.setProgress(line.d0);
  }

  clearCourse() {
    this.course = null;
    for (const id of ['course-done', 'course-ahead', 'course-tunnel', 'km', 'aid', 'ends']) this.map.getSource(id).setData(fc([]));
  }

  setProgress(d) {
    if (!this.course) return;
    if (this.splitD !== null && Math.abs(d - this.splitD) < 8) return;
    this.splitD = d;
    const line = this.course.line;
    const dd = Math.max(line.d0, Math.min(line.d1, d));
    const done = dd > line.d0 ? line.slice(line.d0, dd).map(([la, lo]) => [lo, la]) : [];
    const ahead = line.slice(dd, line.d1).map(([la, lo]) => [lo, la]);
    this.map.getSource('course-done').setData(fc(done.length > 1 ? [lineFeature(done)] : []));
    this.map.getSource('course-ahead').setData(fc(ahead.length > 1 ? [lineFeature(ahead)] : []));
  }

  setTrail(latlons) {
    this.map.getSource('trail').setData(fc(latlons.length > 1 ? [lineFeature(latlons.map(([la, lo]) => [lo, la]))] : []));
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

  setGhost(lat, lon) {
    const g = this.ghost;
    if (lat === null) { if (g.shown) { g.marker.remove(); g.shown = false; } return; }
    g.marker.setLngLat([lon, lat]);
    if (!g.shown) { g.marker.addTo(this.map); g.shown = true; }
  }

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
    this.map.fitBounds([[minLo, minLa], [maxLo, maxLa]], { padding: 28, bearing: 0, pitch: 0, duration: 0 });
  }
}

function haversineLL(lat1, lon1, lat2, lon2) {
  const R = 6371008.8, D = Math.PI / 180;
  const dp = (lat2 - lat1) * D, dl = (lon2 - lon1) * D;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(lat1 * D) * Math.cos(lat2 * D) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
