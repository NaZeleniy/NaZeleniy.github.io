const params  = new URLSearchParams(window.location.search)
const movieId = params.get('id')
let   roomId  = params.get('room')

// Если комнаты нет — мы создатель, запомним это в localStorage
if (!roomId) {
  roomId = 'room-' + Math.random().toString(36).slice(2, 12)
  localStorage.setItem('party_host_' + roomId, '1')
  const p = new URLSearchParams(window.location.search)
  p.set('room', roomId)
  history.replaceState(null, '', '?' + p.toString())
}

// Хост — тот у кого в localStorage есть флаг для этой комнаты
const isHost = localStorage.getItem('party_host_' + roomId) === '1'

if (!movieId) {
  document.getElementById('partyTitle').textContent = 'ID фильма не указан'
  document.getElementById('partyLoading').innerHTML = '<i class="fas fa-exclamation-circle"></i>'
} else {
  init()
}

async function init() {

  try {
    const r = await fetch(`${API_BASE}/api/movie/${movieId}`)
    if (r.ok) {
      const movie = await r.json()
      const title = movie.nameRu || movie.nameEn || 'Без названия'
      document.title = title + ' — Совместный просмотр'
      document.getElementById('partyTitle').textContent = title
    }
  } catch {}

  startVibix()
}

function startVibix() {
  const slot = document.getElementById('vibix-slot')
  slot.innerHTML = `<ins
    data-publisher-id="677393820"
    data-type="kp"
    data-id="${movieId}"
    data-design="2"
    data-sync="true"
    data-color1="#333333"
    data-color2="#666666"
    data-color3="#999999"
    data-color4="#CCCCCC"
    data-color5="#FFFFFF"></ins>`

  const script = document.createElement('script')
  script.src = 'https://graphicslab.io/sdk/v2/rendex-sdk.min.js'
  script.onload = () => {
    const existing = slot.querySelector('iframe')
    if (existing) { onIframe(existing); return }
    const observer = new MutationObserver(() => {
      const iframe = slot.querySelector('iframe')
      if (iframe) { observer.disconnect(); onIframe(iframe) }
    })
    observer.observe(slot, { childList: true, subtree: true })
  }
  document.head.appendChild(script)
}

function onIframe(iframe) {
  iframe.id = 'vibix-frame'
  iframe.addEventListener('load', () => {
    document.getElementById('partyLoading').style.display = 'none'
    if (!isHost) {
      document.getElementById('partyViewerOverlay').classList.add('active')
    }
    startWatchParty()
  }, { once: true })
}

function startWatchParty() {
  if (typeof WatchParty === 'undefined') return
  new WatchParty({ iframe: '#vibix-frame', roomId, debug: false })
  watchWidget()
}

// Наблюдаем за виджетом и синхронизируем данные в наш UI
function watchWidget() {
  const poll = setInterval(() => {
    const widget = document.querySelector('.watch-party-ui')
    if (!widget) return
    clearInterval(poll)

    // Статус подключения
    const statusEl = widget.querySelector('#wp-status')
    const updateStatus = () => {
      const connected = statusEl?.classList.contains('connected')
      const dot = document.getElementById('partyStatus')
      const text = document.getElementById('partyStatusText')
      if (dot) dot.classList.toggle('connected', !!connected)
      if (text) text.textContent = connected ? 'Подключено' : 'Подключение...'
    }
    if (statusEl) {
      updateStatus()
      new MutationObserver(updateStatus).observe(statusEl, { attributes: true, attributeFilter: ['class'] })
    }

    // Счётчик зрителей
    const countEl = widget.querySelector('#wp-viewer-count')
    const updateCount = () => {
      const el = document.getElementById('partyViewerCount')
      if (el && countEl) el.textContent = countEl.textContent.trim()
    }
    if (countEl) {
      updateCount()
      new MutationObserver(updateCount).observe(countEl, { childList: true, characterData: true, subtree: true })
    }

    // Сообщения чата
    const chatEl = widget.querySelector('#wp-chat-messages')
    if (chatEl) {
      syncMessages(chatEl)
      new MutationObserver(() => syncMessages(chatEl)).observe(chatEl, { childList: true, subtree: true })
    }

    // Ник пользователя
    const usernameEl = widget.querySelector('#wp-username-display')
    if (usernameEl) {
      const updateUsername = () => {
        const raw = usernameEl.textContent.trim()
        const name = raw.replace(/^Ваше имя:\s*/i, '')
        const el = document.getElementById('partyUsernameText')
        const wrap = document.getElementById('partyUsername')
        if (el && name) { el.textContent = name; wrap.style.display = '' }
      }
      updateUsername()
      new MutationObserver(updateUsername).observe(usernameEl, { childList: true, characterData: true, subtree: true })
    }

    // Запасной polling — на случай если MutationObserver пропустил обновление
    setInterval(() => { updateStatus(); updateCount() }, 2000)

  }, 200)
}

function syncMessages(sourceEl) {
  const target = document.getElementById('partyChatMessages')
  if (!target) return
  target.innerHTML = ''
  sourceEl.querySelectorAll('.wp-chat-message').forEach(msg => {
    const div = document.createElement('div')
    div.className = msg.classList.contains('system') ? 'party-chat-system' : 'party-chat-msg'
    if (msg.classList.contains('system')) {
      div.textContent = msg.textContent.trim()
    } else {
      const user = msg.querySelector('.wp-chat-username')
      const text = msg.querySelector('.wp-chat-text')
      div.innerHTML = `<span class="party-chat-user">${user?.textContent || ''}</span> <span>${text?.textContent || ''}</span>`
    }
    target.appendChild(div)
  })
  target.scrollTop = target.scrollHeight
}

function sendMessage() {
  const input = document.getElementById('partyChatInput')
  const wpInput = document.querySelector('#wp-chat-input')
  const wpSend = document.querySelector('#wp-chat-send')
  if (!input || !wpInput || !wpSend || !input.value.trim()) return
  wpInput.value = input.value
  wpInput.dispatchEvent(new Event('input', { bubbles: true }))
  wpSend.click()
  input.value = ''
}

function copyLink() {
  const url = location.origin + location.pathname + '?id=' + movieId + '&room=' + roomId
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.getElementById('copyBtnText')
    btn.textContent = 'Скопировано!'
    setTimeout(() => { btn.textContent = 'Скопировать ссылку' }, 2000)
  })
}
