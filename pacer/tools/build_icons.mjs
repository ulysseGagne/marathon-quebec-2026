// Draws the app icons and the link-preview card (pacer/icons/*.png) from one vector
// drawing, in the app's own style: black, the course bright from the ghost on and thin
// behind it, the ghost as a white arrow and you as the yellow arrow, a little ahead (+3).
// Rendered by headless Chromium (Playwright), with the app's arrow shapes and font.
// Usage: PLAYWRIGHT=/path/to/playwright/index.mjs node pacer/tools/build_icons.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pw = await import(process.env.PLAYWRIGHT || 'playwright');
const { chromium } = pw.default || pw;
const root = fileURLToPath(new URL('..', import.meta.url));
const font = readFileSync(`${root}fonts/barlow-condensed-latin-800-normal.woff2`).toString('base64');
const font6 = readFileSync(`${root}fonts/barlow-condensed-latin-600-normal.woff2`).toString('base64');

// The drawing on a 512 x 512 square; `pad` shrinks it towards the centre (maskable icons
// keep everything inside the middle 80 %).
function art(pad = 0) {
  const k = 1 - 2 * pad;
  return `
<g transform="translate(${256 - 256 * k} ${256 - 256 * k}) scale(${k})">
  <path id="road" d="M130 560 C130 440 336 410 336 296 C336 182 170 196 170 96 C170 32 226 -8 290 -40" fill="none"/>
  <use href="#road" stroke="#8A8A8A" stroke-width="12" stroke-linecap="round"/>
  <use href="#road" id="bright" stroke="#FFFFFF" stroke-width="26" stroke-linecap="round"/>
  <g id="ghost"><path d="M0 -27 L20 22 L0 12 L-20 22 Z" fill="#FFFFFF" stroke="#000" stroke-width="5" stroke-linejoin="round"/></g>
  <g id="me"><path d="M0 -32 L24 26 L0 14 L-24 26 Z" fill="#FFD60A" stroke="#000" stroke-width="5" stroke-linejoin="round"/></g>
</g>`;
}

// place the arrows along the road and show the bright part from the ghost on
const place = `
  for (const svg of document.querySelectorAll('svg.art')) {
    const road = svg.querySelector('#road');
    const L = road.getTotalLength();
    const at = (f) => {
      const p = road.getPointAtLength(f * L), q = road.getPointAtLength(Math.min(L, f * L + 1));
      return { x: p.x, y: p.y, deg: Math.atan2(q.x - p.x, p.y - q.y) * 180 / Math.PI };
    };
    // you run up the road; the ghost a little behind you; the road is bright from the
    // ghost on
    const fg = 0.31, fm = 0.47;
    const g = at(fg), m = at(fm);
    svg.querySelector('#ghost').setAttribute('transform', 'translate(' + g.x + ' ' + g.y + ') rotate(' + g.deg + ') scale(2.3)');
    svg.querySelector('#me').setAttribute('transform', 'translate(' + m.x + ' ' + m.y + ') rotate(' + m.deg + ') scale(2.9)');
    const bright = svg.querySelector('#bright');
    bright.setAttribute('stroke-dasharray', (1 - fg) * L + ' ' + L);
    bright.setAttribute('stroke-dashoffset', -fg * L);
  }`;

function page(body, w, h) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face { font-family: Barlow; font-weight: 800; src: url(data:font/woff2;base64,${font}) format("woff2"); }
    @font-face { font-family: Barlow; font-weight: 600; src: url(data:font/woff2;base64,${font6}) format("woff2"); }
    html, body { margin: 0; background: #000; width: ${w}px; height: ${h}px; overflow: hidden; }
  </style></head><body>${body}<script>${place}</script></body></html>`;
}

const square = (size, pad) => page(`<svg class="art" width="${size}" height="${size}" viewBox="0 0 512 512">${art(pad)}</svg>`, size, size);

// the link preview: the drawing on the left, the number on the right
const card = page(`
  <div style="display:flex;align-items:center;width:1200px;height:630px">
    <svg class="art" width="630" height="630" viewBox="0 0 512 512" style="flex:none">${art(0.06)}</svg>
    <div style="font-family:Barlow;color:#fff;margin-left:10px">
      <div style="font-weight:600;font-size:46px;letter-spacing:0.1em;color:#9b9b9b">VIRTUAL PACER</div>
      <div style="font-weight:800;font-size:330px;line-height:0.9;margin:6px 0 10px -8px">+3</div>
      <div style="font-weight:600;font-size:40px;line-height:1.2;color:#cfcfcf">seconds ahead of the ghost<br>Marathon de Québec 2026</div>
    </div>
  </div>`, 1200, 630);

const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium' });
const shots = [
  ['icon-512.png', square(512, 0), 512, 512],
  ['icon-192.png', square(192, 0), 192, 192],
  ['apple-touch-icon.png', square(180, 0), 180, 180],
  ['icon-maskable-512.png', square(512, 0.1), 512, 512],
  ['og.png', card, 1200, 630],
];
for (const [name, html, w, h] of shots) {
  const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await p.setContent(html);
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: `${root}icons/${name}`, omitBackground: false });
  await p.close();
  console.log('icons/' + name);
}
await browser.close();
