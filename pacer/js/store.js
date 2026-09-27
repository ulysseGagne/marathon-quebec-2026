// Persistence: settings, the active run and its GPS track. Everything is written
// immediately so a reload, a crash or iOS killing the page never loses the run.

const KEY_SETTINGS = 'pacer.settings.v1';
const KEY_RUN = 'pacer.run.v1';
const TRACK_PREFIX = 'pacer.track.';

export const DEFAULT_SETTINGS = {
  target: 2 * 3600 + 59 * 60 + 30, // race finish target (s)
  wind: { fromDeg: 45, kmh: 0 },
  aidSeconds: 0,
  voiceEvery: 1000,                // metres between spoken gaps (0 = off)
  voiceMix: true,                  // recorded voice over the music (false: iPhone voice, pauses music)
  bars: [8.1, 14.8, 24.4, 32.6],   // official km where you eat a bar (placeholder plan: edit in Settings)
  theme: 'mono',                   // colour theme (js/theme.js)
  pocket: false,                   // black screen during the run, voice only
  gunOffset: 0,                    // seconds to add to the official 8:00:00 gun
  practicePace: 255,               // s/km for practice runs
  practiceReturn: true,            // out and back
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
  return { ...DEFAULT_SETTINGS, ...s, wind: { ...DEFAULT_SETTINGS.wind, ...(s.wind || {}) } };
}

export function saveSettings(s) { set(KEY_SETTINGS, JSON.stringify(s)); }

// "8.1, 14.8 24,4" -> [8.1, 14.8, 24.4]: commas or spaces between numbers, and a decimal
// comma is fine too ("24,4" alone).
export function parseKms(text, maxKm) {
  const out = [];
  for (let tok of String(text).split(/[\s;]+/)) {
    tok = tok.replace(/^,+|,+$/g, '');
    if (!tok) continue;
    const parts = /^\d+,\d+$/.test(tok) ? [tok.replace(',', '.')] : tok.split(',');
    for (const p of parts) {
      const v = Number(p);
      if (Number.isFinite(v) && v > 0 && v < maxKm) out.push(Math.round(v * 10) / 10);
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
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
