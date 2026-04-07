async function initAuthButton() {
  const container = document.getElementById('auth-btn')
  if (!container) return

  try {
    const res = await fetch('/api/me')
    if (res.ok) {
      container.innerHTML = `
        <button class="auth-btn auth-btn--out" onclick="authLogout()">
          <i class="fab fa-telegram"></i>
          <span>Выйти</span>
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
      <i class="fab fa-telegram"></i>
      <span>Войти</span>
    </a>`
}

async function authLogout() {
  await fetch('/auth/logout', { method: 'POST' })
  location.reload()
}

initAuthButton()
