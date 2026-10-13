// Minimal, honest service worker: it caches the app shell so the interface
// loads offline and is installable, and it never caches API responses —
// task data always comes fresh from the server so nobody works from stale
// status. Real offline task queuing (queue an action, replay on reconnect)
// is listed as a roadmap item in the README rather than faked here.

// v2: network-first. The old version served a saved copy of the page forever, which went blank
// after an update because the saved page pointed at files that no longer existed.
const CACHE_NAME = "clinic-work-hub-shell-v2";

self.addEventListener("install", () => { self.skipWaiting(); });

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  // Never cache API calls or private files -- data must always come fresh from the server.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/webhook/") || url.pathname.startsWith("/uploads/")) return;

  // Always try the network first; only fall back to the saved copy when offline.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE_NAME).then((c) => c.put(event.request, copy)); }
        return res;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("/index.html")))
  );
});
