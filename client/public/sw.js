// Hand-rolled service worker for OJT Tracker.
//
// Lifecycle:
//   - The server stamps this file with a per-build version comment so the
//     browser sees a byte-different sw.js after every deploy and triggers
//     the standard install -> waiting -> SKIP_WAITING -> activate flow.
//   - On install, we fetch "/" and parse the hashed asset URLs out of the
//     served HTML, then precache the full app shell so offline relaunch
//     works on the very next visit.
//   - On fetch:
//       * Navigations: network-first, fall back to the cached shell.
//       * /api GETs: network-first with cache fallback so list pages
//         continue to render the last-known data when offline.
//       * Static assets: cache-first.
//   - All non-GET requests bypass the cache; the offline mutation queue
//     in IndexedDB is the single source of truth for queued writes.

const VERSION = (self.__BUILD_VERSION__ || "dev");
const SHELL_CACHE = `ojt-shell-${VERSION}`;
const ASSET_CACHE = `ojt-assets-${VERSION}`;
const API_CACHE = `ojt-api-${VERSION}`;

const SHELL_URLS = ["/", "/index.html"];

async function precacheShellAndAssets() {
  const cache = await caches.open(SHELL_CACHE);
  // Always cache the shell entries themselves.
  await cache.addAll(SHELL_URLS).catch(() => {});

  // Then fetch "/" and pull out the hashed asset URLs that the page needs
  // so cold offline relaunch has the JS/CSS ready, not just the HTML.
  try {
    const res = await fetch("/", { cache: "no-cache" });
    if (!res.ok) return;
    const html = await res.text();
    const urls = new Set();
    const re = /(?:href|src)=["']([^"']+)["']/g;
    let m;
    while ((m = re.exec(html))) {
      const u = m[1];
      if (
        u.startsWith("/assets/") ||
        u === "/manifest.webmanifest" ||
        /\.(?:js|css|woff2?|svg|png|ico)$/.test(u)
      ) {
        urls.add(u);
      }
    }
    const assetCache = await caches.open(ASSET_CACHE);
    await Promise.all(
      Array.from(urls).map((u) =>
        fetch(u, { cache: "no-cache" })
          .then((r) => (r.ok ? assetCache.put(u, r.clone()) : null))
          .catch(() => {}),
      ),
    );
  } catch {
    /* offline first install — runtime caching will fill in later */
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheShellAndAssets());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(
            (k) =>
              k !== SHELL_CACHE && k !== ASSET_CACHE && k !== API_CACHE,
          )
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

function isApiRequest(url) {
  return url.pathname.startsWith("/api/");
}

function isAsset(url) {
  return (
    url.pathname.startsWith("/assets/") ||
    /\.(?:js|css|woff2?|ttf|svg|png|jpg|jpeg|webp|ico)$/.test(url.pathname)
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/@") || url.pathname.includes("?v=")) return;

  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(SHELL_CACHE);
          cache.put("/index.html", fresh.clone()).catch(() => {});
          return fresh;
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          const cached =
            (await cache.match("/index.html")) || (await cache.match("/"));
          return (
            cached ||
            new Response("Offline", {
              status: 503,
              headers: { "Content-Type": "text/plain" },
            })
          );
        }
      })(),
    );
    return;
  }

  if (isApiRequest(url)) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          if (fresh.ok) {
            const cache = await caches.open(API_CACHE);
            cache.put(req, fresh.clone()).catch(() => {});
          }
          return fresh;
        } catch {
          const cached = await caches.match(req);
          if (cached) return cached;
          return new Response(
            JSON.stringify({ message: "Offline" }),
            {
              status: 503,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
      })(),
    );
    return;
  }

  if (isAsset(url)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        try {
          const fresh = await fetch(req);
          if (fresh.ok) {
            const cache = await caches.open(ASSET_CACHE);
            cache.put(req, fresh.clone()).catch(() => {});
          }
          return fresh;
        } catch {
          return new Response("", { status: 504 });
        }
      })(),
    );
  }
});
