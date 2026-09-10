// App-shell service worker for the "install on Android/iOS/Windows" PWA
// experience. This only caches the UI shell (HTML/JS/CSS/icons) so the app
// can cold-start with no network; actual clinic data was already
// offline-first before this file existed (see src/lib/offline - IndexedDB +
// sync queue). The two layers are independent on purpose: this file can be
// deleted without breaking data offline-first, and vice versa.
const CACHE_VERSION = "mawid-shell-v4";

const APP_SHELL = [
  "/",
  "/dashboard",
  "/display",
  "/manifest.webmanifest",
  "/brand/icon-192.png",
  "/brand/icon-512.png",
];

// Real bug this fixes ("re-entering the installed app shows a completely
// blank white screen, only recovers after several retries or clearing app
// data"): every deploy ships new content-hashed JS/HTML (see CLAUDE.md's
// own multi-dozen-release deploy history), so CACHE_VERSION bumps on every
// meaningful change — but the OLD `activate` handler deleted every cache
// bucket except the brand-new one immediately, before that new bucket had
// ever actually been populated with a successful network fetch. If the
// device happened to be briefly offline (very common right when an
// installed app resumes from the background — Wi-Fi/cellular reconnect
// takes a moment) at that exact point, the navigate handler's own fallback
// chain (`caches.match(req) -> caches.match("/")`) had nothing left to
// return — both looked in a cache bucket that was empty — and resolved to
// `undefined`. Passing `undefined` to `event.respondWith()` is not "no
// page", it's a hard network error the browser renders as its own blank/
// failed-navigation screen, entirely before any of this app's own JS
// (including the error boundary / ChunkErrorRecovery built for a related,
// but distinct, class of failure) ever gets a chance to run. Retrying
// several times, or clearing app data, "worked" only because it eventually
// caught a moment with working network, or reset the whole cache/SW state
// cleanly — not because anything was actually fixed.
//
// Two changes close this for real: (1) old cache buckets are only pruned
// once the NEW bucket's own shell ("/") is confirmed cached — so there is
// always at least one real, usable cached shell to fall back to, even
// mid-transition between versions; (2) the fetch handler below now always
// resolves to a genuine Response object — checking every cache bucket, not
// only the current one, and finally constructing a tiny real fallback page
// instead of ever letting the promise chain resolve to `undefined`.
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
      .open(CACHE_VERSION)
      .then((cache) => cache.match("/"))
      .then((shellCached) =>
        caches.keys().then((keys) => {
          const stale = keys.filter((k) => k !== CACHE_VERSION);
          if (!shellCached) {
            // The new version's own shell isn't cached yet (e.g. install
            // ran while offline) — keep every older bucket around as a
            // real fallback source rather than deleting the only working
            // copies of the app this device has.
            return;
          }
          return Promise.all(stale.map((k) => caches.delete(k)));
        })
      )
      .then(() => self.clients.claim())
  );
});

/** Looks in every cache bucket this SW controls (not just the current
 *  CACHE_VERSION one) for a match — a client mid-transition between
 *  versions, or one whose new bucket never finished populating, can still
 *  have a perfectly good cached copy sitting in an older bucket that
 *  `activate` deliberately didn't delete (see above). */
function matchAnyCache(request) {
  return caches.keys().then((keys) =>
    keys.reduce(
      (chain, key) => chain.then((found) => found || caches.open(key).then((c) => c.match(request))),
      Promise.resolve(undefined)
    )
  );
}

// A tiny, real, self-contained HTML page — never `undefined` — for the one
// case every cache bucket AND the network both come up empty (a device
// that has legitimately never cached anything yet, fully offline right at
// that moment). Auto-retries the network on its own every 1.5s instead of
// requiring the visitor to manually retry/reopen the app themselves.
const OFFLINE_FALLBACK_HTML = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>موعد</title>
<style>
  html, body { margin: 0; height: 100%; }
  body {
    display: flex; align-items: center; justify-content: center;
    background: #F2FBFC; font-family: system-ui, sans-serif; color: #374151;
    text-align: center; padding: 24px;
  }
  p { margin: 0; font-size: 14px; }
</style>
</head>
<body>
<p>جارٍ إعادة الاتصال بموعد…</p>
<script>
  var attempts = 0;
  function tryReload() {
    attempts++;
    fetch(location.href, { cache: "no-store" })
      .then(function (res) {
        if (res.ok) location.reload();
        else if (attempts < 40) setTimeout(tryReload, 1500);
      })
      .catch(function () {
        if (attempts < 40) setTimeout(tryReload, 1500);
      });
  }
  setTimeout(tryReload, 1200);
</script>
</body>
</html>`;

function offlineFallbackResponse() {
  return new Response(OFFLINE_FALLBACK_HTML, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    // Pages: prefer a fresh network copy (so a receptionist reopening the
    // app sees the latest build), fall back to any cached copy of this
    // exact page, then any cached copy of "/", then — only if truly
    // nothing is available anywhere — a real, self-retrying fallback page.
    // Every branch here resolves to a genuine Response; none can resolve
    // to `undefined`, which is what used to produce a hard browser network
    // error (a blank screen) instead of this app's own UI.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() =>
          matchAnyCache(req).then(
            (cached) => cached || matchAnyCache(new Request(new URL("/", self.location.origin))).then((shell) => shell || offlineFallbackResponse())
          )
        )
    );
    return;
  }

  // Static assets (_next/static, icons, fonts): cache-first for instant
  // repeat loads, refreshed in the background whenever online. Falls back
  // to any cache bucket (not just the current one) before ever giving up —
  // same "never resolve to undefined" guarantee as the navigate branch
  // above, since a missing script/style response can otherwise fail in a
  // way this app's own client-side error handling never gets a chance to
  // see or recover from.
  event.respondWith(
    matchAnyCache(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached || new Response("", { status: 504, statusText: "Offline" }));
      return cached || network;
    })
  );
});
