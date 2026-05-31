/*
 * StillasCalculator service worker (Req 16.2).
 *
 * Minimal, dependency-free service worker that enables the installed PWA to
 * launch in a standalone window and provides a network-first strategy with a
 * cache fallback so the app shell stays available on flaky connections.
 *
 * This file is intentionally plain JavaScript served as a static asset from
 * /sw.js so its scope covers the whole origin ("/").
 */

const CACHE_NAME = "stillas-cache-v1";
const APP_SHELL = ["/", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  // Pre-cache the app shell, but never block installation on a fetch failure.
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  // Drop caches from previous versions, then take control of open clients.
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle same-origin GET navigations/assets; let everything else pass
  // through untouched (API routes, cross-origin tiles, geocoding, etc.).
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Cache a copy of successful responses for offline fallback.
        if (response && response.status === 200 && response.type === "basic") {
          const copy = response.clone();
          caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(request, copy))
            .catch(() => undefined);
        }
        return response;
      })
      .catch(async () => {
        // Network failed: serve a cached copy when available.
        const cached = await caches.match(request);
        if (cached) {
          return cached;
        }
        // For navigations, fall back to the cached app shell root.
        if (request.mode === "navigate") {
          const shell = await caches.match("/");
          if (shell) {
            return shell;
          }
        }
        return Response.error();
      })
  );
});
