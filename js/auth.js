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

async function _revalidateUser(container) {
  try {
    const res = await fetch(_apiBase() + '/api/me', { credentials: 'include' })
    if (res.ok) {
      const data = await res.json()
      window._nzUser = data
      _setCachedUser(data)
      _renderUserBtn(container, data)
    } else {
      window._nzUser = null
      _setCachedUser(null)
      renderLoginBtn(container)
    }
  } catch {
    // При ошибке сети не сбрасываем кеш — пользователь может быть офлайн
    if (!window._nzUser) renderLoginBtn(container)
  }
}

async function initAuthButton() {
  const container = document.getElementById('auth-btn')
  if (!container) return

  const cached = _getCachedUser()
  if (cached) {
    window._nzUser = cached.data
    _renderUserBtn(container, cached.data)
    if (cached.stale) _revalidateUser(container) // обновляем в фоне, не блокируя рендер
    return
  }

  await _revalidateUser(container)
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
  await fetch(_apiBase() + '/auth/logout', { method: 'POST', credentials: 'include' })
  _setCachedUser(null)
  window._nzUser = null
  location.href = '/'
}

initAuthButton()

// После успешного входа через модалку — обновить кнопку в хедере
document.addEventListener('nz:auth-success', () => {
  _setCachedUser(null) // сбросим устаревший кеш, получим свежие данные
  initAuthButton()
})
