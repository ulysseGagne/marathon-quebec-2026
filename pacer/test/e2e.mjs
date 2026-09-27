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
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({
  viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  geolocation: { latitude: 46.82655, longitude: -71.24935, accuracy: 5 },
  permissions: ['geolocation'],
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

await page.click('[data-open="settings"]');
await sleep(500);
await shot('02-settings');
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

// Simulated race at 60x: gun 20 s after start of sim
await page.evaluate(() => window.__pacer.startSim(60, { bias: 0.006, seed: 42 }));
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
for (const [el, name] of [[240, '06-km1'], [1500, '07-km6'], [2745, '08-tunnel'], [3130, '09-climb'], [6400, '10-champlain'], [9000, '11-km36']]) {
  if (name === '10-champlain') await page.evaluate(() => { window.__pacer.S.settings.panel = 'black'; window.__pacer.S.lastPanel = {}; });
  if (name === '11-km36') await page.evaluate(() => { window.__pacer.S.settings.panel = 'color'; window.__pacer.S.lastPanel = {}; });
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
// long-press the handle to open the run menu
const box = await page.locator('#info').boundingBox();
await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2);
await page.mouse.down();
await sleep(1300);
await page.mouse.up();
await sleep(400);
await shot('12-run-menu');
await page.click('#sheet-menu [data-close]');
const fin = await waitVirtual(10900);
await sleep(1500);
await shot('13-finish');
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
await p2.evaluate(() => window.__pacer.startSim(30, { practiceSpec: window.__pacer.S.practiceDraft.spec, seed: 7 }));
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

console.log('console errors:', errors.length ? errors : 'none');
await browser.close();
server.close();
