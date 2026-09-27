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

// "7", "42", "1:15"
export function fmtGap(sec) {
  const a = Math.abs(Math.round(sec));
  if (a < 100) return String(a);
  return `${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
}

// Words used by the voice: "3 behind", "10 ahead", "on pace"
export function spokenGap(sec) {
  const a = Math.abs(Math.round(sec));
  if (a === 0) return 'on pace';
  let amount;
  if (a < 100) amount = String(a);
  else {
    const m = Math.floor(a / 60), s = a % 60;
    amount = s ? `${m} minute${m > 1 ? 's' : ''} ${s}` : `${m} minute${m > 1 ? 's' : ''}`;
  }
  return `${amount} ${sec > 0 ? 'behind' : 'ahead'}`;
}
