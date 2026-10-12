// Minimal, honest service worker: it caches the app shell so the interface
// loads offline and is installable, and it never caches API responses —
// task data always comes fresh from the server so nobody works from stale
// status. Real offline task queuing (queue an action, replay on reconnect)
// is listed as a roadmap item in the README rather than faked here.

const CACHE_NAME = "clinic-work-hub-shell-v1";
const SHELL_FILES = ["/", "/index.html", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never cache API calls — always hit the network so task status is live.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/webhook/")) return;

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
