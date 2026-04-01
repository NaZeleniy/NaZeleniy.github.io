const params  = new URLSearchParams(window.location.search)
const movieId = params.get('id')
let   roomId  = params.get('room')

if (!movieId) {
  document.getElementById('partyTitle').textContent = 'ID фильма не указан'
  document.getElementById('partyLoading').innerHTML = '<i class="fas fa-exclamation-circle"></i>'
} else {
  init()
}

async function init() {
  // Если комнаты нет — генерируем и обновляем URL
  if (!roomId) {
    roomId = 'room-' + Math.random().toString(36).slice(2, 12)
    const p = new URLSearchParams(window.location.search)
    p.set('room', roomId)
    history.replaceState(null, '', '?' + p.toString())
  }

  // Обновляем ссылку «К фильму»
  document.getElementById('backBtn').href = 'movie.html?id=' + movieId

  // Загружаем данные фильма для заголовка и фона
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
    startWatchParty()
  }, { once: true })
}

function startWatchParty() {
  if (typeof WatchParty === 'undefined') return
  new WatchParty({
    iframe: '#vibix-frame',
    roomId: roomId,
    debug: false
  })
}

function copyLink() {
  const url = location.origin + location.pathname + '?id=' + movieId + '&room=' + roomId
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.getElementById('copyBtnText')
    btn.textContent = 'Скопировано!'
    setTimeout(() => { btn.textContent = 'Скопировать ссылку' }, 2000)
  })
}
