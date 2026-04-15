(function () {
  // ── Inject modal HTML ─────────────────────────────────────────────
  document.body.insertAdjacentHTML('beforeend', `
    <div id="auth-modal" class="auth-modal" hidden
         role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
      <div class="auth-modal-backdrop"></div>
      <div class="auth-modal-card login-card">
        <button class="auth-modal-close" aria-label="Закрыть"><i class="fas fa-times"></i></button>
        <div class="login-logo"><i class="fab fa-telegram"></i></div>
        <h2 class="login-title" id="auth-modal-title">Войти через Telegram</h2>
        <p class="login-subtitle">Откройте бота и подтвердите вход</p>
        <div id="auth-modal-body"></div>
      </div>
    </div>`)

  // ── State ─────────────────────────────────────────────────────────
  let _step = 'idle'
  let _token = '', _botUrl = '', _errorMsg = ''
  let _timeLeft = 300
  let _pollTimer = null, _countdownTimer = null, _doneCbTimer = null
  let _successCb = null
  let _prevFocus = null       // фокус до открытия — восстанавливаем при закрытии
  let _bodyOverflow = ''      // сохранённое body.style.overflow
  let _qrLoading = false
  let _qrPollTimer = null     // интервал ожидания QRCode — нужно очищать

  function _api() {
    if (typeof API_BASE !== 'undefined') return API_BASE
    return location.hostname.endsWith('github.io') ? 'https://nazeleniy.site' : ''
  }
  const _modal = () => document.getElementById('auth-modal')
  const _body  = () => document.getElementById('auth-modal-body')

  // ── QR lazy loader ────────────────────────────────────────────────
  function _withQR(cb) {
    if (typeof QRCode !== 'undefined') { cb(); return }

    // Очистить предыдущий опрос, если есть (предотвращает дублирующиеся интервалы)
    if (_qrPollTimer) { clearInterval(_qrPollTimer); _qrPollTimer = null }

    if (!_qrLoading) {
      _qrLoading = true
      const s = document.createElement('script')
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'
      s.crossOrigin = 'anonymous'
      s.onerror = () => { _qrLoading = false } // CDN недоступен — сбросить флаг
      document.head.appendChild(s)
    }

    let attempts = 0
    const MAX_ATTEMPTS = 100 // 8 секунд при 80ms
    _qrPollTimer = setInterval(() => {
      attempts++
      if (typeof QRCode !== 'undefined') {
        clearInterval(_qrPollTimer); _qrPollTimer = null
        cb()
      } else if (attempts >= MAX_ATTEMPTS) {
        clearInterval(_qrPollTimer); _qrPollTimer = null
        // QR не загрузился — QR-блок просто останется пустым, кнопка Telegram всё равно есть
      }
    }, 80)
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
      // Проверяем что URL пришёл с нашего бэкенда и является безопасным
      const safeUrl = _botUrl && /^https:\/\//.test(_botUrl) ? _esc(_botUrl) : '#'
      body.innerHTML = `
        <div class="login-waiting">
          <div id="_am_qr" class="login-qr"></div>
          <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="login-tg-btn">
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
        try {
          new QRCode(el, {
            text: _botUrl, width: 200, height: 200,
            colorDark: '#000', colorLight: '#fff',
            correctLevel: QRCode.CorrectLevel.M,
          })
        } catch {}
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

    // Фокус на первой интерактивной кнопке в теле модалки
    const btn = body.querySelector('button, a[href]')
    if (btn) btn.focus()
  }

  // ── Flow ──────────────────────────────────────────────────────────
  async function _start() {
    _step = 'loading'; _render()
    try {
      const res = await fetch(_api() + '/auth/telegram/start', { method: 'POST', credentials: 'include' })
      if (_step !== 'loading') return // модалка закрыта/сброшена пока шёл запрос
      if (!res.ok) throw new Error()
      const d = await res.json()
      if (_step !== 'loading') return // повторная проверка после json()
      _token = d.token; _botUrl = d.bot_url
      _step = 'waiting'; _render()
      _startPolling(); _startCountdown()
    } catch {
      if (_step !== 'loading') return // модалка закрыта/сброшена — не показывать ошибку
      _errorMsg = 'Не удалось получить ссылку. Попробуйте снова.'
      _step = 'error'; _render()
    }
  }

  function _startPolling() {
    _pollTimer = setInterval(async () => {
      try {
        const res = await fetch(
          _api() + '/auth/telegram/status?token=' + encodeURIComponent(_token),
          { credentials: 'include' }
        )
        if (!res.ok) return
        const d = await res.json()
        if (d.status === 'ok') {
          _stopTimers(); _step = 'done'; _render()
          try { localStorage.removeItem('nz_me') } catch {}
          _doneCbTimer = setTimeout(() => {
            _doneCbTimer = null
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
    if (_qrPollTimer) { clearInterval(_qrPollTimer); _qrPollTimer = null }
    if (_doneCbTimer) { clearTimeout(_doneCbTimer); _doneCbTimer = null }
    _pollTimer = null; _countdownTimer = null
  }

  function _reset() {
    _stopTimers(); _token = ''; _botUrl = ''; _timeLeft = 300; _step = 'idle'; _render()
  }

  // ── Focus trap (Tab не уходит за бэкдроп) ────────────────────────
  document.addEventListener('keydown', e => {
    const m = _modal(); if (!m || m.hidden) return
    if (e.key !== 'Tab') return
    const focusable = Array.from(
      m.querySelectorAll('button:not([disabled]), a[href], input, [tabindex]:not([tabindex="-1"])')
    ).filter(el => !el.closest('[hidden]'))
    if (!focusable.length) { e.preventDefault(); return }
    const first = focusable[0], last = focusable[focusable.length - 1]
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus() }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus() }
    }
  })

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
    _prevFocus = document.activeElement
    _bodyOverflow = document.body.style.overflow
    _reset()

    const m = _modal()
    m.hidden = false
    document.body.style.overflow = 'hidden'

    // Переиграть анимацию появления при каждом открытии
    const card = m.querySelector('.auth-modal-card')
    if (card) {
      card.style.animation = 'none'
      void card.offsetHeight // принудительный reflow
      card.style.animation = ''
    }

    // Фокус в модалку (если _render ещё не поставил его на кнопку)
    const btn = m.querySelector('.auth-modal-card button, .auth-modal-card a[href]')
    if (btn) btn.focus()
  }

  window.closeAuthModal = function () {
    _stopTimers()
    const m = _modal(); if (m) m.hidden = true
    document.body.style.overflow = _bodyOverflow

    // Вернуть фокус туда откуда открыли
    if (_prevFocus && typeof _prevFocus.focus === 'function') {
      try { _prevFocus.focus() } catch {}
      _prevFocus = null
    }
  }
})()
