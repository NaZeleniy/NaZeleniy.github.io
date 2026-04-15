(function () {
  // ── Inject modal HTML ─────────────────────────────────────────────
  document.body.insertAdjacentHTML('beforeend', `
    <div id="auth-modal" class="auth-modal" hidden>
      <div class="auth-modal-backdrop"></div>
      <div class="auth-modal-card login-card">
        <button class="auth-modal-close" aria-label="Закрыть"><i class="fas fa-times"></i></button>
        <div class="login-logo"><i class="fab fa-telegram"></i></div>
        <h2 class="login-title">Войти через Telegram</h2>
        <p class="login-subtitle">Откройте бота и подтвердите вход</p>
        <div id="auth-modal-body"></div>
      </div>
    </div>`)

  // ── State ─────────────────────────────────────────────────────────
  let _step = 'idle'
  let _token = '', _botUrl = '', _errorMsg = ''
  let _timeLeft = 300
  let _pollTimer = null, _countdownTimer = null
  let _successCb = null
  let _qrLoading = false

  function _api() {
    if (typeof API_BASE !== 'undefined') return API_BASE
    return location.hostname.endsWith('github.io') ? 'https://nazeleniy.site' : ''
  }
  const _modal = () => document.getElementById('auth-modal')
  const _body  = () => document.getElementById('auth-modal-body')

  // ── QR lazy loader ────────────────────────────────────────────────
  function _withQR(cb) {
    if (typeof QRCode !== 'undefined') { cb(); return }
    if (!_qrLoading) {
      _qrLoading = true
      const s = document.createElement('script')
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'
      s.crossOrigin = 'anonymous'
      document.head.appendChild(s)
    }
    const t = setInterval(() => { if (typeof QRCode !== 'undefined') { clearInterval(t); cb() } }, 80)
  }

  function _esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
  }

  // ── Render ────────────────────────────────────────────────────────
  function _render() {
    const body = _body(); if (!body) return

    if (_step === 'idle') {
      body.innerHTML = `
        <button class="login-start-btn" id="_am_s">
          <i class="fab fa-telegram"></i> Получить ссылку для входа
        </button>`
      document.getElementById('_am_s').onclick = _start

    } else if (_step === 'loading') {
      body.innerHTML = `<div class="login-spinner"><i class="fas fa-circle-notch fa-spin"></i></div>`

    } else if (_step === 'waiting') {
      body.innerHTML = `
        <div class="login-waiting">
          <div id="_am_qr" class="login-qr"></div>
          <a href="${_esc(_botUrl)}" target="_blank" rel="noopener" class="login-tg-btn">
            <i class="fab fa-telegram"></i> Открыть Telegram
          </a>
          <div class="login-status">
            <i class="fas fa-circle-notch fa-spin"></i>
            Ожидаем подтверждения…
            <span class="login-timer" id="_am_t">(${_timeLeft}с)</span>
          </div>
          <div class="login-security-note">
            <i class="fas fa-shield-alt"></i>
            <span>Это <strong>не авторизация через Telegram</strong> — мы не получаем доступ к вашему аккаунту. QR-код открывает нашего бота, который просто подтверждает что это вы.</span>
          </div>
        </div>`
      _withQR(() => {
        const el = document.getElementById('_am_qr')
        if (!el || !_botUrl) return
        el.innerHTML = ''
        new QRCode(el, {
          text: _botUrl, width: 200, height: 200,
          colorDark: '#000', colorLight: '#fff',
          correctLevel: QRCode.CorrectLevel.M,
        })
      })

    } else if (_step === 'done') {
      body.innerHTML = `
        <div class="login-done">
          <i class="fas fa-check-circle"></i>
          <span>Вход выполнен!</span>
        </div>`

    } else if (_step === 'error') {
      body.innerHTML = `
        <div class="login-error">
          <i class="fas fa-exclamation-circle"></i>
          <span>${_esc(_errorMsg)}</span>
          <button class="login-retry-btn" id="_am_r">Попробовать снова</button>
        </div>`
      document.getElementById('_am_r').onclick = _reset
    }
  }

  // ── Flow ──────────────────────────────────────────────────────────
  async function _start() {
    _step = 'loading'; _render()
    try {
      const res = await fetch(_api() + '/auth/telegram/start', { method: 'POST', credentials: 'include' })
      if (!res.ok) throw new Error()
      const d = await res.json()
      _token = d.token; _botUrl = d.bot_url
      _step = 'waiting'; _render()
      _startPolling(); _startCountdown()
    } catch {
      _errorMsg = 'Не удалось получить ссылку. Попробуйте снова.'
      _step = 'error'; _render()
    }
  }

  function _startPolling() {
    _pollTimer = setInterval(async () => {
      try {
        const res = await fetch(_api() + '/auth/telegram/status?token=' + _token, { credentials: 'include' })
        if (!res.ok) return
        const d = await res.json()
        if (d.status === 'ok') {
          _stopTimers(); _step = 'done'; _render()
          try { localStorage.removeItem('nz_me') } catch {}
          setTimeout(() => {
            closeAuthModal()
            document.dispatchEvent(new CustomEvent('nz:auth-success'))
            if (typeof _successCb === 'function') { _successCb(); _successCb = null }
          }, 700)
        }
      } catch {}
    }, 2000)
  }

  function _startCountdown() {
    _timeLeft = 300
    _countdownTimer = setInterval(() => {
      _timeLeft--
      const t = document.getElementById('_am_t')
      if (t) t.textContent = `(${_timeLeft}с)`
      if (_timeLeft <= 0) {
        _stopTimers()
        _errorMsg = 'Время ожидания истекло. Попробуйте снова.'
        _step = 'error'; _render()
      }
    }, 1000)
  }

  function _stopTimers() {
    clearInterval(_pollTimer); clearInterval(_countdownTimer)
    _pollTimer = null; _countdownTimer = null
  }

  function _reset() {
    _stopTimers(); _token = ''; _botUrl = ''; _timeLeft = 300; _step = 'idle'; _render()
  }

  // ── Close on backdrop / ✕ / ESC ───────────────────────────────────
  document.addEventListener('click', e => {
    const m = _modal(); if (!m || m.hidden) return
    if (e.target.closest('.auth-modal-close') || e.target.classList.contains('auth-modal-backdrop'))
      closeAuthModal()
  })
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { const m = _modal(); if (m && !m.hidden) closeAuthModal() }
  })

  // ── Public API ────────────────────────────────────────────────────
  window.openAuthModal = function (onSuccess) {
    _successCb = onSuccess || null
    _reset()
    _modal().hidden = false
    document.body.style.overflow = 'hidden'
  }
  window.closeAuthModal = function () {
    _stopTimers(); _modal().hidden = true; document.body.style.overflow = ''
  }
})()
