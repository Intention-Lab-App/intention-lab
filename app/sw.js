const CACHE = "intention-lab-app";
const ASSETS = [
  "/",
  "/index.html",
  "/styles.css",
  "/favicon.svg",
  "/fonts/Fraunces.woff2",
  "/fonts/Archivo.woff2",
  "/js/analytics-worker.js",
  "/js/analytics.js",
  "/js/api.js",
  "/js/app.js",
  "/js/bar.js",
  "/js/box.js",
  "/js/bulb.js",
  "/js/challenge.js",
  "/js/charts.js",
  "/js/device.js",
  "/js/engine-worker.js",
  "/js/figures.js",
  "/js/filters.js",
  "/js/format.js",
  "/js/guide.js",
  "/js/history.js",
  "/js/icons.js",
  "/js/play.js",
  "/js/profiles.js",
  "/js/progress.js",
  "/js/result.js",
  "/js/settings.js",
  "/js/sound.js",
  "/js/state.js",
  "/js/tungsten.js",
  "/js/core/capture.js",
  "/js/core/database.js",
  "/js/core/protocol.js",
  "/js/core/preferences.js",
  "/js/core/score.js",
  "/js/core/selection.js",
  "/js/core/simulation.js",
  "/js/core/statistics.js",
  "/js/core/transfer.js",
];

self.addEventListener("install", (event) =>
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS))),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE)
            .map((k) => caches.delete(k)),
        ),
      ),
  ),
);
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== location.origin ||
    url.pathname.startsWith("/bridge/")
  )
    return;
  if (!ASSETS.includes(url.pathname)) return;
  // Network first, so an updated app is used as soon as it is served.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(
            caches.open(CACHE).then((cache) => cache.put(event.request, copy)),
          );
        }
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});
// Asset cache only. No capture, clocks, session state or background-liveness promise.
