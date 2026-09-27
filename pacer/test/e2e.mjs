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
// at the start line: START and the bar before the start both show
const atStart = await page.evaluate(() => window.__pacer.S.map.map.queryRenderedFeatures({ layers: ['ends', 'bars'] }).map((f) => f.properties.label || (f.properties.pre ? 'pre-start bar' : 'bar')));
console.log('at the start line:', JSON.stringify(atStart));
if (!atStart.includes('START') || !atStart.includes('pre-start bar')) errors.push('START label or pre-start bar hidden');


// bars: the default plan shows on the map
await page.evaluate(() => { window.__pacer.S.follow = false; window.__pacer.S.map.overview(); });
await sleep(1500);
const barsShown = await page.evaluate(() => {
  const m = window.__pacer.S.map.map;
  const f = m.queryRenderedFeatures({ layers: ['bars'] });
  return { n: f.length, pre: f.filter((x) => x.properties.pre).length, caf: f.filter((x) => x.properties.caf).length, images: ['caf-pill', 'reg-pill'].every((id) => m.hasImage(id)) };
});
console.log('bar markers on the overview:', JSON.stringify(barsShown));
if (barsShown.n !== 5 || barsShown.pre !== 1 || barsShown.caf !== 3 || !barsShown.images) errors.push('bar markers missing');
// the bar before the start, on the start screen
const preTxt = await page.evaluate(() => { const e = document.querySelector('#rt-fuel'); return e.hidden ? null : e.textContent; });
console.log('start screen reminder:', preTxt);
if (!/^CAF bar at 7:20/.test(preTxt || '')) errors.push('pre-start bar reminder');
await page.evaluate(() => { window.__pacer.S.follow = true; window.__pacer.S.overviewShown = false; });

await page.click('[data-open="check"]');
await sleep(400);
const readyCheck = await page.evaluate(() => ({ rows: document.querySelectorAll('#check-body .chk').length, text: document.querySelector('#check-body').textContent }));
console.log('pre-race check (start screen):', readyCheck.rows, 'rows |', readyCheck.text.slice(0, 200));
await shot('02a-check');
if (readyCheck.rows < 7 || !/Phone time/.test(readyCheck.text) || !/LIVE/.test(readyCheck.text) || !/CAF 21\.9/.test(readyCheck.text)) errors.push('pre-race check');
await page.click('#sheet-check [data-close]');
await sleep(300);
await page.click('[data-open="settings"]');
await sleep(500);
await shot('02-settings');
// bars typed in Settings, with a decimal comma
await page.fill('#set-bars', '8,1 15c 24.4, 33');
await page.press('#set-bars', 'Enter');
await page.evaluate(() => document.querySelector('#set-bars').blur());
await sleep(300);
const barsSet = await page.evaluate(() => window.__pacer.S.settings.bars);
console.log('bars typed:', JSON.stringify(barsSet), '|', await page.textContent('#set-bars-note'));
if (JSON.stringify(barsSet) !== '[{"km":8.1,"caf":false},{"km":15,"caf":true},{"km":24.4,"caf":false},{"km":33,"caf":false}]') errors.push('bars input');
const planTxt = await page.textContent('#set-bars-list');
if (!/water at 8\.4 is only 300 m on: make it 7\.4/.test(planTxt)) errors.push('fuel plan: 1 km check');
// back to the suggested plan
await page.click('#set-bars-suggest');
await sleep(200);
const barsBack = await page.evaluate(() => ({ bars: window.__pacer.S.settings.bars, list: document.querySelector('#set-bars-list').textContent }));
console.log('suggested plan:', barsBack.list);
if (JSON.stringify(barsBack.bars.map((b) => b.km)) !== '[4.8,10.1,21.9,31.9]' || /make it|close to|uphill|tunnel|no aid/.test(barsBack.list)) errors.push('suggested fuel plan');
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
await page.evaluate(() => document.querySelector('#set-vmode').scrollIntoView({ block: 'start' }));
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

// before the gun the ghost waits on the start line (official km 0), where the white bar is:
// a demo race at 4x, looked at during its 20 s countdown (5 s here), then stopped
await page.evaluate(() => { const v = window.__pacer.S.voice; const say = v.say.bind(v); window.__cd = []; v.say = (t, o) => { window.__cd.push(t); say(t, o); }; });
await page.evaluate(() => window.__pacer.startSim(4, { seed: 3 }));
await sleep(1500);
const waiting = await page.evaluate(() => {
  const { S, clock } = window.__pacer;
  const g = S.map.ghost;
  const ll = g.shown ? g.marker.getLngLat() : null;
  const [la, lo] = S.course.line.latLonAt(0);
  return { el: (clock.now() - S.run.t0) / 1000, off: ll ? Math.hypot((ll.lat - la) * 111320, (ll.lng - lo) * 111320 * Math.cos(la * Math.PI / 180)) : null,
    bars: (S.map.endbars || []).length };
});
console.log('ghost before the gun:', JSON.stringify(waiting));
if (!(waiting.el < 0) || waiting.off === null || waiting.off > 0.5 || waiting.bars !== 2) errors.push('ghost not waiting on the start line');
// ... the voice counts down to the gun, and the pre-race check is one tap away
const cdChip = await page.evaluate(() => !!document.querySelector('[data-act="check"]'));
await page.click('[data-act="check"]');
await sleep(400);
const cdCheck = await page.evaluate(() => document.querySelector('#check-body').textContent);
await shot('05b-check-live');
await page.evaluate(() => document.querySelector('#sheet-check [data-close]').click());
await sleep(3500);
const cdSaid = await page.evaluate(() => window.__cd);
console.log('countdown said:', JSON.stringify(cdSaid), '| check chip', cdChip, '|', cdCheck.slice(0, 160));
if (!cdSaid.includes('Live mode. The gun is at 8 a.m. exactly.') || !cdSaid.includes('Start in 15 seconds.') || !cdSaid.includes('Gun time: 8 a.m. exactly.') || !cdChip || !/LIVE is on/.test(cdCheck) || !/Phone time/.test(cdCheck)) errors.push('LIVE countdown / pre-race check');
await page.evaluate(() => window.__pacer.stopRun());
await sleep(500);

// Simulated race at 60x (the Settings demo race): gun 20 s after start of sim
await page.evaluate(() => window.__pacer.startSim(60, { seed: 400, bias: -0.003 })); // a fixed demo race (the app's is random)
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
  // every text the status line shows
  window.__status = new Set();
  const st = document.querySelector('#status-line');
  new MutationObserver(() => window.__status.add(st.textContent)).observe(st, { childList: true, characterData: true, subtree: true });
});
const theme = (t) => page.evaluate((name) => {
  const b = document.querySelector(`#set-theme [data-theme="${name}"]`) || null;
  if (b) b.click();
}, t);
for (const [el, name, th] of [[240, '06-km1'], [1500, '07-km6'], [2745, '08-tunnel'], [3130, '09-climb', 'amber'], [6400, '10-champlain', 'mono'], [9000, '11-km36', 'amber']]) {
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
// the top-right label says how and when the clock started, to the second
const clockLbl = await page.evaluate(() => {
  const { S } = window.__pacer;
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', hour: 'numeric', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(S.run.t0));
  const g = (t) => p.find((x) => x.type === t).value;
  return { badge: document.querySelector('#badges').textContent, want: `${Number(g('hour'))}:${g('minute')}:${g('second')}`, src: S.run.t0Source };
});
console.log('clock label:', JSON.stringify(clockLbl));
if (!clockLbl.badge.includes(`LIVE · CHIP ${clockLbl.want}`)) errors.push('start time label');
// the menu handle is a gear, no text
const handle = await page.evaluate(() => { const h = document.querySelector('#menu-handle'); return { svg: !!h.querySelector('svg path'), text: h.textContent.trim() }; });
if (!handle.svg || handle.text) errors.push('menu handle is not a gear');
// a short press on the gear does nothing; a 5 s hold opens the run menu
const box = await page.locator('#info').boundingBox();
await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2);
await page.mouse.down();
await sleep(1500);
await shot('12a-holding');
const holding = await page.evaluate(() => { const f = document.querySelector('#holdfx'); const r = f.getBoundingClientRect(); return { shown: !f.hidden, h: r.height, w: r.width, title: f.querySelector('.hf-title').textContent, n: f.querySelector('.hf-count').textContent, p: Number(getComputedStyle(f).getPropertyValue('--p')) }; });
console.log('holding the gear 1.5 s:', JSON.stringify(holding));
if (!holding.shown || holding.h < 800 || holding.w < 370 || holding.title !== 'Settings' || holding.n !== '4' || !(holding.p > 0.2 && holding.p < 0.4)) errors.push(`menu hold fill: ${JSON.stringify(holding)}`);
await page.mouse.up();
await sleep(200);
if (!(await page.locator('#sheet-menu').isHidden())) errors.push('menu opened after 1.5 s');
if (!(await page.locator('#holdfx').isHidden())) errors.push('hold fill stayed after letting go');
await page.mouse.down();
await sleep(5400);
await page.mouse.up();
await sleep(400);
if (await page.locator('#sheet-menu').isHidden()) errors.push('menu did not open after a 5 s hold');
await shot('12-run-menu');
// scrolling the menu with a finger that starts on "−5 s" must scroll, not nudge the clock
{
  const cdp = await context.newCDPSession(page);
  const before = await page.evaluate(() => ({ t0: window.__pacer.S.run.t0, src: window.__pacer.S.run.t0Source, crossing: window.__pacer.S.run.crossing }));
  const nb = await page.locator('#sheet-menu [data-nudge="-5"]').boundingBox();
  const x = nb.x + nb.width / 2, y0 = nb.y + nb.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
  for (let i = 1; i <= 13; i++) { await sleep(100); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 - i * 12 }] }); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(300);
  const after = await page.evaluate(() => window.__pacer.S.run.t0);
  if (after !== before.t0) errors.push(`scrolling the menu nudged the clock by ${(after - before.t0) / 1000} s`);
  // a deliberate still hold on "+1 s" still works, and the menu says what it moved from
  await page.evaluate(() => { document.querySelector('#sheet-menu .sheet-body').scrollTop = 0; });
  const pb = await page.locator('#sheet-menu [data-nudge="1"]').boundingBox();
  await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
  await page.mouse.down(); await sleep(1300); await page.mouse.up();
  await sleep(300);
  const nudged = await page.evaluate(() => ({ t0: window.__pacer.S.run.t0, src: window.__pacer.S.run.t0Source, summary: document.querySelector('#menu-summary').textContent }));
  console.log('nudge +1 s:', ((nudged.t0 - before.t0) / 1000), 's |', nudged.summary);
  if (nudged.t0 - before.t0 !== 1000 || nudged.src !== 'adjusted' || !/1 s after your start-line crossing/.test(nudged.summary)) errors.push('nudge +1 s');
  // and back to the start-line crossing
  const cb = await page.locator('#sheet-menu [data-sync="crossing"]').boundingBox();
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await page.mouse.down(); await sleep(1300); await page.mouse.up();
  await sleep(300);
  const back = await page.evaluate(() => ({ t0: window.__pacer.S.run.t0, src: window.__pacer.S.run.t0Source }));
  if (back.src !== 'chip' || back.t0 !== before.crossing) errors.push('back to the crossing');
}
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
const caught = await page.evaluate((n) => ({ said: window.__spoken.slice(n), resume: window.__pacer.S.resume, up: window.__pacer.S.caughtUp }), saidBefore);
console.log('after unlock:', toastTxt, JSON.stringify(caught));
// it catches up; when off pace it says the gap only from 10 s (or "On pace." after a warning)
const upOk = caught.up && (Math.abs(caught.up.gap) >= 5 ? /seconds? (behind|ahead)$/.test(caught.up.said || '') : !caught.up.said || caught.up.said === 'On pace.');
if (!/paused/.test(toastTxt) || caught.resume || !upOk) errors.push(`catch-up after unlock: ${JSON.stringify(caught)}`);
const fin = await waitVirtual(10900);
await sleep(1500);
await shot('13-finish');
spoken.push(...(await page.evaluate(() => window.__spoken)));
const how = await page.evaluate(() => window.__how);
console.log('voice said', spoken.length, 'times, e.g.', JSON.stringify(spoken.slice(0, 6)), '| bars:', spoken.filter((t) => /bar/.test(t)).length,
  '| iPhone voice', how.filter((h) => h === 'speech').length);
// default voice: only when off pace (10 s or more), both ways, "On pace." at the ghost
const gapsSaid = spoken.map((t) => /(\d+) seconds? (behind|ahead)/.exec(t)).filter(Boolean).map((m) => Number(m[1]));
console.log('off-pace voice said gaps:', JSON.stringify(gapsSaid), '| on pace:', spoken.filter((t) => /^On pace/.test(t)).length);
if (!gapsSaid.length) errors.push('voice never said the gap');
// "On pace." only after a warning, once per warning
{
  let pending = false;
  for (const t of spoken) {
    if (/(\d+) seconds? (behind|ahead)/.test(t)) pending = true;
    if (/On pace\./.test(t)) { if (!pending) errors.push('"On pace" without a warning before it'); pending = false; }
  }
}
if (gapsSaid.some((g) => g < 5)) errors.push(`off-pace voice spoke inside 5 s: ${JSON.stringify(gapsSaid)}`);
// bars 1 km before water, every aid station 200 m before it
const nSaid = (re) => spoken.filter((t) => re.test(t)).length;
console.log('fuel calls: CAF', nSaid(/Take caffeinated bar/), 'REG', nSaid(/Take regular bar/), 'water', nSaid(/Water in 200 meters/), 'gel', nSaid(/Gel in 200 meters/));
if (nSaid(/Take caffeinated bar/) !== 2 || nSaid(/Take regular bar/) !== 2) errors.push('bar calls');
if (nSaid(/Water in 200 meters/) !== 13 || nSaid(/Gel in 200 meters/) !== 2) errors.push('water calls');
const statuses = await page.evaluate(() => [...window.__status]);
for (const re of [/^REG bar in \d+ m$/, /^CAF bar now$/, /^Water in \d+ m$/, /^Gel in \d+ m$/, /^Water: now$/]) {
  if (!statuses.some((t) => re.test(t))) errors.push(`status line never showed ${re}`);
}
if (how.length < 20 || how.some((h) => h !== 'speech')) errors.push('not all spoken in the iPhone voice');
const finRow = await page.evaluate(() => JSON.stringify(window.__pacer.S.run && window.__pacer.S.run.finish));
if (!(JSON.parse(finRow).elapsed < 10800)) errors.push('demo race did not finish under 3:00');
console.log('finish at virtual', fin, await page.evaluate(() => JSON.stringify(window.__pacer.S.run && window.__pacer.S.run.finish)));

// ---- practice from Sommet 3V to DKN, one way, simulated at 30x, with a wrong turn
const ctx2 = await browser.newContext({
  viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  geolocation: { latitude: 46.77224, longitude: -71.29908, accuracy: 6 }, permissions: ['geolocation'],
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
const routes = await p2.evaluate(() => [...document.querySelectorAll('#pr-route button')].map((b) => `${b.textContent}${b.classList.contains('on') ? ' (on)' : ''}`));
console.log('practice routes:', JSON.stringify(routes), '|', info2);
if (JSON.stringify(routes) !== '["Sommet → DKN (on)","DKN → Sommet"]' || !/^2\.\d\d km one way, Sommet 3V/.test(info2) || /from the start/.test(info2)) errors.push('practice routes');
// the other way starts at DKN, 2 km from here: it says so
await p2.click('#pr-route [data-route="dkn-home"]');
await sleep(600);
const info2b = await p2.textContent('#pr-info');
await p2.screenshot({ path: join(out, '21b-practice-other-way.png') });
console.log('the other way:', info2b);
if (!/one way, Pavillon Charles-De Koninck/.test(info2b) || !/You are 2\.\d km from the start, DKN\./.test(info2b)) errors.push('practice route from DKN');
await p2.click('#pr-route [data-route="home-dkn"]');
await sleep(600);
await p2.evaluate(() => {
  const { S } = window.__pacer;
  S.settings.voiceMode = 'every'; S.settings.voiceEvery = 250; // the other voice mode
  const v = S.voice; const say = v.say.bind(v);
  window.__spoken2 = []; v.say = (t, o) => { window.__spoken2.push(t); say(t, o); };
  window.__words2 = new Set();
  const w = document.querySelector('#gap-word');
  new MutationObserver(() => window.__words2.add(w.textContent)).observe(w, { childList: true, characterData: true, subtree: true });
  // a wrong turn: 90 m off the route from 1.2 to 1.7 km
  window.__pacer.startSim(30, { practiceSpec: S.practiceDraft.spec, seed: 7, detour: { from: 1200, to: 1700, off: 90 } });
});
const waitV2 = async (el) => {
  for (let i = 0; i < 900; i++) {
    const v = await p2.evaluate(() => { const { S, clock } = window.__pacer; return S.run ? (clock.now() - S.run.t0) / 1000 : null; });
    if (v !== null && v >= el) return v;
    await sleep(100);
  }
  return null;
};
for (const [el, name] of [[120, '22-practice-2min']]) {
  await waitV2(el);
  await p2.screenshot({ path: join(out, `${name}.png`) });
  console.log('shot', name);
}
for (let i = 0; i < 300; i++) {
  if (await p2.evaluate(() => !!window.__pacer.S.offNow)) break;
  await sleep(100);
}
await sleep(700);
const offShown = await p2.evaluate(() => ({ word: document.querySelector('#gap-word').textContent, num: document.querySelector('#gap-num').textContent, status: document.querySelector('#status-line').textContent }));
await p2.screenshot({ path: join(out, '23-practice-off-course.png') });
console.log('off course:', JSON.stringify(offShown));
for (let i = 0; i < 600; i++) {
  const done = await p2.evaluate(() => !!(window.__pacer.S.run && window.__pacer.S.run.finish));
  if (done) break;
  await sleep(200);
}
await sleep(800);
await p2.screenshot({ path: join(out, '24-practice-finish.png') });
console.log('practice finish', await p2.evaluate(() => JSON.stringify(window.__pacer.S.run && window.__pacer.S.run.finish)));
const every250 = await p2.evaluate(() => window.__spoken2.filter((t) => /seconds? (behind|ahead)|On pace|on pace/.test(t)).length);
const offSaid = await p2.evaluate(() => window.__spoken2.filter((t) => /course/.test(t)));
const words2 = await p2.evaluate(() => [...window.__words2]);
console.log('voice every 250 m on the 2.8 km practice:', every250, 'times | off course:', JSON.stringify(offSaid), '| words shown:', JSON.stringify(words2));
if (every250 < 7) errors.push('voice every 250 m');
if (offShown.word !== 'OFF COURSE' || !/^\d+ m$/.test(offShown.num) || offShown.status !== 'No gap until you are back on the course') errors.push(`off course display: ${JSON.stringify(offShown)}`);
if (offSaid.length !== 2 || !/^Off course: \d+ meters from the course\.$/.test(offSaid[0]) || !/^Back on course\./.test(offSaid[1])) errors.push(`off course voice: ${JSON.stringify(offSaid)}`);

// ---- LIVE rehearsal on the same route: countdown, "Go!", then chip time at the start line
await p2.evaluate(() => { window.__pacer.stopRun(); });
await sleep(500);
// a fresh fix, as a real phone gives every second (the emulator repeats the old one)
await ctx2.setGeolocation({ latitude: 46.77227, longitude: -71.29904, accuracy: 6 });
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
  window.__pacer.startSim(6, { practiceSpec: window.__pacer.S.practiceDraft.spec, live: true, seed: 11 });
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
if (!rehearsal.said.includes('Go!') || !rehearsal.said.some((t) => /^Chip time: \d{1,2}(:\d\d)? (a|p)\.m\. (and \d+ seconds?|exactly)\.$/.test(t))) errors.push('LIVE rehearsal voice');
// pocket mode on the rehearsal: a look (tap), the run settings held open, then black again
await p2.evaluate(() => { const { S } = window.__pacer; S.settings.pocket = true; S.peekUntil = 0; S.lastPanel = {}; });
await sleep(700);
await p2.click('#pocket');
await sleep(500);
// looking (a tap), then holding the gear: the run settings open; when the screen goes black
// again they close, so a touch in the pocket cannot land on them
await sleep(300);
{
  const ib = await p2.locator('#info').boundingBox();
  await p2.mouse.move(ib.x + ib.width - 20, ib.y + ib.height / 2);
  await p2.mouse.down(); await sleep(5300); await p2.mouse.up();
  await sleep(300);
  const opened = await p2.evaluate(() => !document.querySelector('#sheet-menu').hidden && document.querySelector('#pocket').hidden);
  await p2.evaluate(() => { window.__pacer.S.peekUntil = 0; }); // the look is over
  await sleep(900);
  const black = await p2.evaluate(() => ({ menu: !document.querySelector('#sheet-menu').hidden, pocket: !document.querySelector('#pocket').hidden, scrim: !document.querySelector('#scrim').hidden }));
  console.log('pocket: menu open while looking', opened, '| black again:', JSON.stringify(black));
  if (!opened || black.menu || !black.pocket || black.scrim) errors.push(`pocket did not close the menu: ${JSON.stringify(black)}`);
}
await p2.evaluate(() => { const { S } = window.__pacer; S.settings.pocket = false; S.lastPanel = {}; });
await sleep(500);
// holding the map 5 s unlocks it: no following, flat, north up, draggable; ◎ locks it again
{
  const mb = await p2.locator('#map').boundingBox();
  await p2.mouse.move(mb.x + mb.width / 2, mb.y + mb.height * 0.4);
  await p2.mouse.down(); await sleep(1500);
  const mh = await p2.evaluate(() => { const f = document.querySelector('#holdfx'); return { shown: !f.hidden, title: f.querySelector('.hf-title').textContent, n: f.querySelector('.hf-count').textContent }; });
  await p2.screenshot({ path: join(out, '26b-map-holding.png') });
  await sleep(3800); await p2.mouse.up();
  await sleep(900);
  const fm = await p2.evaluate(() => { const { S } = window.__pacer; const m = S.map.map; return { free: S.freeMap, pitch: m.getPitch(), bearing: m.getBearing(), drag: m.dragPan.isEnabled(), recenter: !document.querySelector('#btn-recenter').hidden, head: !document.querySelector('#map-head').hidden && document.querySelector('#map-close').textContent, chips: getComputedStyle(document.querySelector('#chips')).visibility }; });
  const c0 = await p2.evaluate(() => window.__pacer.S.map.map.getCenter());
  await p2.mouse.move(mb.x + mb.width / 2, mb.y + mb.height * 0.5);
  await p2.mouse.down();
  for (let i = 1; i <= 8; i++) { await p2.mouse.move(mb.x + mb.width / 2 + i * 15, mb.y + mb.height * 0.5 + i * 10); await sleep(30); }
  await p2.mouse.up();
  await sleep(1500);
  const c1 = await p2.evaluate(() => window.__pacer.S.map.map.getCenter());
  const moved = Math.hypot((c1.lat - c0.lat) * 111320, (c1.lng - c0.lng) * 76000);
  await p2.screenshot({ path: join(out, '26c-free-map.png') });
  console.log('map hold:', JSON.stringify(mh), '| free map:', JSON.stringify(fm), '| dragged', moved.toFixed(0), 'm and it stayed');
  if (!mh.shown || mh.title !== 'Map' || mh.n !== '4') errors.push(`map hold fill: ${JSON.stringify(mh)}`);
  if (!fm.free || fm.pitch > 1 || Math.abs(fm.bearing) > 1 || !fm.drag || !fm.recenter || fm.head !== 'Close' || fm.chips !== 'hidden' || moved < 10) errors.push(`free map: ${JSON.stringify(fm)} moved ${moved}`);
  // ◎ puts you back in the middle, still unlocked
  await p2.click('#btn-recenter');
  await sleep(800);
  const centred = await p2.evaluate(() => { const { S } = window.__pacer; const c = S.map.map.getCenter(); return { free: S.freeMap, off: Math.hypot((c.lat - S.fix.lat) * 111320, (c.lng - S.fix.lon) * 76000) }; });
  if (!centred.free || centred.off > 40) errors.push(`◎ on the free map: ${JSON.stringify(centred)}`);
  // "Close", like the run settings: following again, tilted, locked
  await p2.click('#map-close');
  await sleep(1500);
  const back = await p2.evaluate(() => { const { S } = window.__pacer; return { free: S.freeMap, pitch: S.map.map.getPitch(), drag: S.map.map.dragPan.isEnabled(), recenter: !document.querySelector('#btn-recenter').hidden, head: !document.querySelector('#map-head').hidden, chips: getComputedStyle(document.querySelector('#chips')).visibility }; });
  console.log('◎ centres:', JSON.stringify(centred), '| Close:', JSON.stringify(back));
  if (back.free || back.pitch < 30 || back.drag || back.recenter || back.head || back.chips !== 'visible') errors.push(`Close on the free map: ${JSON.stringify(back)}`);
  // ... and by itself after a while untouched (30 s; 1.5 s here), and when pocket mode goes
  // black
  const holdMap = async () => {
    await p2.mouse.move(mb.x + mb.width / 2, mb.y + mb.height * 0.4);
    await p2.mouse.down(); await sleep(5300); await p2.mouse.up();
    await sleep(500);
    return p2.evaluate(() => window.__pacer.S.freeMap);
  };
  await p2.evaluate(() => { window.__pacer.S.freeMapIdleMs = 1500; });
  const idle1 = await holdMap();
  await sleep(2000);
  const idle2 = await p2.evaluate(() => window.__pacer.S.freeMap);
  await p2.evaluate(() => { window.__pacer.S.freeMapIdleMs = 30000; });
  const pk1 = await holdMap();
  await p2.evaluate(() => { const { S } = window.__pacer; S.settings.pocket = true; S.peekUntil = 0; S.lastPanel = {}; });
  await sleep(900);
  const pk2 = await p2.evaluate(() => ({ free: window.__pacer.S.freeMap, pocket: !document.querySelector('#pocket').hidden }));
  await p2.evaluate(() => { const { S } = window.__pacer; S.settings.pocket = false; S.lastPanel = {}; });
  await sleep(500);
  console.log('free map closes by itself:', idle1, '→', idle2, '| when pocket goes black:', pk1, '→', JSON.stringify(pk2));
  if (!idle1 || idle2 || !pk1 || pk2.free || !pk2.pocket) errors.push('free map: idle / pocket close');
}
// ending the run: open the run settings (5 s), then hold "End run" 10 s; a red fill covers
// the screen; 4.5 s is not enough
{
  const ib = await p2.locator('#info').boundingBox();
  await p2.mouse.move(ib.x + ib.width - 20, ib.y + ib.height / 2);
  await p2.mouse.down(); await sleep(5300); await p2.mouse.up();
  await sleep(400);
  await p2.evaluate(() => document.querySelector('#btn-stop').scrollIntoView({ block: 'center' }));
  await sleep(300);
  const sb = await p2.locator('#btn-stop').boundingBox();
  await p2.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await p2.mouse.down(); await sleep(4500);
  const red = await p2.evaluate(() => { const f = document.querySelector('#holdfx'); return { shown: !f.hidden, danger: f.classList.contains('danger'), title: f.querySelector('.hf-title').textContent, n: f.querySelector('.hf-count').textContent, fill: getComputedStyle(f.querySelector('.hf-fill')).backgroundColor }; });
  await p2.screenshot({ path: join(out, '27-end-run-holding.png') });
  await p2.mouse.up();
  await sleep(300);
  const still = await p2.evaluate(() => window.__pacer.S.phase);
  await p2.mouse.down(); await sleep(10400); await p2.mouse.up();
  await sleep(500);
  const ended = await p2.evaluate(() => ({ phase: window.__pacer.S.phase, said: window.__spoken.slice(-1)[0] }));
  console.log('end run hold:', JSON.stringify(red), '| after 4 s:', still, '| after 10 s:', JSON.stringify(ended));
  if (!red.shown || !red.danger || red.title !== 'End run' || red.n !== '6' || red.fill !== 'rgb(255, 31, 31)' || still !== 'running' || ended.phase !== 'ready' || ended.said !== 'Pacer stopped.') errors.push('end run hold');
}

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
await p3.evaluate(() => { const v = window.__pacer.S.voice; const say = v.say.bind(v); window.__said3 = []; v.say = (t, o) => { window.__said3.push(t); say(t, o); }; });
await p3.click('#btn-start');
await sleep(500);
const t0 = await p3.evaluate(() => window.__pacer.S.run.t0);
const startSaid = await p3.evaluate(() => window.__said3[0]);
console.log('START says:', startSaid);
if (!/^Start time: \d{1,2}(:\d\d)? (a|p)\.m\. (and \d+ seconds?|exactly)\.$/.test(startSaid || '')) errors.push(`start time spoken: ${startSaid}`);
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

// ---- first launch, location refused: the welcome card asks for it (not before), shows
// "How to fix" when it is refused, which opens Help's Location section; the chip says it
// too; "Try again" picks the GPS up once it is allowed
const ctx4 = await browser.newContext({
  viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  geolocation: { latitude: 46.82655, longitude: -71.24935, accuracy: 5 }, serviceWorkers: 'block',
});
// (headless Chromium leaves the permission prompt hanging: answer it the way iOS does)
await ctx4.addInitScript(() => {
  const real = navigator.geolocation;
  window.__geoDenied = true;
  window.__asked = 0;
  const geo = {
    watchPosition: (ok, err, o) => { window.__asked++; if (window.__geoDenied) { setTimeout(() => err({ code: 1, message: 'denied' }), 50); return -1; } return real.watchPosition(ok, err, o); },
    clearWatch: (id) => { if (id !== -1) real.clearWatch(id); },
    getCurrentPosition: (ok, err, o) => real.getCurrentPosition(ok, err, o),
  };
  Object.defineProperty(navigator, 'geolocation', { configurable: true, get: () => geo });
});
const p4 = await ctx4.newPage();
p4.on('pageerror', (e) => errors.push(String(e)));
await p4.goto('http://localhost:8765/pacer/');
await p4.waitForSelector('#app.phase-ready', { timeout: 60000 });
await sleep(1500);
const first = await p4.evaluate(() => ({ shown: !document.querySelector('#sheet-welcome').hidden, intro: document.querySelector('#wl-intro').textContent, asked: window.__asked, btn: document.querySelector('#wl-loc').textContent }));
console.log('first launch:', JSON.stringify(first));
await p4.screenshot({ path: join(out, '39-welcome.png') });
if (!first.shown || first.asked !== 0 || first.btn !== 'Turn on' || !/One thing/.test(first.intro)) errors.push('welcome card on first launch');
await p4.click('#wl-loc');
await sleep(500);
const refused = await p4.evaluate(() => ({ btn: document.querySelector('#wl-loc').textContent, note: document.querySelector('#wl-loc-note').textContent, chips: document.querySelector('#chips').textContent }));
console.log('location refused:', JSON.stringify(refused));
if (refused.btn !== 'How to fix' || !/Location blocked · tap to fix/.test(refused.chips)) errors.push('welcome card: refused location');
await p4.click('#wl-loc');
await sleep(400);
const helpTop = await p4.evaluate(() => ({
  welcome: !document.querySelector('#sheet-welcome').hidden,
  first: document.querySelector('#help-body h3').textContent,
  status: document.querySelector('#help-body .loc-status').textContent,
  steps: document.querySelector('#help-body ol').textContent,
  retry: !!document.querySelector('#loc-retry'),
}));
console.log('location help:', helpTop.first, '|', helpTop.status);
await p4.screenshot({ path: join(out, '40-location-help.png') });
if (helpTop.welcome || helpTop.first !== 'Location' || !/blocked/.test(helpTop.status) || !/Website Settings/.test(helpTop.steps) || !helpTop.retry) errors.push('location help');
await p4.evaluate(() => { window.__geoDenied = false; }); // allowed in Settings
await ctx4.grantPermissions(['geolocation'], { origin: 'http://localhost:8765' });
await p4.click('#loc-retry');
await sleep(3200);
const afterRetry = await p4.evaluate(() => ({ status: document.querySelector('#help-body .loc-status').textContent, chips: document.querySelector('#chips').textContent }));
console.log('after Try again:', afterRetry.status, '|', afterRetry.chips);
if (!/Location is on/.test(afterRetry.status) || /blocked/.test(afterRetry.chips)) errors.push('location retry');
await ctx4.close();

// ---- first launch on an iPhone: location and compass, one button each, each asked only
// when tapped; it closes by itself once both are on, and does not come back
const ctx5 = await browser.newContext({
  viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  geolocation: { latitude: 46.82655, longitude: -71.24935, accuracy: 5 }, permissions: ['geolocation'], serviceWorkers: 'block',
});
await ctx5.addInitScript(() => {
  // what the iPhone does: location asks on first use, the compass needs a tap and an Allow
  const real = navigator.geolocation;
  window.__asked = 0;
  window.__compassAsked = 0;
  const allowed = localStorage.getItem('pacer.onboarded') === '1';
  const geo = {
    watchPosition: (ok, err, o) => { window.__asked++; return real.watchPosition(ok, err, o); },
    clearWatch: (id) => real.clearWatch(id),
    getCurrentPosition: (ok, err, o) => real.getCurrentPosition(ok, err, o),
  };
  Object.defineProperty(navigator, 'geolocation', { configurable: true, get: () => geo });
  const q = navigator.permissions.query.bind(navigator.permissions);
  navigator.permissions.query = (d) => (d && d.name === 'geolocation' ? Promise.resolve({ state: allowed ? 'granted' : 'prompt', onchange: null }) : q(d));
  DeviceOrientationEvent.requestPermission = () => { window.__compassAsked++; return Promise.resolve('granted'); };
});
const p5 = await ctx5.newPage();
p5.on('pageerror', (e) => errors.push(String(e)));
await p5.goto('http://localhost:8765/pacer/');
await p5.waitForSelector('#app.phase-ready', { timeout: 60000 });
await sleep(1200);
const w1 = await p5.evaluate(() => ({ shown: !document.querySelector('#sheet-welcome').hidden, intro: document.querySelector('#wl-intro').textContent, asked: window.__asked, compass: !document.querySelector('#wl-compass-row').hidden }));
if (!w1.shown || w1.asked !== 0 || !w1.compass || !/Two things/.test(w1.intro)) errors.push(`iPhone welcome: ${JSON.stringify(w1)}`);
await p5.click('#wl-loc');
await sleep(1500);
const w2 = await p5.evaluate(() => ({ loc: document.querySelector('#wl-loc').textContent, next: document.querySelector('#wl-compass').className }));
await p5.screenshot({ path: join(out, '41-welcome-location-on.png') });
await p5.click('#wl-compass');
await sleep(2200);
const w3 = await p5.evaluate(() => ({ shown: !document.querySelector('#sheet-welcome').hidden, compassAsked: window.__compassAsked, flag: localStorage.getItem('pacer.onboarded'), toast: document.querySelector('#toast').textContent }));
console.log('iPhone first launch:', JSON.stringify({ w1, w2, w3 }));
if (w2.loc !== 'On ✓' || !/next/.test(w2.next) || w3.shown || w3.compassAsked !== 1 || w3.flag !== '1') errors.push('iPhone welcome flow');
await p5.reload();
await p5.waitForSelector('#app.phase-ready', { timeout: 60000 });
await sleep(1200);
const w4 = await p5.evaluate(() => ({ shown: !document.querySelector('#sheet-welcome').hidden, asked: window.__asked }));
// and pressing START does not bring up the compass popup (the run does not use it)
await p5.click('#btn-start');
await sleep(800);
const w5 = await p5.evaluate(() => ({ compassAsked: window.__compassAsked, phase: window.__pacer.S.phase }));
await p5.evaluate(() => window.__pacer.stopRun());
console.log('next launch:', JSON.stringify({ w4, w5 }));
if (w4.shown || w4.asked < 1 || w5.compassAsked !== 0 || w5.phase !== 'running') errors.push('welcome after the first launch');
await ctx5.close();

console.log('console errors:', errors.length ? errors : 'none');
await browser.close();
server.close();
