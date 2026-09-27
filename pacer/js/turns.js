// Turn-by-turn directions along a course: where it turns, which way, and what to say 50 m
// before ("Turn right in 50 meters", "Turn right in 50 meters, then left", "U-turn to the
// left in 50 meters"). Pure functions, so they run the same in Node tests.
import { angleDiff } from './geo.js';

const SIMPLIFY = 7;   // m: the line is simplified this much first, so a road that curves or
                      // wiggles says nothing and only corners remain
const MIN_TURN = 30;  // deg: corners gentler than this are the road bending, not a turn
const MERGE = 25;     // m: two corners the same way this close are one turn (a U-turn
                      // around an island, a corner drawn as two)
const CHAIN = 60;     // m: a turn this close after the one before is said with it ("then left")
export const CALL_AT = 50; // m before the turn

// Douglas-Peucker on the course vertices (projected x, y in metres): indices kept
function simplify(line, tol) {
  const n = line.n;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b <= a + 1) continue;
    const ax = line.x[a], ay = line.y[a], vx = line.x[b] - ax, vy = line.y[b] - ay;
    const L2 = vx * vx + vy * vy;
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const px = line.x[i] - ax, py = line.y[i] - ay;
      let t = L2 > 0 ? (px * vx + py * vy) / L2 : 0;
      t = Math.max(0, Math.min(1, t));
      const dist = Math.hypot(px - vx * t, py - vy * t);
      if (dist > best) { best = dist; bi = i; }
    }
    if (best > tol) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}

function bearing(line, i, j) {
  return (Math.atan2(line.x[j] - line.x[i], line.y[j] - line.y[i]) * 180 / Math.PI + 360) % 360;
}

/**
 * Turns along a CourseLine from official distance `from` on, of at least `min` degrees:
 * [{d, angle}] where angle is the change of direction, + = right (clockwise), - = left.
 * The marathon uses 60 (a closed course: only real turns), practice routes 35 (city
 * streets: a fork to bear left at matters too).
 */
export function findTurns(line, { from = 0, min = 35 } = {}) {
  const k = simplify(line, SIMPLIFY);
  const raw = [];
  for (let m = 1; m < k.length - 1; m++) {
    const a = k[m - 1], b = k[m], c = k[m + 1];
    const angle = angleDiff(bearing(line, a, b), bearing(line, b, c));
    if (Math.abs(angle) >= MIN_TURN) raw.push({ d: line.d[b], angle });
  }
  // corners the same way close together are one turn
  const turns = [];
  for (const t of raw) {
    const p = turns[turns.length - 1];
    if (p && Math.sign(p.angle) === Math.sign(t.angle) && t.d - p.d <= MERGE) {
      p.d = (p.d + t.d) / 2;
      p.angle = Math.max(-180, Math.min(180, p.angle + t.angle));
    } else turns.push({ ...t });
  }
  return turns.filter((t) => t.d > from && Math.abs(t.angle) >= min);
}

// "right", "left", "bear right", "sharp left", "U-turn to the right"
export function turnWords(angle) {
  const side = angle > 0 ? 'right' : 'left';
  const a = Math.abs(angle);
  if (a >= 150) return `U-turn to the ${side}`;
  if (a >= 120) return `sharp ${side}`;
  if (a < 60) return `bear ${side}`;
  return side;
}

// The first word of a call: "Turn right", "Bear left", "Turn sharp right", "U-turn to the left"
function lead(angle) {
  const w = turnWords(angle);
  if (w.startsWith('U-turn')) return w;
  if (w.startsWith('bear')) return `Bear ${w.slice(5)}`;
  return `Turn ${w}`;
}

// "then left", "then right again", "then bear left", "then a U-turn to the right"
function follow(prev, angle) {
  const w = turnWords(angle);
  if (w.startsWith('U-turn')) return `then a ${w}`;
  return `then ${w}${Math.sign(prev) === Math.sign(angle) ? ' again' : ''}`;
}

/**
 * What to say for turn i when `dist` metres before it, with the turns right after it that
 * come too close to be said on their own. Returns {text, last}: the index of the last turn
 * the call covers.
 */
export function turnCall(turns, i, dist) {
  let text = `${lead(turns[i].angle)} in ${Math.max(10, Math.round(dist / 10) * 10)} meters`;
  let last = i;
  while (last + 1 < turns.length && last - i < 2 && turns[last + 1].d - turns[last].d <= CHAIN) {
    text += `, ${follow(turns[last].angle, turns[last + 1].angle)}`;
    last++;
  }
  return { text: `${text}.`, last };
}

// The status line: "Turn right in 40 m", "U-turn in 30 m"
export function turnShort(angle, dist) {
  const w = turnWords(angle);
  const what = w.startsWith('U-turn') ? 'U-turn' : w.startsWith('bear') ? `Bear ${w.slice(5)}` : `Turn ${w}`;
  return `${what} in ${Math.max(10, Math.round(dist / 10) * 10)} m`;
}

// The calls along the way: at(d) is the call due at official distance d, or null. Each
// turn is said once, 50 m before it (with the ones right after it that come too close);
// never before the turn before it is behind you; turns already passed (a jump after a
// pause) are skipped.
export class TurnCaller {
  constructor(turns) { this.turns = turns; this.next = 0; }

  at(d) {
    const T = this.turns;
    while (this.next < T.length && T[this.next].d < d) this.next++;
    const i = this.next;
    if (i >= T.length || d < T[i].d - CALL_AT || (i > 0 && d < T[i - 1].d)) return null;
    const call = turnCall(T, i, T[i].d - d);
    this.next = call.last + 1;
    return { ...call, first: i };
  }
}
