const CACHE = 'nz-3'

// API, auth, WebSocket и прокси постеров — не кешируем.
// /auth/ критичен: ответ /auth/telegram/status содержит bearer_token, а
// networkWithFallback кладёт любой res.ok в кеш, игнорируя Cache-Control: no-store.
const SKIP = /^\/api\/|^\/auth\/|^\/ws\/|^\/proxy\/poster/
// URL с ?v= (версионированные ресурсы) — кеш-first навсегда
const VERSIONED = /[?&]v=\d/
// Внешние CDN (mc.yandex.ru не трогаем — adblock блокирует, пусть браузер сам разбирается)
const EXTERNAL = /videoframe2\.com|s1obrut\.github\.io/
const NO_SW    = /mc\.yandex\.ru|cdnjs\.cloudflare\.com/

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', e => {
  const { request } = e
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return
  if (SKIP.test(url.pathname)) return
  if (NO_SW.test(url.hostname)) return

  // Версионированные активы и внешние CDN — cache-first
  if (VERSIONED.test(request.url) || EXTERNAL.test(url.hostname)) {
    e.respondWith(cacheFirst(request))
    return
  }

  // HTML страницы — network-first (свежий документ из сети, кеш только как офлайн-фоллбек).
  // Раньше был stale-while-revalidate, но он отдавал СТАРЫЙ HTML на первой загрузке после
  // деплоя: старый HTML ссылается на app.js?v=СТАРЫЙ → старый код (нет скролла/спиннера),
  // и только ручной refresh подтягивал свежий. HTML маленький, ассеты versioned cache-first
  // (мгновенно), поэтому network-first почти бесплатен, но всегда отдаёт актуальную страницу.
  // destination === 'document' покрывает все навигационные запросы включая чистые URL (/top, /me).
  // /movie/{id}: GitHub Pages отдаёт 404.html со статусом 404 — кешируем его явно (allow404).
  if (request.destination === 'document' || url.pathname === '/' || url.pathname.endsWith('.html')) {
    e.respondWith(networkFirst(request))
    return
  }
  if (/^\/movie\/\d+\/?$/.test(url.pathname)) {
    e.respondWith(networkFirst(request, { allow404: true }))
    return
  }

  // Остальное — сеть с фоллбеком на кеш
  e.respondWith(networkWithFallback(request))
})

async function cacheFirst(req) {
  const cached = await caches.match(req)
  if (cached) return cached
  try {
    const res = await fetch(req)
    if (res.ok) (await caches.open(CACHE)).put(req, res.clone())
    return res
  } catch {
    return new Response('', { status: 503, statusText: 'Service Unavailable' })
  }
}

async function networkFirst(req, { allow404 = false } = {}) {
  const cache = await caches.open(CACHE)
  try {
    const res = await fetch(req)
    // Кешируем успешные ответы; для /movie/{id} кешируем и 404
    // (GitHub Pages намеренно отдаёт 404.html — это наш app shell)
    if (res.ok || (allow404 && res.status === 404)) cache.put(req, res.clone())
    return res
  } catch {
    // Сеть недоступна (офлайн) — отдаём последнюю закешированную версию
    return (await cache.match(req)) || new Response('', { status: 503, statusText: 'Service Unavailable' })
  }
}

async function networkWithFallback(req) {
  try {
    const res = await fetch(req)
    if (res.ok) (await caches.open(CACHE)).put(req, res.clone())
    return res
  } catch {
    return (await caches.match(req)) || new Response('', { status: 503, statusText: 'Service Unavailable' })
  }
}
