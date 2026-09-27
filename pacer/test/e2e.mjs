// End-to-end check in headless Chromium at iPhone 12 mini size (375 x 812).
// Usage: PLAYWRIGHT=/path/to/node_modules/playwright/index.mjs node pacer/test/e2e.mjs OUTDIR
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const pw = await import(process.env.PLAYWRIGHT || 'playwright');
const { chromium } = pw.default || pw;
const repo = fileURLToPath(new URL('../..', import.meta.url));
const out = process.argv[2] || 'e2e-out';
await mkdir(out, { recursive: true });

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.woff2': 'font/woff2', '.pbf': 'application/x-protobuf', '.pmtiles': 'application/octet-stream',
  '.bin': 'application/octet-stream', '.gpx': 'application/gpx+xml',
};
const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = normalize(join(repo, p));
    if (!file.startsWith(repo)) throw new Error('bad path');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});
await new Promise((r) => server.listen(8765, r));

const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
    '--autoplay-policy=no-user-gesture-required'],
});
const context = await browser.newContext({
  viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  geolocation: { latitude: 46.82655, longitude: -71.24935, accuracy: 5 },
  permissions: ['geolocation'],
});
// a canned forecast: wind from the north-east, about 20 km/h during the race
const forecast = { hourly: { time: [], wind_speed_10m: [], wind_direction_10m: [], wind_gusts_10m: [] } };
for (let h = 0; h < 24; h++) {
  forecast.hourly.time.push(`2026-10-04T${String(h).padStart(2, '0')}:00`);
  forecast.hourly.wind_speed_10m.push(18 + (h % 5));
  forecast.hourly.wind_direction_10m.push(40 + h);
  forecast.hourly.wind_gusts_10m.push(32);
}
let forecastCalls = 0;
await context.route('https://api.open-meteo.com/**', (route) => {
  forecastCalls++;
  route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(forecast) });
});
const page = await context.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

const shot = async (name) => { await page.screenshot({ path: join(out, `${name}.png`) }); console.log('shot', name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto('http://localhost:8765/pacer/');
await page.waitForSelector('#app.phase-ready', { timeout: 60000 });
await sleep(4000);
await shot('01-ready');

// every recorded voice clip decodes
const clipCheck = await page.evaluate(async () => {
  const ids = Object.keys(await (await fetch('voice/index.json')).json());
  const ctx = new OfflineAudioContext(1, 22050, 22050);
  const bad = [];
  let secs = 0;
  for (const id of ids) {
    try {
      const b = await ctx.decodeAudioData(await (await fetch(`voice/${id}.mp3`)).arrayBuffer());
      secs += b.duration;
      if (!(b.duration > 0.2 && b.duration < 4)) bad.push(`${id}:${b.duration}`);
    } catch (e) { bad.push(id); }
  }
  return { n: ids.length, bad, secs: Math.round(secs) };
});
console.log('voice clips:', JSON.stringify(clipCheck));
if (clipCheck.bad.length || clipCheck.n < 200) errors.push(`voice clips failed: ${clipCheck.bad.join(' ')}`);

// bars: the default plan shows on the map
await page.evaluate(() => { window.__pacer.S.follow = false; window.__pacer.S.map.overview(); });
await sleep(1500);
const barsShown = await page.evaluate(() => window.__pacer.S.map.map.queryRenderedFeatures({ layers: ['bars'] }).length);
console.log('bar markers on the overview:', barsShown);
if (barsShown < 4) errors.push('bar markers missing');
await page.evaluate(() => { window.__pacer.S.follow = true; window.__pacer.S.overviewShown = false; });

await page.click('[data-open="settings"]');
await sleep(500);
await shot('02-settings');
// bars typed in Settings, with a decimal comma
await page.fill('#set-bars', '8,1 15 24.4, 33');
await page.press('#set-bars', 'Enter');
await page.evaluate(() => document.querySelector('#set-bars').blur());
await sleep(300);
const barsSet = await page.evaluate(() => window.__pacer.S.settings.bars);
console.log('bars typed:', JSON.stringify(barsSet), '|', await page.textContent('#set-bars-note'));
if (JSON.stringify(barsSet) !== '[8.1,15,24.4,33]') errors.push('bars input');
// the wind forecast, on demand
await page.click('#set-wind-fc');
await sleep(800);
const windSet = await page.evaluate(() => ({ wind: window.__pacer.S.settings.wind, note: document.querySelector('#set-wind-fc-note').textContent }));
console.log('forecast wind:', JSON.stringify(windSet.wind), '|', windSet.note);
if (windSet.wind.fromDeg !== 45 || windSet.wind.kmh < 18 || windSet.wind.kmh > 22) errors.push('forecast wind not applied');
await page.evaluate(() => document.querySelector('#set-wind-fc').scrollIntoView({ block: 'center' }));
await sleep(200);
await shot('02c-settings-wind');
// ... and offered once on race morning, on the start screen
await page.click('#sheet-settings [data-close]');
await sleep(300);
await page.evaluate(() => {
  const { S } = window.__pacer;
  S.settings.wind = { fromDeg: 45, kmh: 0 }; S.settings.windSource = null; S.windTried = false;
  window.__pacer.maybeSuggestWind(S.marathon.gun - 3600e3); // 7:00 on race morning
});
await sleep(800);
const chipTxt = await page.evaluate(() => document.querySelector('#chips').textContent);
console.log('race-morning chip:', chipTxt);
if (!/Forecast wind: NE/.test(chipTxt)) errors.push('race-morning wind chip');
await page.click('[data-act="wind"]');
await sleep(300);
const windChip = await page.evaluate(() => window.__pacer.S.settings.wind);
if (windChip.kmh < 18) errors.push('wind chip did not apply');
console.log('forecast requests:', forecastCalls);
await shot('02d-wind-chip-used');
// back to still air for the simulated race below
await page.evaluate(() => { const { S } = window.__pacer; S.settings.wind = { fromDeg: 45, kmh: 0 }; S.settings.windSource = null; });
await page.click('[data-open="settings"]');
await sleep(400);
await page.evaluate(() => document.querySelector('#set-mix').scrollIntoView({ block: 'start' }));
await sleep(300);
await shot('02b-settings-voice');
await page.click('#sheet-settings [data-close]');
await page.click('[data-open="plan"]');
await sleep(500);
await shot('03-splits');
await page.click('#sheet-plan [data-close]');

await page.click('[data-open="practice"]');
await sleep(2500);
await shot('04-practice');
await page.click('#sheet-practice [data-close]');
await sleep(500);

// Simulated race at 60x (the Settings demo race): gun 20 s after start of sim
await page.evaluate(() => window.__pacer.startSim(60)); // the in-app demo race
const waitVirtual = async (el) => {
  for (let i = 0; i < 600; i++) {
    const v = await page.evaluate(() => {
      const { S, clock } = window.__pacer;
      return S.run ? (clock.now() - S.run.t0) / 1000 : null;
    });
    if (v !== null && v >= el) return v;
    await sleep(100);
  }
  return null;
};
await sleep(150);
await shot('05-countdown');
const spoken = [];
await page.evaluate(() => {
  const v = window.__pacer.S.voice;
  const say = v.say.bind(v);
  window.__spoken = [];
  window.__how = [];
  v.log = (t, how) => window.__how.push(how);
  v.say = (t, o) => { window.__spoken.push(t); say(t, o); };
});
const theme = (t) => page.evaluate((name) => {
  const b = document.querySelector(`#set-theme [data-theme="${name}"]`) || null;
  if (b) b.click();
}, t);
for (const [el, name, th] of [[240, '06-km1'], [1500, '07-km6'], [2745, '08-tunnel'], [3130, '09-climb', 'amber'], [6400, '10-champlain', 'ice'], [9000, '11-km36', 'signal']]) {
  if (th) {
    // switch colours the way the Settings sheet does
    await page.evaluate(() => window.__pacer.openSheet('settings'));
    await theme(th);
    await page.evaluate(() => document.querySelector('#sheet-settings [data-close]').click());
  }
  const v = await waitVirtual(el);
  const info = await page.evaluate(() => {
    const { S, clock } = window.__pacer;
    const now = clock.now();
    const est = S.tracker && S.tracker.tracking ? S.tracker.peek(now) : null;
    return { d: est && est.d, mode: est && est.mode, gap: S.gap.state(), badge: document.querySelector('#badges').textContent, status: document.querySelector('#status-line').textContent };
  });
  console.log(name, Math.round(v), JSON.stringify(info));
  await shot(name);
}
// a short press on ••• does nothing; a 5 s hold opens the run menu
const box = await page.locator('#info').boundingBox();
await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2);
await page.mouse.down();
await sleep(1500);
await shot('12a-holding');
await page.mouse.up();
await sleep(200);
if (!(await page.locator('#sheet-menu').isHidden())) errors.push('menu opened after 1.5 s');
await page.mouse.down();
await sleep(5400);
await page.mouse.up();
await sleep(400);
if (await page.locator('#sheet-menu').isHidden()) errors.push('menu did not open after a 5 s hold');
await shot('12-run-menu');
// pocket mode from the menu: black screen, the loop keeps running
await page.click('#menu-pocket [data-pocket="1"]');
await sleep(800);
await shot('12b-pocket');
if (await page.locator('#pocket').isHidden()) errors.push('pocket mode did not show');
await page.click('#pocket');
await sleep(600);
if (!(await page.locator('#pocket').isHidden())) errors.push('pocket peek did not show the screen');
await page.evaluate(() => { const { S } = window.__pacer; S.settings.pocket = false; S.lastPanel = {}; });
// the phone was locked for 30 s (iOS froze the page): on unlock the app catches up and
// says the gap as soon as GPS has placed the runner again
const saidBefore = await page.evaluate(() => window.__spoken.length);
await page.evaluate(() => {
  const setVis = (v) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v }); Object.defineProperty(document, 'hidden', { configurable: true, get: () => v === 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); };
  setVis('hidden');
  window.__pacer.S.hiddenAt = Date.now() - 30000;
  setVis('visible');
});
await sleep(300);
const toastTxt = await page.textContent('#toast');
await sleep(1500);
const caught = await page.evaluate((n) => ({ said: window.__spoken.slice(n), resume: window.__pacer.S.resume }), saidBefore);
console.log('after unlock:', toastTxt, JSON.stringify(caught));
if (!/paused/.test(toastTxt) || !caught.said.some((t) => /seconds? (behind|ahead)$|on pace$/.test(t)) || caught.resume) errors.push('no catch-up after unlock');
const fin = await waitVirtual(10900);
await sleep(1500);
await shot('13-finish');
spoken.push(...(await page.evaluate(() => window.__spoken)));
const how = await page.evaluate(() => window.__how);
console.log('voice said', spoken.length, 'times, e.g.', JSON.stringify(spoken.slice(0, 6)), '| bars:', spoken.filter((t) => /bar/.test(t)).length,
  '| recorded clips', how.filter((h) => h === 'clips').length, 'iPhone voice', how.filter((h) => h === 'speech').length);
// default voice: only when off pace (10 s or more), and "On pace." when back
const gapsSaid = spoken.map((t) => /(\d+) seconds? (behind|ahead)/.exec(t)).filter(Boolean).map((m) => Number(m[1]));
console.log('off-pace voice said gaps:', JSON.stringify(gapsSaid), '| on pace:', spoken.filter((t) => /^On pace/.test(t)).length);
if (!gapsSaid.length) errors.push('voice never said the gap');
if (gapsSaid.some((g) => g < 10) && !spoken.some((t) => /unlock|paused/.test(t))) {
  // (the catch-up after the fake screen lock says the gap whatever it is)
  const small = spoken.filter((t) => /(\d+) seconds? (behind|ahead)/.test(t) && Number(/(\d+)/.exec(t)[1]) < 10);
  if (small.length > 1) errors.push(`off-pace voice spoke inside 10 s: ${small.join(' | ')}`);
}
if (spoken.filter((t) => /Time for a bar/.test(t)).length !== 4) errors.push('bar cues');
if (how.filter((h) => h === 'clips').length < 5) errors.push('recorded clips not used');
const finRow = await page.evaluate(() => JSON.stringify(window.__pacer.S.run && window.__pacer.S.run.finish));
if (!(JSON.parse(finRow).elapsed < 10800)) errors.push('demo race did not finish under 3:00');
console.log('finish at virtual', fin, await page.evaluate(() => JSON.stringify(window.__pacer.S.run && window.__pacer.S.run.finish)));

// ---- practice from a home in Sainte-Foy to DKN and back, simulated at 30x
const ctx2 = await browser.newContext({
  viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  geolocation: { latitude: 46.7771, longitude: -71.2990, accuracy: 6 }, permissions: ['geolocation'],
});
const p2 = await ctx2.newPage();
p2.on('pageerror', (e) => errors.push(String(e)));
await p2.goto('http://localhost:8765/pacer/');
await p2.waitForSelector('#app.phase-ready', { timeout: 60000 });
await sleep(3000);
await p2.screenshot({ path: join(out, '20-ready-home.png') });
await p2.click('[data-open="practice"]');
await sleep(3000);
await p2.screenshot({ path: join(out, '21-practice-route.png') });
const info2 = await p2.textContent('#pr-info');
console.log('practice route:', info2);
await p2.evaluate(() => {
  const { S } = window.__pacer;
  S.settings.voiceMode = 'every'; S.settings.voiceEvery = 250; // the other voice mode
  const v = S.voice; const say = v.say.bind(v);
  window.__spoken2 = []; v.say = (t, o) => { window.__spoken2.push(t); say(t, o); };
  window.__pacer.startSim(30, { practiceSpec: S.practiceDraft.spec, seed: 7 });
});
const waitV2 = async (el) => {
  for (let i = 0; i < 900; i++) {
    const v = await p2.evaluate(() => { const { S, clock } = window.__pacer; return S.run ? (clock.now() - S.run.t0) / 1000 : null; });
    if (v !== null && v >= el) return v;
    await sleep(100);
  }
  return null;
};
for (const [el, name] of [[120, '22-practice-2min'], [800, '23-practice-turn']]) {
  await waitV2(el);
  await p2.screenshot({ path: join(out, `${name}.png`) });
  console.log('shot', name);
}
for (let i = 0; i < 600; i++) {
  const done = await p2.evaluate(() => !!(window.__pacer.S.run && window.__pacer.S.run.finish));
  if (done) break;
  await sleep(200);
}
await sleep(800);
await p2.screenshot({ path: join(out, '24-practice-finish.png') });
console.log('practice finish', await p2.evaluate(() => JSON.stringify(window.__pacer.S.run && window.__pacer.S.run.finish)));
const every250 = await p2.evaluate(() => window.__spoken2.filter((t) => /seconds? (behind|ahead)|On pace|on pace/.test(t)).length);
console.log('voice every 250 m on the 5.2 km practice:', every250, 'times');
if (every250 < 15) errors.push('voice every 250 m');

// ---- LIVE rehearsal on the same route: countdown, "Go!", then chip time at the start line
await p2.evaluate(() => { window.__pacer.stopRun(); });
await sleep(500);
// a fresh fix, as a real phone gives every second (the emulator repeats the old one)
await ctx2.setGeolocation({ latitude: 46.77711, longitude: -71.29901, accuracy: 6 });
await sleep(500);
await p2.click('[data-open="practice"]');
for (let i = 0; i < 100; i++) {
  if (await p2.evaluate(() => !!(window.__pacer.S.practiceDraft && window.__pacer.S.practiceDraft.spec))) break;
  await sleep(200);
}
await p2.screenshot({ path: join(out, '24b-practice-sheet.png') });
await p2.evaluate(() => {
  const v = window.__pacer.S.voice; const say = v.say.bind(v);
  window.__spoken = []; v.say = (t, o) => { window.__spoken.push(t); say(t, o); };
  window.__pacer.startSim(10, { practiceSpec: window.__pacer.S.practiceDraft.spec, live: true, seed: 11 });
});
await sleep(400);
await p2.screenshot({ path: join(out, '25-rehearsal-countdown.png') });
let rehearsal = null;
for (let i = 0; i < 150; i++) {
  rehearsal = await p2.evaluate(() => { const { S } = window.__pacer; return { src: S.run.t0Source, t0: S.run.t0, cross: S.sim.crossAt, gun: S.run.gunMs, said: window.__spoken, badge: document.querySelector('#badges').textContent }; });
  if (rehearsal.src === 'chip') break;
  await sleep(200);
}
await sleep(300);
await p2.screenshot({ path: join(out, '26-rehearsal-chip.png') });
console.log('LIVE rehearsal:', rehearsal.src, 'chip vs true crossing', ((rehearsal.t0 - rehearsal.cross) / 1000).toFixed(2), 's, gun +', ((rehearsal.cross - rehearsal.gun) / 1000).toFixed(1), 's |', rehearsal.badge, '|', JSON.stringify(rehearsal.said));
if (rehearsal.src !== 'chip' || Math.abs(rehearsal.t0 - rehearsal.cross) > 2000) errors.push('LIVE rehearsal chip time');
if (!rehearsal.said.includes('Go!') || !rehearsal.said.includes('Chip time.')) errors.push('LIVE rehearsal voice');

// ---- a real run survives a page reload
const ctx3 = await browser.newContext({
  viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  geolocation: { latitude: 46.82637, longitude: -71.24905, accuracy: 5 }, permissions: ['geolocation'],
});
const p3 = await ctx3.newPage();
p3.on('pageerror', (e) => errors.push(String(e)));
await p3.goto('http://localhost:8765/pacer/');
await p3.waitForSelector('#app.phase-ready', { timeout: 60000 });
await sleep(1500);
await p3.click('#btn-start');
await sleep(500);
const t0 = await p3.evaluate(() => window.__pacer.S.run.t0);
// feed 20 s of running along the course from the start line at 4 m/s
for (let i = 0; i <= 20; i++) {
  await p3.evaluate((dm) => {
    const { S, handleFix } = window.__pacer;
    const [lat, lon] = S.course.line.latLonAt(dm);
    handleFix({ t: Date.now(), lat, lon, acc: 5, speed: 4 });
  }, i * 4);
  await sleep(1000);
}
const before = await p3.evaluate(() => { const { S, clock } = window.__pacer; return S.tracker.peek(clock.now()).d; });
// the phone's own GPS now reports where the runner is (84 m past the line)
const here = await p3.evaluate(() => window.__pacer.S.course.line.latLonAt(84));
await ctx3.setGeolocation({ latitude: here[0], longitude: here[1], accuracy: 5 });
await p3.reload();
await p3.waitForSelector('#app.phase-running', { timeout: 60000 });
await sleep(800);
const after = await p3.evaluate(async () => {
  const { S, handleFix, clock } = window.__pacer;
  const [lat, lon] = S.course.line.latLonAt(92);
  handleFix({ t: Date.now(), lat, lon, acc: 5, speed: 4 });
  const est = S.tracker.peek(clock.now());
  return { t0: S.run.t0, d: est && est.d, phase: S.phase };
});
console.log('reload test: t0 kept', after.t0 === t0, 'd before', before.toFixed(1), 'after', after.d && after.d.toFixed(1), after.phase);
await p3.screenshot({ path: join(out, '30-resumed.png') });
if (after.t0 !== t0 || !(Math.abs(after.d - 92) < 25)) errors.push('reload/resume failed');

// ---- works with no network after the first visit
await ctx3.setOffline(true);
await p3.reload();
await p3.waitForSelector('#app.phase-running', { timeout: 60000 });
await sleep(2500);
const offlineOk = await p3.evaluate(() => window.__pacer.S.mapReady && !!window.__pacer.S.marathon);
console.log('offline reload: map', offlineOk);
await p3.screenshot({ path: join(out, '31-offline.png') });
if (!offlineOk) errors.push('offline reload failed');

console.log('console errors:', errors.length ? errors : 'none');
await browser.close();
server.close();
