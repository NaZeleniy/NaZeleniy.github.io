const AUTH_API = window.location.hostname.endsWith('github.io')
  ? 'https://nazeleniy.site'
  : ''

const _USER_CACHE_KEY = 'nz_me'

function _getCachedUser() {
  try {
    const raw = sessionStorage.getItem(_USER_CACHE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function _setCachedUser(data) {
  try {
    if (data) sessionStorage.setItem(_USER_CACHE_KEY, JSON.stringify(data))
    else sessionStorage.removeItem(_USER_CACHE_KEY)
  } catch {}
}

async function initAuthButton() {
  const container = document.getElementById('auth-btn')
  if (!container) return

  const cached = _getCachedUser()
  if (cached) {
    window._nzUser = cached
    _renderUserBtn(container, cached)
    return
  }

  try {
    const res = await fetch(AUTH_API + '/api/me', { credentials: 'include' })
    if (res.ok) {
      const data = await res.json()
      window._nzUser = data
      _setCachedUser(data)
      _renderUserBtn(container, data)
    } else {
      window._nzUser = null
      renderLoginBtn(container)
    }
  } catch {
    window._nzUser = null
    renderLoginBtn(container)
  }
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
    <a href="/login.html" class="auth-btn auth-btn--in">
      <span>Войти</span>
    </a>`
}

async function authLogout() {
  await fetch(AUTH_API + '/auth/logout', { method: 'POST', credentials: 'include' })
  _setCachedUser(null)
  window._nzUser = null
  location.href = '/'
}

initAuthButton()
