const AUTH_API = window.location.hostname.endsWith('github.io')
  ? 'https://nazeleniy.mooo.com'
  : ''

async function initAuthButton() {
  const container = document.getElementById('auth-btn')
  if (!container) return

  try {
    const res = await fetch(AUTH_API + '/api/me', { credentials: 'include' })
    if (res.ok) {
      const data = await res.json()
      const name = data.name || 'Профиль'
      container.innerHTML = `
        <button class="auth-btn auth-btn--out" onclick="authLogout()" title="Выйти">
          <span>${name}</span>
        </button>`
    } else {
      renderLoginBtn(container)
    }
  } catch {
    renderLoginBtn(container)
  }
}

function renderLoginBtn(container) {
  container.innerHTML = `
    <a href="/login.html" class="auth-btn auth-btn--in">
      <span>Войти</span>
    </a>`
}

async function authLogout() {
  await fetch(AUTH_API + '/auth/logout', { method: 'POST', credentials: 'include' })
  location.reload()
}

initAuthButton()
