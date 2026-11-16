const CACHE_NAME = 'aurora-diary-offline-v2';
const COVER_DIR = './assets/covers/';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.png',
  './small-icon.png',
  COVER_DIR + 'covers.json',
  COVER_DIR + 'cover.webp'
];

// Cache every cover listed in covers.json so new covers also work 100% offline
async function cacheCoversFrom(response) {
  try {
    const json = await response.json();
    const list = Array.isArray(json) ? json : (json.covers || []);
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(list
      .filter((c) => c && c.file)
      .map(async (c) => {
        const url = COVER_DIR + encodeURI(c.file);
        if (!(await cache.match(url))) await cache.add(url);
      }));
  } catch (e) { /* ignore */ }
}

// Install: pre-cache app files (tolerant: one missing file won't break install)
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(CORE_ASSETS.map((u) => cache.add(u)));
    const listed = await cache.match(COVER_DIR + 'covers.json');
    if (listed) await cacheCoversFrom(listed.clone());
  })());
  self.skipWaiting();
});

// Activate: remove outdated caches when version increments
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // covers.json: network-first so newly added covers appear, cache as fallback offline
  if (url.pathname.endsWith('/assets/covers/covers.json')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const fresh = await fetch(req, { cache: 'no-store' });
        if (fresh && fresh.status === 200) {
          cache.put(COVER_DIR + 'covers.json', fresh.clone());
          event.waitUntil(cacheCoversFrom(fresh.clone()));
        }
        return fresh;
      } catch (e) {
        return (await cache.match(COVER_DIR + 'covers.json')) || Response.error();
      }
    })());
    return;
  }

  // Everything else: cache-first, with runtime caching
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (!res || res.status !== 200 || res.type !== 'basic') return res;
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()));
    })
  );
});
