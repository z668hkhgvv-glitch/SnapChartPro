const VERSION = "1.4.8";
const CACHE   = "snapchart-pro-" + VERSION;

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(["/", "/index.html"]))
  );
  // Don't skipWaiting — wait for the user to confirm the update
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  // Hashed assets — cache first (URL changes with every build, safe to cache forever)
  if (url.pathname.startsWith("/assets/")) {
    e.respondWith(
      caches.match(e.request).then(
        (hit) => hit || fetch(e.request).then((res) => {
          caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
          return res;
        })
      )
    );
    return;
  }

  // Everything else (index.html, manifest, icons) — network first, cache as fallback
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
        return res;
      })
      .catch(() =>
        caches.match(e.request).then((hit) => hit || caches.match("/index.html"))
      )
  );
});

// The page sends "skipWaiting" when the user taps "Update now"
self.addEventListener("message", (e) => {
  if (e.data === "skipWaiting") self.skipWaiting();
});
