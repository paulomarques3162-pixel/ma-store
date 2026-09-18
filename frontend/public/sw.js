/* =============================================================================
 * MA STORE - Service Worker (PWA)
 * -----------------------------------------------------------------------------
 * Estrategias:
 *  - Navegacao (HTML): network-first, com app shell em cache como fallback.
 *  - Assets estaticos: stale-while-revalidate.
 *  - API publica de vitrine: network-first com cache curto (5 min).
 *  - API do usuario / escritas / admin: SEMPRE rede, NUNCA cacheado.
 *
 * Regra de seguranca: nenhum dado pessoal (carrinho, pedidos, pagamentos,
 * mensagens, admin, tokens) e gravado no cache do service worker.
 * ========================================================================== */

const VERSION = "ma-store-v1";
const STATIC_CACHE = `${VERSION}-static`;
const PUBLIC_API_CACHE = `${VERSION}-api`;
const OFFLINE_URL = "/offline.html";
const PUBLIC_API_MAX_AGE = 5 * 60 * 1000;
const MAX_STATIC_ENTRIES = 80;

/** Rotas de API publicas que podem ser cacheadas (vitrine/content). */
const PUBLIC_API_PATHS = [
  "/api/products",
  "/api/categories",
  "/api/brands",
  "/api/content",
  "/api/banners",
  "/api/theme",
  "/api/shipping/methods",
  "/api/shipping/ufs",
];

/** Nunca cachear (dado do usuario, escrita ou area administrativa). */
const NEVER_CACHE = [
  "/api/auth",
  "/api/cart",
  "/api/orders",
  "/api/favorites",
  "/api/payments",
  "/api/messages",
  "/api/notifications",
  "/api/users",
  "/api/admin",
  "/api/coupons",
  "/api/reviews",
  "/api/feedback",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await cache.addAll([
        "/",
        OFFLINE_URL,
        "/manifest.webmanifest",
        "/logo.png",
        "/icons/icon-192.png",
        "/placeholder-product.svg",
      ]);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

function isPublicApi(pathname) {
  if (NEVER_CACHE.some((blocked) => pathname.startsWith(blocked))) return false;
  return PUBLIC_API_PATHS.some((allowed) => pathname.startsWith(allowed));
}

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  await Promise.all(keys.slice(0, keys.length - maxEntries).map((key) => cache.delete(key)));
}

async function networkFirst(request, cacheName, maxAgeMs) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.status === 200 && response.type === "basic") {
      const body = await response.clone().blob();
      const headers = new Headers(response.headers);
      headers.set("sw-cached-at", String(Date.now()));
      await cache.put(request, new Response(body, { status: 200, statusText: "OK", headers }));
      void trimCache(cacheName, 120);
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) {
      const cachedAt = Number(cached.headers.get("sw-cached-at") ?? 0);
      if (!maxAgeMs || Date.now() - cachedAt < maxAgeMs) return cached;
    }
    throw new Error("offline");
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && response.status === 200 && response.type === "basic") {
        void cache.put(request, response.clone());
        void trimCache(cacheName, MAX_STATIC_ENTRIES);
      }
      return response;
    })
    .catch(() => undefined);
  return cached ?? (await network) ?? Response.error();
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;
  if (request.method !== "GET") return;
  if (request.headers.has("range")) return;

  // Navegacao (SPA)
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cache = await caches.open(STATIC_CACHE);
          return (await cache.match("/")) ?? (await cache.match(OFFLINE_URL)) ?? Response.error();
        }
      })(),
    );
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    if (!isPublicApi(url.pathname)) return;
    event.respondWith(
      networkFirst(request, PUBLIC_API_CACHE, PUBLIC_API_MAX_AGE).catch(
        () =>
          new Response(
            JSON.stringify({
              error: {
                code: "OFFLINE",
                message: "Você está sem conexão. Estes dados não estão disponíveis offline.",
                requestId: "sw-offline",
              },
            }),
            { status: 503, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    return;
  }

  if (/\.(?:js|css|woff2?|png|jpe?g|svg|webp|avif|ico)$/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
  }
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
