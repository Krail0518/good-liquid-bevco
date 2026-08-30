// Bumped from v101 to purge what the previous fetch handler cached. That
// handler stored EVERY successful GET, including cross-origin Supabase REST
// responses carrying another client's invoices, formulas and documents.
// activate{} deletes every cache key that is not this one, so changing the
// name is what evicts those entries from browsers that already hold them.
const CACHE = 'gl-crm-v102';
const STATIC = ['/'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // 1. Drop superseded caches, as before.
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));

    // 2. Then purge any CROSS-ORIGIN entry from whatever remains.
    //
    // Renaming the cache was the obvious way to evict what the old handler
    // stored, and it is not sufficient on its own: a browser that already
    // holds the previous cache does not reliably drop it at the moment this
    // worker activates, which was confirmed by testing rather than assumed —
    // a seeded gl-crm-v101 holding a Supabase response survived an unregister,
    // a re-register, and a confirmed 'activated' state.
    //
    // Those entries are the actual problem: API responses carrying one
    // client's invoices, formulas and documents. So they are removed by
    // inspecting the entries themselves, which does not depend on the cache
    // name having changed, on the old worker being gone, or on the ordering
    // between them.
    for (const key of await caches.keys()) {
      const cache = await caches.open(key);
      for (const req of await cache.keys()) {
        let sameOrigin = false;
        try { sameOrigin = new URL(req.url).origin === self.location.origin; } catch (err) { sameOrigin = false; }
        if (!sameOrigin) await cache.delete(req);
      }
    }
  })());
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const req = e.request;

  // ── Same-origin only ────────────────────────────────────────────────
  // The previous version intercepted and cached every GET with no origin,
  // status or type check. That included the Supabase REST API, so responses
  // holding one client's invoices, formulas and documents were written into
  // the browser's Cache API — where they survived logout and would be served
  // to whoever used that browser profile next. On a shared machine that is
  // cross-tenant disclosure, which is the outcome this project treats as the
  // worst it can produce.
  //
  // Cross-origin requests are now left to the browser entirely: no
  // respondWith, so the service worker takes no part in them at all. That is
  // deliberately stronger than "fetch but do not cache" — there is no code
  // path left that could put an API response in a cache.
  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;

  // The HTML shell (page navigations) must NEVER be served stale — otherwise a
  // new deploy sits on the server while the browser keeps rendering the old
  // cached index.html. Always fetch it fresh from the network with the HTTP
  // cache bypassed; fall back to the cached copy only when offline.
  const isNav = req.mode === 'navigate' ||
                (req.headers.get('accept') || '').includes('text/html');
  if (isNav) {
    e.respondWith(
      fetch(req, { cache: 'no-store' })
        .then(res => {
          // Only cache a real success. The old code cached any response,
          // so a 404 or a 500 became the offline fallback.
          if (res && res.ok && res.type === 'basic') {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put('/', clone));
          }
          return res;
        })
        .catch(() => caches.match(req).then(r => r || caches.match('/')))
    );
    return;
  }

  // Other assets: network-first, with the cache as an offline fallback.
  e.respondWith(
    fetch(req)
      .then(res => {
        // Same-origin is already guaranteed above; this adds "succeeded" and
        // "not opaque". An opaque response has no readable status, so caching
        // one means caching something whose success is unknowable.
        if (res && res.ok && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(req, clone));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
