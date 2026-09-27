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

// Voice "only when off pace". Warnings start 10 s from the ghost, either way, then come at
// every 5 s step as the gap gets worse and as it gets better: 10, 15, 20 seconds behind…
// then 15, 10 as you come back (the same ahead). After a warning, "on pace" the moment you
// meet the ghost again (the gap reaches 0 or changes side). Nothing else inside ±10 s.
// state = {level, inside}: level = the step last warned about (+15 = 15 s behind, -10 =
// 10 s ahead), 0 once "on pace" was said or before any warning; inside = the gap came back
// well inside since (under 7 s), so the same step can be warned about again.
// shown = the gap on screen (whole seconds, + = behind).
// Returns {gap} (the gap on screen, a step unless it jumped), {pace: true}, or null.
export const OFF_PACE = { band: 10, step: 5, rearm: 7 };

// the step at or below the gap: +15 for 17 s behind, -10 for 12 s ahead, 0 inside ±10 s
export function offPaceLevel(shown, { band, step } = OFF_PACE) {
  const a = Math.abs(shown);
  return a >= band ? Math.sign(shown) * (band + Math.floor((a - band) / step) * step) : 0;
}

export function offPaceCue(state, shown, cfg = OFF_PACE) {
  const { band, step, rearm } = cfg;
  const a = Math.abs(shown);
  const C = state.level || 0;
  if (C !== 0 && Math.sign(shown) !== Math.sign(C)) {
    state.inside = false;
    // met the ghost (0) or just went past it: on pace
    if (a < band) { state.level = 0; return { pace: true }; }
    // jumped well past it (after a pause): a warning on the other side
    state.level = offPaceLevel(shown, cfg);
    return { gap: shown };
  }
  if (a < band) {
    if (C !== 0 && a < rearm) state.inside = true;
    return null;
  }
  // worse: a step further out than the last warning, or out again after coming well back in
  const out = offPaceLevel(shown, cfg);
  if (Math.abs(out) > Math.abs(C) || state.inside) {
    state.level = out;
    state.inside = false;
    return { gap: shown };
  }
  // better: down to a step below the last warning (at 15, then at 10)
  const down = Math.max(band, Math.ceil(a / step) * step);
  if (down < Math.abs(C)) { state.level = Math.sign(C) * down; return { gap: shown }; }
  return null;
}
