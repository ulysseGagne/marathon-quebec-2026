// The one number that matters: seconds behind (+) or ahead (-) of the ghost, measured at
// the exact spot where you are: gap = your elapsed time - ghost's time at your position.

export class GapDisplay {
  constructor() {
    this.shown = null;   // integer currently displayed
    this.smooth = null;  // smoothed raw gap (s)
    this.lastT = null;
  }

  reset() { this.shown = null; this.smooth = null; this.lastT = null; }

  /** raw gap (s) at time tMs -> {value, shown, sign} */
  push(raw, tMs) {
    if (!Number.isFinite(raw)) return this.state();
    if (this.smooth === null) {
      this.smooth = raw;
    } else {
      const dt = Math.max(0, Math.min(10, (tMs - this.lastT) / 1000));
      const a = 1 - Math.exp(-dt / 2.0); // ~2 s time constant
      this.smooth += a * (raw - this.smooth);
    }
    this.lastT = tMs;
    // hysteresis: only move the displayed integer when clearly past the half-way point
    const v = this.smooth;
    if (this.shown === null || Math.abs(v - this.shown) > 0.75) this.shown = Math.round(v);
    return this.state();
  }

  state() {
    const s = this.shown;
    return { value: this.smooth, shown: s, sign: s === null ? 0 : s > 0 ? 1 : s < 0 ? -1 : 0 };
  }
}

const MINUS = '\u2212'; // a real minus sign, as wide as the plus in the number font

// The number on screen: "+7" = 7 s ahead of the ghost (time in the bank), "−7" = 7 s
// behind, "0" = on it. From 100 s on, minutes: "−1:15". (sec is the gap: + = behind.)
export function fmtGap(sec) {
  const r = Math.round(sec);
  const a = Math.abs(r);
  const body = a < 100 ? String(a) : `${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
  return r < 0 ? `+${body}` : r > 0 ? `${MINUS}${body}` : body;
}

// Words used by the voice: "3 seconds behind", "1 second ahead", "on pace",
// "1 minute 40 seconds behind".
export function spokenGap(sec) {
  const a = Math.abs(Math.round(sec));
  if (a === 0) return 'on pace';
  const secs = (n) => `${n} second${n === 1 ? '' : 's'}`;
  let amount;
  if (a < 100) amount = secs(a);
  else {
    const m = Math.floor(a / 60), s = a % 60;
    amount = `${m} minute${m > 1 ? 's' : ''}${s ? ` ${secs(s)}` : ''}`;
  }
  return `${amount} ${sec > 0 ? 'behind' : 'ahead'}`;
}

// The same words as recorded clip ids (voice/*.mp3), or null when there is no clip
// (more than 9 minutes off: then the iPhone voice reads the text).
export function gapClips(sec) {
  const r = Math.round(sec);
  const a = Math.abs(r);
  if (a === 0) return ['pace'];
  const side = r > 0 ? 'b' : 'a';
  if (a < 100) return [`${side}${a}`];
  const m = Math.floor(a / 60), s = a % 60;
  if (m > 9) return null;
  return s ? [`m${m}`, `${side}${s}`] : [`m${m}`, r > 0 ? 'behind' : 'ahead'];
}

// Voice "only when off pace": quiet while within 10 s of the ghost. It says the gap when it
// first reaches 10 s, again at 15, 20, 25 s… as it gets worse (behind or ahead), nothing
// while it improves, and "on pace" once back within 7 s.
// state = {level}: the last level said (+k behind, -k ahead, 0 inside). shown = the gap on
// screen (whole seconds, + = behind). Returns {gap} or {pace: true} to say, or null.
export const OFF_PACE = { band: 10, step: 5, back: 7 };

export function offPaceLevel(shown, { band, step } = OFF_PACE) {
  const a = Math.abs(shown);
  return a >= band ? Math.sign(shown) * (1 + Math.floor((a - band) / step)) : 0;
}

export function offPaceCue(state, shown, cfg = OFF_PACE) {
  const L = offPaceLevel(shown, cfg);
  const C = state.level || 0;
  if (L !== 0 && (Math.sign(L) !== Math.sign(C) || Math.abs(L) > Math.abs(C))) {
    state.level = L;
    return { gap: shown };
  }
  if (C === 0) return null;
  const a = Math.abs(shown);
  if (a <= cfg.back) { state.level = 0; return { pace: true }; }
  // clearly better than the level last said (3 s of slack, GPS wobbles): step down quietly,
  // so that getting worse again is said again
  const down = Math.sign(C) * Math.max(1, Math.abs(offPaceLevel(Math.sign(C) * (a + 3), cfg)));
  if (Math.abs(down) < Math.abs(C)) state.level = down;
  return null;
}
