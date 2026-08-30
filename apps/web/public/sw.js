// App-shell service worker for the "install on Android/iOS/Windows" PWA
// experience. This only caches the UI shell (HTML/JS/CSS/icons) so the app
// can cold-start with no network; actual clinic data was already
// offline-first before this file existed (see src/lib/offline - IndexedDB +
// sync queue). The two layers are independent on purpose: this file can be
// deleted without breaking data offline-first, and vice versa.
const CACHE_VERSION = "mawid-shell-v1";

const APP_SHELL = [
  "/",
  "/dashboard",
  "/display",
  "/manifest.webmanifest",
  "/brand/icon-192.png",
  "/brand/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      // addAll fails the whole install if any single URL 404s; run each
      // request independently so one missing route doesn't sink the rest.
      .then((cache) => Promise.allSettled(APP_SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    // Pages: prefer a fresh network copy (so a receptionist reopening the
    // app sees the latest build), fall back to the cached shell offline.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((res) => res || caches.match("/dashboard")))
    );
    return;
  }

  // Static assets (_next/static, icons, fonts): cache-first for instant
  // repeat loads, refreshed in the background whenever online.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
