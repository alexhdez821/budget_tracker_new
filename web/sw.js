const CACHE = "budget-shell-v1";
const SHELL = ["/", "/budget-app.png", "/manifest.webmanifest", "/sync.js"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    (async () => {
      try {
        const fresh = await fetch(event.request);
        if (fresh.ok && fresh.headers.get("x-budget-shell") === "1") {
          const cache = await caches.open(CACHE);
          await cache.put(event.request, fresh.clone());
        }
        return fresh;
      } catch {
        const cached = (await caches.match(event.request)) || (event.request.mode === "navigate" ? await caches.match("/") : undefined);
        if (cached) return cached;
        return new Response("Offline", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
      }
    })(),
  );
});
