/**
 * Service Worker 入口：每次构建生成新的缓存版本号，
 * 旧缓存会在 activate 时清掉，避免图片/字体长期停留在旧文件上。
 */
export function GET() {
  const version = `v${Date.now().toString(36)}`;

  const body = `/* 由 src/pages/sw.js.ts 生成 */
const CACHE = "shidan-assets-${version}";

self.addEventListener("install", () => {
  self.skipWaiting();
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
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith("/sw.js")) return;

  const cacheable =
    url.pathname.includes("/_astro/") || /\\.(webp|png|jpe?g|svg|woff2?|css|js)$/.test(url.pathname);
  if (!cacheable) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(request);
      if (hit) return hit;

      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    }),
  );
});
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
