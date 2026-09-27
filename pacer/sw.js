// Service worker: everything the pacer needs is cached on first visit, so it works with
// no connection at all. A new version takes over as soon as it is fully downloaded; the
// page reloads onto it by itself unless a run is going (then on the next launch).
const VERSION = 'aeb1606c5436';
const CACHE = `pacer-${VERSION}`;
const ASSETS = [
  "./",
  "index.html",
  "app.css",
  "manifest.webmanifest",
  "js/app.js",
  "js/course.js",
  "js/freerun.js",
  "js/gap.js",
  "js/geo.js",
  "js/help.js",
  "js/mapview.js",
  "js/model.js",
  "js/practice.js",
  "js/sim.js",
  "js/store.js",
  "js/theme.js",
  "js/tracker.js",
  "js/voice.js",
  "js/wake.js",
  "js/weather.js",
  "vendor/NoSleep.min.js",
  "vendor/maplibre-gl.css",
  "vendor/maplibre-gl.js",
  "vendor/pmtiles.js",
  "fonts/barlow-condensed-latin-600-normal.woff2",
  "fonts/barlow-condensed-latin-700-normal.woff2",
  "fonts/barlow-condensed-latin-800-normal.woff2",
  "glyphs/Open%20Sans%20Bold/0-255.pbf",
  "glyphs/Open%20Sans%20Bold/8192-8447.pbf",
  "glyphs/Open%20Sans%20Semibold/0-255.pbf",
  "glyphs/Open%20Sans%20Semibold/8192-8447.pbf",
  "icons/apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "data/course.json",
  "data/basemap.pmtiles",
  "data/practice-graph.bin",
  "data/practice-dem.bin",
  "data/practice-dest.json",
  "voice/a1.mp3",
  "voice/a10.mp3",
  "voice/a11.mp3",
  "voice/a12.mp3",
  "voice/a13.mp3",
  "voice/a14.mp3",
  "voice/a15.mp3",
  "voice/a16.mp3",
  "voice/a17.mp3",
  "voice/a18.mp3",
  "voice/a19.mp3",
  "voice/a2.mp3",
  "voice/a20.mp3",
  "voice/a21.mp3",
  "voice/a22.mp3",
  "voice/a23.mp3",
  "voice/a24.mp3",
  "voice/a25.mp3",
  "voice/a26.mp3",
  "voice/a27.mp3",
  "voice/a28.mp3",
  "voice/a29.mp3",
  "voice/a3.mp3",
  "voice/a30.mp3",
  "voice/a31.mp3",
  "voice/a32.mp3",
  "voice/a33.mp3",
  "voice/a34.mp3",
  "voice/a35.mp3",
  "voice/a36.mp3",
  "voice/a37.mp3",
  "voice/a38.mp3",
  "voice/a39.mp3",
  "voice/a4.mp3",
  "voice/a40.mp3",
  "voice/a41.mp3",
  "voice/a42.mp3",
  "voice/a43.mp3",
  "voice/a44.mp3",
  "voice/a45.mp3",
  "voice/a46.mp3",
  "voice/a47.mp3",
  "voice/a48.mp3",
  "voice/a49.mp3",
  "voice/a5.mp3",
  "voice/a50.mp3",
  "voice/a51.mp3",
  "voice/a52.mp3",
  "voice/a53.mp3",
  "voice/a54.mp3",
  "voice/a55.mp3",
  "voice/a56.mp3",
  "voice/a57.mp3",
  "voice/a58.mp3",
  "voice/a59.mp3",
  "voice/a6.mp3",
  "voice/a60.mp3",
  "voice/a61.mp3",
  "voice/a62.mp3",
  "voice/a63.mp3",
  "voice/a64.mp3",
  "voice/a65.mp3",
  "voice/a66.mp3",
  "voice/a67.mp3",
  "voice/a68.mp3",
  "voice/a69.mp3",
  "voice/a7.mp3",
  "voice/a70.mp3",
  "voice/a71.mp3",
  "voice/a72.mp3",
  "voice/a73.mp3",
  "voice/a74.mp3",
  "voice/a75.mp3",
  "voice/a76.mp3",
  "voice/a77.mp3",
  "voice/a78.mp3",
  "voice/a79.mp3",
  "voice/a8.mp3",
  "voice/a80.mp3",
  "voice/a81.mp3",
  "voice/a82.mp3",
  "voice/a83.mp3",
  "voice/a84.mp3",
  "voice/a85.mp3",
  "voice/a86.mp3",
  "voice/a87.mp3",
  "voice/a88.mp3",
  "voice/a89.mp3",
  "voice/a9.mp3",
  "voice/a90.mp3",
  "voice/a91.mp3",
  "voice/a92.mp3",
  "voice/a93.mp3",
  "voice/a94.mp3",
  "voice/a95.mp3",
  "voice/a96.mp3",
  "voice/a97.mp3",
  "voice/a98.mp3",
  "voice/a99.mp3",
  "voice/about.mp3",
  "voice/ahead.mp3",
  "voice/b1.mp3",
  "voice/b10.mp3",
  "voice/b11.mp3",
  "voice/b12.mp3",
  "voice/b13.mp3",
  "voice/b14.mp3",
  "voice/b15.mp3",
  "voice/b16.mp3",
  "voice/b17.mp3",
  "voice/b18.mp3",
  "voice/b19.mp3",
  "voice/b2.mp3",
  "voice/b20.mp3",
  "voice/b21.mp3",
  "voice/b22.mp3",
  "voice/b23.mp3",
  "voice/b24.mp3",
  "voice/b25.mp3",
  "voice/b26.mp3",
  "voice/b27.mp3",
  "voice/b28.mp3",
  "voice/b29.mp3",
  "voice/b3.mp3",
  "voice/b30.mp3",
  "voice/b31.mp3",
  "voice/b32.mp3",
  "voice/b33.mp3",
  "voice/b34.mp3",
  "voice/b35.mp3",
  "voice/b36.mp3",
  "voice/b37.mp3",
  "voice/b38.mp3",
  "voice/b39.mp3",
  "voice/b4.mp3",
  "voice/b40.mp3",
  "voice/b41.mp3",
  "voice/b42.mp3",
  "voice/b43.mp3",
  "voice/b44.mp3",
  "voice/b45.mp3",
  "voice/b46.mp3",
  "voice/b47.mp3",
  "voice/b48.mp3",
  "voice/b49.mp3",
  "voice/b5.mp3",
  "voice/b50.mp3",
  "voice/b51.mp3",
  "voice/b52.mp3",
  "voice/b53.mp3",
  "voice/b54.mp3",
  "voice/b55.mp3",
  "voice/b56.mp3",
  "voice/b57.mp3",
  "voice/b58.mp3",
  "voice/b59.mp3",
  "voice/b6.mp3",
  "voice/b60.mp3",
  "voice/b61.mp3",
  "voice/b62.mp3",
  "voice/b63.mp3",
  "voice/b64.mp3",
  "voice/b65.mp3",
  "voice/b66.mp3",
  "voice/b67.mp3",
  "voice/b68.mp3",
  "voice/b69.mp3",
  "voice/b7.mp3",
  "voice/b70.mp3",
  "voice/b71.mp3",
  "voice/b72.mp3",
  "voice/b73.mp3",
  "voice/b74.mp3",
  "voice/b75.mp3",
  "voice/b76.mp3",
  "voice/b77.mp3",
  "voice/b78.mp3",
  "voice/b79.mp3",
  "voice/b8.mp3",
  "voice/b80.mp3",
  "voice/b81.mp3",
  "voice/b82.mp3",
  "voice/b83.mp3",
  "voice/b84.mp3",
  "voice/b85.mp3",
  "voice/b86.mp3",
  "voice/b87.mp3",
  "voice/b88.mp3",
  "voice/b89.mp3",
  "voice/b9.mp3",
  "voice/b90.mp3",
  "voice/b91.mp3",
  "voice/b92.mp3",
  "voice/b93.mp3",
  "voice/b94.mp3",
  "voice/b95.mp3",
  "voice/b96.mp3",
  "voice/b97.mp3",
  "voice/b98.mp3",
  "voice/b99.mp3",
  "voice/bar.mp3",
  "voice/behind.mp3",
  "voice/chip.mp3",
  "voice/every1000.mp3",
  "voice/every2000.mp3",
  "voice/every250.mp3",
  "voice/every500.mp3",
  "voice/finish.mp3",
  "voice/go.mp3",
  "voice/go_run.mp3",
  "voice/live_wait.mp3",
  "voice/m1.mp3",
  "voice/m2.mp3",
  "voice/m3.mp3",
  "voice/m4.mp3",
  "voice/m5.mp3",
  "voice/m6.mp3",
  "voice/m7.mp3",
  "voice/m8.mp3",
  "voice/m9.mp3",
  "voice/offpace.mp3",
  "voice/pace.mp3",
  "voice/rehearsal.mp3",
  "voice/stopped.mp3"
];

async function precache() {
  const cache = await caches.open(CACHE);
  const missing = [];
  for (const url of ASSETS) {
    if (await cache.match(url)) continue;
    missing.push(url);
  }
  // a few at a time, with a retry: cellular at a race start can be flaky
  const queue = missing.slice();
  const worker = async () => {
    while (queue.length) {
      const url = queue.shift();
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch(url, { cache: 'no-cache' });
          if (res.ok) { await cache.put(url, res); break; }
        } catch { /* retry */ }
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}

async function complete() {
  const cache = await caches.open(CACHE);
  for (const url of ASSETS) if (!(await cache.match(url))) return false;
  return true;
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    await precache();
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('pacer-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type === 'skipWaiting') self.skipWaiting();
  if (msg.type === 'status') {
    event.waitUntil((async () => {
      let ok = await complete();
      if (!ok) { await precache(); ok = await complete(); }
      const clients = await self.clients.matchAll();
      clients.forEach((c) => c.postMessage({ type: 'status', complete: ok, version: VERSION }));
    })());
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const scope = new URL(self.registration.scope);
  if (!url.pathname.startsWith(scope.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = req.mode === 'navigate' ? new URL('index.html', scope).href : req;
    const hit = await cache.match(key, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch {
      return new Response('Offline and not cached', { status: 503, statusText: 'offline' });
    }
  })());
});
