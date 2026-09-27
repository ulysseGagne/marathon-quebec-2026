// Persistence: settings, the active run and its GPS track. Everything is written
// immediately so a reload, a crash or iOS killing the page never loses the run.

const KEY_SETTINGS = 'pacer.settings.v1';
const KEY_RUN = 'pacer.run.v1';
const TRACK_PREFIX = 'pacer.track.';

// The fuel plan: one bar before the start, four on the course around the race's two gel
// stations, a fuel stop every 21-29 min from km 4.8 to km 31.9 (nothing after 2:16: food
// that late has little time left to help). Each bar is announced exactly 1 km before a
// water station (about 2 min to eat it, 2 to get ready, then "Water in 200 meters"), on
// ground that is flat or gently downhill and outside the tunnels. XACT bars are 25 g of
// carbs; the Performance ones (CAF) add 50 mg of caffeine: one before the start (it peaks
// 45-60 min after), two for the second half. The race gels count as ~25 g each.
//   before the start (~7:20)  CAF
//   4.8   0:20  REG   Limoilou, water at 5.8
//   10.1  0:42  REG   Saint-Charles river, flat, water at 11.1
//   15.1  1:05  race gel
//   21.9  1:34  CAF     gentle downhill (-3.9 %), water at 22.9: kicks in for km 30-42
//   27    1:55  race gel
//   31.9  2:16  CAF     Boulevard Champlain, flat, water at 32.9: the last 10 km
// In the race: 4 bars + 2 gels = ~150 g, ~50 g/h; caffeine 150 mg. The sixth bar (REG)
// is a spare.
export const SUGGESTED_BARS = [
  { km: 4.8, caf: false }, { km: 10.1, caf: false }, { km: 21.9, caf: true }, { km: 31.9, caf: true },
];
// earlier suggestions nobody edited move to the new plan
const OLD_SUGGESTIONS = [
  '[8.1,14.8,24.4,32.6]', '[8.1,19,26.7,32.6]',
  '[{"km":8.1,"caf":false},{"km":22.6,"caf":true},{"km":32.6,"caf":true}]',
];

export const DEFAULT_SETTINGS = {
  target: 2 * 3600 + 59 * 60 + 30, // race finish target (s)
  wind: { fromDeg: 45, kmh: 0 },
  aidSeconds: 0,
  voiceMode: 'offpace',             // 'offpace' (only when 10 s+ off), 'every' (voiceEvery), 'off'
  voiceEvery: 1000,                // metres between spoken gaps in 'every' mode
  voiceBand: 5,                    // 'offpace': first warning at 5 or 10 s off the ghost
  bars: SUGGESTED_BARS.map((b) => ({ ...b })), // [{km, caf}] bars on the course, announced there
  preBar: 'caf',                   // before the start: 'caf', 'bar' or 'none'
  raceGels: true,                  // take the race's gels (km 15.1 and 27): "Gel in 200 meters"
  theme: 'mono',                   // colour theme (js/theme.js)
  pocket: false,                   // black screen during the run, voice only
  directions: true,                // "Turn right in 50 meters" before each turn
  gunOffset: 0,                    // seconds to add to the official 8:00:00 gun
  practicePace: 255,               // s/km for practice runs
  practiceRoute: 'home-dkn',       // 'home-dkn' (Sommet 3V → DKN) or 'dkn-home', one way
};

function get(k) { try { return localStorage.getItem(k); } catch { return null; } }
function set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } }
function del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } }

export function loadSettings() {
  let s = {};
  try { s = JSON.parse(get(KEY_SETTINGS) || '{}') || {}; } catch { s = {}; }
  // earlier versions: voice on/off at each km, and a red/green or black number panel
  if (typeof s.voice === 'boolean' && s.voiceEvery === undefined) s.voiceEvery = s.voice ? 1000 : 0;
  delete s.voice;
  delete s.panel;
  delete s.practiceReturn; // practice routes are one way now
  // before voice modes: 0 meant off; 1 km was the default and becomes "only when off pace"
  if (Array.isArray(s.bars)) {
    if (OLD_SUGGESTIONS.includes(JSON.stringify(s.bars))) s.bars = SUGGESTED_BARS.map((b) => ({ ...b }));
    else s.bars = s.bars.map((b) => (typeof b === 'number' ? { km: b, caf: false } : b)).filter((b) => b && Number.isFinite(b.km));
  }
  if (s.voiceMode === undefined && s.voiceEvery !== undefined) {
    if (s.voiceEvery === 0) { s.voiceMode = 'off'; s.voiceEvery = 1000; }
    else if (s.voiceEvery !== 1000) s.voiceMode = 'every';
  }
  return { ...DEFAULT_SETTINGS, ...s, wind: { ...DEFAULT_SETTINGS.wind, ...(s.wind || {}) } };
}

export function saveSettings(s) { set(KEY_SETTINGS, JSON.stringify(s)); }

// "8.1, 22.6c 32,6c" -> [{km: 8.1}, {km: 22.6, caf}, {km: 32.6, caf}]: commas or spaces
// between numbers, a decimal comma is fine too ("24,4" alone), "c" after the km marks a
// caffeinated bar.
export function parseBars(text, maxKm) {
  const out = new Map();
  for (let tok of String(text).split(/[\s;]+/)) {
    tok = tok.replace(/^,+|,+$/g, '');
    if (!tok) continue;
    const parts = /^\d+,\d+c?$/i.test(tok) ? [tok.replace(',', '.')] : tok.split(',');
    for (const p of parts) {
      const caf = /c$/i.test(p);
      const v = Number(p.replace(/c$/i, ''));
      if (Number.isFinite(v) && v > 0 && v < maxKm) out.set(Math.round(v * 10) / 10, caf);
    }
  }
  return [...out].sort((a, b) => a[0] - b[0]).map(([km, caf]) => ({ km, caf }));
}

export function fmtBars(bars) {
  return (bars || []).map((b) => `${b.km.toFixed(1)}${b.caf ? 'c' : ''}`).join(', ');
}

export function loadRun() {
  try {
    const r = JSON.parse(get(KEY_RUN) || 'null');
    return r && r.t0 ? r : null;
  } catch { return null; }
}

export function saveRun(run) { return set(KEY_RUN, JSON.stringify(run)); }
export function clearRun() { del(KEY_RUN); }

// GPS track of a run, stored in chunks of 300 points: [tMs, lat, lon, acc, dOfficial]
export class TrackLog {
  constructor(runId) {
    this.runId = runId;
    this.buf = [];
    this.chunk = 0;
    while (get(`${TRACK_PREFIX}${runId}.${this.chunk}`) !== null) this.chunk++;
    if (this.chunk > 0) {
      // resume the last, partially filled chunk
      this.chunk--;
      try { this.buf = JSON.parse(get(`${TRACK_PREFIX}${runId}.${this.chunk}`)) || []; } catch { this.buf = []; }
    }
    this.dirty = 0;
  }

  add(t, lat, lon, acc, d) {
    this.buf.push([Math.round(t), +lat.toFixed(6), +lon.toFixed(6), Math.round(acc || 0), d == null ? null : Math.round(d)]);
    this.dirty++;
    if (this.buf.length >= 300) {
      this.flush();
      this.chunk++;
      this.buf = [];
    } else if (this.dirty >= 15) this.flush();
  }

  flush() {
    if (!this.dirty) return;
    set(`${TRACK_PREFIX}${this.runId}.${this.chunk}`, JSON.stringify(this.buf));
    this.dirty = 0;
  }

  static load(runId) {
    const out = [];
    for (let i = 0; ; i++) {
      const v = get(`${TRACK_PREFIX}${runId}.${i}`);
      if (v === null) break;
      try { out.push(...JSON.parse(v)); } catch { /* skip */ }
    }
    return out;
  }

  static clearAll(keepRunId = null) {
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(TRACK_PREFIX) && !(keepRunId && k.startsWith(`${TRACK_PREFIX}${keepRunId}.`))) keys.push(k);
      }
      keys.forEach(del);
    } catch { /* ignore */ }
  }
}

export function toGpx(points, name) {
  const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
  const rows = points.map(([t, lat, lon]) =>
    `      <trkpt lat="${lat}" lon="${lon}"><time>${new Date(t).toISOString()}</time></trkpt>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Virtual Pacer" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(name)}</name></metadata>
  <trk><name>${esc(name)}</name><type>running</type>
    <trkseg>
${rows.join('\n')}
    </trkseg>
  </trk>
</gpx>
`;
}
