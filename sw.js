const CACHE = 'nz-1'

// API, WebSocket и прокси постеров — не кешируем
const SKIP = /^\/api\/|^\/ws\/|^\/proxy\/poster/
// URL с ?v= (версионированные ресурсы) — кеш-first навсегда
const VERSIONED = /[?&]v=\d/
// Внешние CDN (mc.yandex.ru не трогаем — adblock блокирует, пусть браузер сам разбирается)
const EXTERNAL = /cdn\.jsdelivr\.net|videoframe2\.com|s1obrut\.github\.io/
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

  // HTML страницы — stale-while-revalidate (сразу из кеша + обновить в фоне)
  if (request.destination === 'document' || url.pathname.endsWith('.html') || url.pathname === '/') {
    e.respondWith(staleWhileRevalidate(request))
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

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE)
  const cached = await cache.match(req)
  const fresh = fetch(req).then(res => {
    if (res.ok) cache.put(req, res.clone())
    return res
  }).catch(() => cached || new Response('', { status: 503, statusText: 'Service Unavailable' }))
  return cached || fresh
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
