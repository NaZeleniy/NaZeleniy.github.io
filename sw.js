const CACHE = 'nz-4'

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

  // Навигации/документы НЕ перехватываем — браузер грузит их сам. Иначе разовый
  // сетевой сбой внутри SW превращается в ERR_FAILED на переходе (reload лечит,
  // следующий клик снова падает). Ассеты (versioned выше) остаются cache-first.
  // Покрывает чистые URL (/, /top, /me), *.html и /movie/{id} (GH Pages 404-shell).
  if (request.mode === 'navigate' || request.destination === 'document' ||
      url.pathname === '/' || url.pathname.endsWith('.html') ||
      /^\/movie\/\d+\/?$/.test(url.pathname)) {
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

async function networkWithFallback(req) {
  try {
    const res = await fetch(req)
    if (res.ok) (await caches.open(CACHE)).put(req, res.clone())
    return res
  } catch {
    return (await caches.match(req)) || new Response('', { status: 503, statusText: 'Service Unavailable' })
  }
}
