// Synthetic runner + GPS, for tests and for the in-app replay.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gauss(rnd) {
  let u = 0, v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function tunnelDepth(course, d) {
  for (const [a, b] of course.tunnels) if (d >= a && d <= b) return Math.min(d - a, b - d);
  return -1;
}

/**
 * A simulated run along `course` following `plan` with some pace wobble.
 * Yields {fix, truth, tMs} every `dt` seconds of race time; fix is null when the phone
 * has no position (deep in a tunnel).
 *
 * opts:
 *   startMs     epoch ms when the runner crosses fromD
 *   fromD       official distance where the run starts (0 = start line)
 *   preStartS   seconds spent in the corral 25 m behind fromD before crossing it
 *   bias        +0.01 = runs 1 % slower than the plan on average
 *   wobble      amplitude of a 7-minute pace oscillation
 *   gpsSigma    GPS error (m), correlated over gpsTau seconds
 *   outlierRate share of fixes thrown 30-90 m off
 */
export function* simulate(course, plan, opts = {}) {
  const {
    startMs = Date.UTC(2026, 9, 4, 12, 0, 0), fromD = 0, dt = 1, seed = 1, gpsSigma = 4,
    gpsTau = 25, outlierRate = 0.01, bias = 0, wobble = 0.03, tunnels = true, preStartS = 0,
    lateral = 2.5, stopAt = null, speedFactor = null,
  } = opts;
  const rnd = mulberry32(seed);
  const line = course.line;
  const end = stopAt ?? course.total;
  const tPlan0 = plan.timeAt(fromD);
  const alpha = Math.exp(-dt / gpsTau);
  const beta = Math.sqrt(1 - alpha * alpha);
  let ex = 0, ey = 0, lat = 0, drift = 0;
  let sinceTunnel = 999;
  let d = fromD;
  for (let t = -preStartS; ; t += dt) {
    let dPos, v = 0;
    if (t < -8) dPos = fromD - 25;
    else if (t < 0) { dPos = fromD - 25 + ((t + 8) * 25) / 8; v = 25 / 8; }
    else {
      dPos = d;
      const planV = plan.speedAt(Math.min(d, course.total - 1));
      // mean-reverting pace drift: about ±1.5 %, remembered for ~10 minutes
      drift += -drift * (dt / 600) + 0.015 * Math.sqrt((2 * dt) / 600) * gauss(rnd);
      const k = speedFactor ? speedFactor(t, d) : (1 / (1 + bias)) * (1 + wobble * Math.sin((2 * Math.PI * t) / 420) + drift);
      v = planV * k;
    }
    ex = alpha * ex + beta * gpsSigma * gauss(rnd);
    ey = alpha * ey + beta * gpsSigma * gauss(rnd);
    lat += (gauss(rnd) * 0.3 - lat * 0.05) * dt;
    lat = Math.max(-lateral, Math.min(lateral, lat));
    const dClamped = Math.max(line.d0, Math.min(dPos, line.d1));
    const [x0, y0] = line.xyAt(dClamped);
    const b = (line.bearingAt(dClamped, 5, 5) * Math.PI) / 180;
    const x = x0 + Math.cos(b) * lat, y = y0 - Math.sin(b) * lat;
    let fix = null;
    const depth = tunnels ? tunnelDepth(course, dPos) : -1;
    if (depth > 15) {
      sinceTunnel = 0;
      if (rnd() < 0.08) {
        fix = { lat: line.proj.lat(y + 120 * gauss(rnd)), lon: line.proj.lon(x + 120 * gauss(rnd)), acc: 65 + 30 * rnd(), speed: -1 };
      }
    } else {
      sinceTunnel += dt;
      const reacq = sinceTunnel < 8 ? 3 : 1;
      let fx = x + ex * reacq, fy = y + ey * reacq;
      const acc = Math.max(3, gpsSigma * (0.9 + 0.4 * rnd()) * reacq);
      if (rnd() < outlierRate) {
        const ang = rnd() * 2 * Math.PI, r = 30 + 60 * rnd();
        fx += r * Math.cos(ang); fy += r * Math.sin(ang);
      }
      const speed = Math.max(0, v + gauss(rnd) * 0.25);
      fix = { lat: line.proj.lat(fy), lon: line.proj.lon(fx), acc, speed };
    }
    const tMs = startMs + t * 1000;
    const running = t >= 0;
    const truth = { d: dPos, t, gap: running ? t - (plan.timeAt(dPos) - tPlan0) : null };
    yield { fix: fix ? { ...fix, t: tMs } : null, truth, tMs };
    if (running) {
      if (d >= end) return;
      d = Math.min(end, d + v * dt);
    }
  }
}
