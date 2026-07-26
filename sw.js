/* AFOQT Master — Service Worker (오프라인 캐시) */
const CACHE = "afoqt-v4-42-0";
// Same-origin assets only. The Supabase CDN is loaded lazily by the app and
// must never block install or startup.
const ASSETS = [
  "./",
  "./index.html",
  "./app.css",
  "./app.js",
  "./config.js",
  "./words.json",
  "./analogies.json",
  "./reading.json",
  "./roots.json",
  "./root_lessons.json",
  "./guides.json",
  "./aviation.json",
  "./aviation_terms.json",
  "./aviation_book.json",
  "./arithmetic.json",
  "./mathknowledge.json",
  "./physicalscience.json",
  "./situational.json",
  "./icon.svg",
  "./manifest.webmanifest",
];

self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(()=>{})));
});

// Allow the page to force an immediate activation of a waiting SW.
self.addEventListener("message", e => {
  if (e.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Only handle same-origin requests; let the CDN/Supabase go straight to network.
  if (url.origin !== self.location.origin) return;

  // App shell (html/js/css): network-first so updates show up immediately,
  // falling back to cache when offline.
  const isShell = /\.(html|js|css)$/.test(url.pathname) || url.pathname.endsWith("/");
  if (isShell) {
    e.respondWith(
      fetch(req).then(res => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(()=>{});
        }
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // Data/assets: cache-first with background refresh (works offline).
  e.respondWith(
    caches.match(req).then(cached => {
      const net = fetch(req).then(res => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(()=>{});
        }
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});
