/* AFOQT Vocab Master — Service Worker (오프라인 캐시) */
const CACHE = "afoqt-v2-0-0";
const ASSETS = [
  "./",
  "./index.html",
  "./app.css",
  "./app.js",
  "./config.js",
  "./words.json",
  "./icon.svg",
  "./manifest.webmanifest",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2",
];

self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(()=>{})));
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

  // Supabase API/Realtime 호출은 캐시하지 않고 항상 네트워크
  if (url.hostname.endsWith("supabase.co") || url.pathname.includes("/realtime")) return;

  // 정적 자산: 캐시 우선, 네트워크로 백그라운드 갱신
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
