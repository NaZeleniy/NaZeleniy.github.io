// Если auth-modal.js не загружен (страницы с #auth-btn прямо в HTML),
// подгружаем его — берём версию из собственного тега <script>
if (typeof openAuthModal === 'undefined') {
  ;(function () {
    const src = (document.querySelector('script[src*="auth.js"]') || {}).src || ''
    const v   = (src.match(/[?&]v=\d+/) || [''])[0]
    const s   = document.createElement('script')
    s.src     = 'js/auth-modal.js' + v
    document.body.appendChild(s)
  })()
}

const _USER_CACHE_KEY = 'nz_me'
const _CACHE_TTL = 15 * 60 * 1000 // 15 минут

// Безопасный геттер: API_BASE может быть не определён если api.js загружается с defer
// а auth.js — синхронный скрипт (index.html). Дублирует логику из auth-modal.js._api().
function _apiBase() {
  if (typeof API_BASE !== 'undefined') return API_BASE
  return location.hostname.endsWith('github.io') ? 'https://nazeleniy.site' : ''
}

function _getCachedUser() {
  try {
    const raw = localStorage.getItem(_USER_CACHE_KEY)
    if (!raw) return null
    const { data, ts } = JSON.parse(raw)
    if (!data) return null
    return { data, stale: Date.now() - ts > _CACHE_TTL }
  } catch { return null }
}

function _setCachedUser(data) {
  try {
    if (data) localStorage.setItem(_USER_CACHE_KEY, JSON.stringify({ data, ts: Date.now() }))
    else localStorage.removeItem(_USER_CACHE_KEY)
  } catch {}
}

// quickCheck=true (стейл кеш): GET /auth/check → если сессия жива, обновляем timestamp кеша;
//   если истекла — очищаем, рендерим «Войти». Имя уже в кеше, DB не нужна.
// quickCheck=false (нет кеша): GET /auth/check → если не авторизован, «Войти» (без DB, без 401
//   в консоли); если авторизован — GET /api/me за именем, кешируем, рендерим кнопку с именем.
function _bearerHeaderAuth() {
  try {
    const t = localStorage.getItem('nz_bearer')
    return t ? { Authorization: 'Bearer ' + t } : {}
  } catch { return {} }
}

// Аналог _CREDS из api.js — auth.js может загружаться до api.js (index.html)
function _credsMode() {
  const base = _apiBase()
  if (!base) return 'include'
  if (typeof location !== 'undefined' && location.origin === 'null') return 'omit'
  return 'include'
}

async function _revalidateUser(container, quickCheck = false) {
  if (quickCheck) {
    try {
      const res = await fetch(_apiBase() + '/auth/check', { credentials: _credsMode(), headers: _bearerHeaderAuth() })
      if (res.ok) {
        const data = await res.json()
        if (data.authenticated) {
          // Обновляем timestamp — без этого кеш останется стейл и quickCheck
          // сработает снова на каждой следующей странице
          _setCachedUser(window._nzUser)
        } else {
          window._nzUser = null
          _setCachedUser(null)
          try { localStorage.removeItem('nz_bearer') } catch {}
          renderLoginBtn(container)
        }
      }
    } catch {
      // Ошибка сети — не сбрасываем кеш, пользователь может быть офлайн
    }
    return
  }

  // Нет кеша — сначала быстрая проверка /auth/check, только если авторизован
  // идём в /api/me за именем. Анонимные пользователи не делают DB-запрос и
  // не получают 401 в консоли.
  let authenticated = false
  try {
    const res = await fetch(_apiBase() + '/auth/check', { credentials: _credsMode(), headers: _bearerHeaderAuth() })
    if (res.ok) authenticated = (await res.json()).authenticated
  } catch {
    // Ошибка сети — рендерим кнопку «Войти», кеш не трогаем
    renderLoginBtn(container)
    return
  }

  if (!authenticated) {
    try { localStorage.removeItem('nz_bearer') } catch {}
    renderLoginBtn(container)
    return
  }

  // Авторизован — нужен полный профиль с именем для кнопки
  try {
    const res = await fetch(_apiBase() + '/api/me', { credentials: _credsMode(), headers: _bearerHeaderAuth() })
    if (res.ok) {
      const data = await res.json()
      window._nzUser = data
      _setCachedUser(data)
      _renderUserBtn(container, data)
    }
  } catch {}
}

async function initAuthButton() {
  const container = document.getElementById('auth-btn')
  if (!container) return

  const cached = _getCachedUser()
  if (cached) {
    window._nzUser = cached.data
    _renderUserBtn(container, cached.data)
    if (cached.stale) _revalidateUser(container, true) // быстрая проверка сессии в фоне
    return
  }

  await _revalidateUser(container) // нет кеша — нужен полный профиль с именем
}

function _escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function _renderUserBtn(container, data) {
  const name = _escapeHtml(data.name || 'Профиль')
  container.innerHTML = `
    <button class="auth-btn auth-btn--out" onclick="authLogout()" title="Выйти">
      <span>${name}</span>
    </button>`
}

function renderLoginBtn(container) {
  container.innerHTML = `
    <button class="auth-btn auth-btn--in" onclick="openAuthModal()">
      <span>Войти</span>
    </button>`
}

async function authLogout() {
  try {
    await fetch(_apiBase() + '/auth/logout', {
      method: 'POST',
      credentials: _credsMode(),
      headers: _bearerHeaderAuth()
    })
  } catch {}
  // Очищаем локальное состояние независимо от результата запроса
  _setCachedUser(null)
  window._nzUser = null
  try { localStorage.removeItem('nz_bearer') } catch {}
  // На защищённых страницах редиректим на главную, иначе просто перерисовываем кнопку
  const protected_ = ['/me']
  if (protected_.some(p => location.pathname === p || location.pathname.startsWith(p + '/'))) {
    location.href = '/'
  } else {
    initAuthButton()
  }
}

initAuthButton()

// После успешного входа через модалку — обновить кнопку в хедере.
// auth-modal.js уже сделал fetch /api/me и установил window._nzUser + кеш,
// поэтому просто рендерим кнопку из готовых данных.
document.addEventListener('nz:auth-success', () => {
  const container = document.getElementById('auth-btn')
  if (!container) return
  if (window._nzUser) {
    _renderUserBtn(container, window._nzUser)
  } else {
    _setCachedUser(null)
    initAuthButton()
  }
})
