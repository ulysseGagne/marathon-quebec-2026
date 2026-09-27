// Service worker: everything the pacer needs is cached on first visit, so it works with
// no connection at all. A new version takes over as soon as it is fully downloaded; the
// page reloads onto it by itself unless a run is going (then on the next launch).
const VERSION = '__VERSION__';
const CACHE = `pacer-${VERSION}`;
const ASSETS = __ASSETS__;

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
