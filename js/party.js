const params  = new URLSearchParams(window.location.search)
const movieId = params.get('id')
let   roomId  = params.get('room')

if (!roomId) {
  roomId = 'room-' + Math.random().toString(36).slice(2, 12)
  params.set('room', roomId)
  history.replaceState(null, '', '?' + params.toString())
  localStorage.setItem('nz_host_room_' + roomId, '1')
}

const isCreator = localStorage.getItem('nz_host_room_' + roomId) === '1'

if (!movieId) {
  document.getElementById('partyTitle').textContent = 'ID фильма не указан'
  document.getElementById('partyLoading').innerHTML = '<i class="fas fa-exclamation-circle"></i>'
} else {
  init()
}

// ── Username ─────────────────────────────────────────────────

function generateUsername() {
  const adj = ['Быстрый','Умный','Смелый','Весёлый','Крутой','Ловкий','Мудрый','Ржачный','Пушистый','Дерзкий']
  const noun = ['Зритель','Попкорн','Кот','Пёс','Пельмень','Дракон','Ниндзя','Пират','Бублик','Енот']
  return adj[Math.floor(Math.random() * adj.length)] + ' ' +
         noun[Math.floor(Math.random() * noun.length)] + ' ' +
         Math.floor(1000 + Math.random() * 9000)
}

const username = generateUsername()

// ── UI helpers ───────────────────────────────────────────────

function setStatus(connected) {
  document.getElementById('partyStatus').classList.toggle('connected', connected)
  document.getElementById('partyStatusText').textContent = connected ? 'Подключено' : 'Подключение...'
}

function setViewerCount(n) {
  document.getElementById('partyViewerCount').textContent = n
}

function addChatMessage(user, text, isSystem) {
  const box = document.getElementById('partyChatMessages')
  const div = document.createElement('div')
  if (isSystem) {
    div.className = 'party-chat-system'
    div.textContent = text
  } else {
    div.className = 'party-chat-msg'
    div.innerHTML = `<span class="party-chat-user">${escHtml(user)}</span> <span>${escHtml(text)}</span>`
  }
  box.appendChild(div)
  box.scrollTop = box.scrollHeight
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

// ── WebSocket sync ───────────────────────────────────────────

let ws = null
let isHost = false
let playerReady = false
let currentTime = 0
let isPlaying = false
let reconnectTimer = null
let pingTimer = null
let latency = 0           // половина RTT в секундах
let lastTimeupdateSent = 0
let lastSyncAt = 0        // время последнего принудительного seek
let currentPlaylistId = null
let currentFile = null
let currentAudioTrack = null
const SYNC_THRESHOLD = 1  // секунды
const SYNC_COOLDOWN = 3000  // мс между принудительными seek
const TIMEUPDATE_INTERVAL = 5000  // мс между отправками timeupdate

const wsHost = window.location.hostname.endsWith('github.io') ? 'nazeleniy.mooo.com' : location.host
const wsUrl = (location.protocol === 'https:' ? 'wss' : 'ws') + '://' + wsHost + '/ws/party?room=' + roomId

function connect() {
  ws = new WebSocket(wsUrl)

  ws.onopen = () => {
    setStatus(true)
    clearTimeout(reconnectTimer)
    ws.send(JSON.stringify({ type: 'join', username, isCreator }))
    wsPing()

    const usernameEl = document.getElementById('partyUsernameText')
    const usernameWrap = document.getElementById('partyUsername')
    if (usernameEl) { usernameEl.textContent = username; usernameWrap.style.display = '' }
  }

  ws.onmessage = e => {
    let data
    try { data = JSON.parse(e.data) } catch { return }
    handleServerMessage(data)
  }

  ws.onclose = () => {
    setStatus(false)
    clearTimeout(pingTimer)
    reconnectTimer = setTimeout(connect, 3000)
  }

  ws.onerror = () => ws.close()
}

function wsSend(data) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data))
}

function wsPing() {
  wsSend({ type: 'ping', ts: Date.now() })
  pingTimer = setTimeout(wsPing, 10000)
}

function handleServerMessage(data) {
  switch (data.type) {
    case 'role_assigned':
      isHost = data.isHost
      if (!isHost) {
        document.getElementById('partyViewerOverlay').classList.add('active')
        document.getElementById('partyJoinOverlay').classList.add('active')
      } else {
        startPlayer()
      }
      break

    case 'role_changed':
      isHost = data.isHost
      if (isHost) {
        document.getElementById('partyViewerOverlay').classList.remove('active')
        addChatMessage('', 'Вы стали ведущим', true)
      }
      break

    case 'sync':
      if (!isHost) applySync(data)
      break

    case 'state':
      if (!isHost) applyState(data)
      break

    case 'viewers':
      setViewerCount(data.count)
      break

    case 'chat':
      addChatMessage(data.username, data.message, data.isSystem)
      break

    case 'request_sync':
      if (isHost) wsSend({ type: 'state', time: currentTime, playing: isPlaying, playlistId: currentPlaylistId, file: currentFile, audioTrack: currentAudioTrack })
      break

    case 'pong':
      if (data.ts) latency = (Date.now() - data.ts) / 2 / 1000
      break
  }
}

function sameFile(a, b) {
  if (!a && !b) return true
  if (!a || !b) return false
  return a.fileId === b.fileId && a.playlistIndex === b.playlistIndex && a.playlistId === b.playlistId
}

function applySync(data) {
  if (!playerReady) return
  console.log('[party] applySync', JSON.stringify(data))
  const compensated = (data.time ?? 0) + latency

  // Смена серии/сезона — если event === 'file', всегда применяем (fileId/playlistIndex могут быть null)
  // Для остальных событий — детектируем смену по изменению playlistId или файла
  const fileEvent = data.event === 'file' || data.event === 'playlist_changed'
  const playlistChanged = data.playlistId != null && data.playlistId !== currentPlaylistId
  const fileChanged = data.file != null && !sameFile(data.file, currentFile)
  if (fileEvent || playlistChanged || fileChanged) {
    if (data.playlistId != null) currentPlaylistId = data.playlistId
    if (data.file != null) currentFile = data.file
    currentAudioTrack = null
    // Плеер не поддерживает программное переключение эпизодов — уведомляем зрителя
    if (data.playlistInfo?.title) showEpisodeNotification(data.playlistInfo.title)
    return
  }

  switch (data.event) {
    case 'play':
    case 'started':
    case 'start':
      sendPlayerCommand('play')
      isPlaying = true
      if (Math.abs(currentTime - compensated) > SYNC_THRESHOLD)
        sendPlayerCommand('seek', compensated)
      break
    case 'pause':
      sendPlayerCommand('pause')
      break
    case 'seek':
      sendPlayerCommand('seek', compensated)
      isPlaying = true
      break
    case 'timeupdate':
      if (isPlaying && Math.abs(currentTime - compensated) > SYNC_THRESHOLD) {
        if (Date.now() - lastSyncAt > SYNC_COOLDOWN) {
          lastSyncAt = Date.now()
          sendPlayerCommand('seek', compensated)
        }
      }
      break
    case 'audiotrack_changed':
      if (data.audioTrack != null) {
        currentAudioTrack = data.audioTrack
        const idx = Array.isArray(data.audioTracks) ? data.audioTracks.indexOf(data.audioTrack) : -1
        sendPlayerCommand('audiotrack', idx >= 0 ? idx : data.audioTrack)
      }
      break
  }
}

function applyState(data) {
  if (!playerReady) return
  const playlistChanged = data.playlistId != null && data.playlistId !== currentPlaylistId
  const fileChanged = data.file != null && !sameFile(data.file, currentFile)
  if (playlistChanged || fileChanged) {
    if (data.playlistId != null) currentPlaylistId = data.playlistId
    if (data.file != null) currentFile = data.file
    const rawFile = data.file || { playlistId: data.playlistId }
    const fileObj = Object.fromEntries(Object.entries(rawFile).filter(([, v]) => v != null))
    sendPlayerCommand('file', fileObj)
  } else if (data.file && !data.playlistId) {
    const fileObj = Object.fromEntries(Object.entries(data.file).filter(([, v]) => v != null))
    sendPlayerCommand('file', fileObj)
  }
  if (data.audioTrack != null && data.audioTrack !== currentAudioTrack) {
    currentAudioTrack = data.audioTrack
    const idx = Array.isArray(data.audioTracks) ? data.audioTracks.indexOf(data.audioTrack) : -1
    sendPlayerCommand('audiotrack', idx >= 0 ? idx : data.audioTrack)
  }
  const compensated = (data.time ?? 0) + latency
  if (Math.abs(currentTime - compensated) > SYNC_THRESHOLD)
    sendPlayerCommand('seek', compensated)
  if (data.playing && !isPlaying) { sendPlayerCommand('play'); isPlaying = true }
  else if (!data.playing && isPlaying) { sendPlayerCommand('pause'); isPlaying = false }
}

// ── Player commands ──────────────────────────────────────────

function sendPlayerCommand(command, value) {
  const frame = document.getElementById('vibix-frame')
  if (!frame || !frame.contentWindow) return
  console.log('[party] sendPlayerCommand', command, JSON.stringify(value))
  frame.contentWindow.postMessage({ type: 'playerCommand', command, value, timestamp: Date.now() }, '*')
}

// ── Episode notification ─────────────────────────────────────

function showEpisodeNotification(title) {
  const notif = document.getElementById('partyEpisodeNotif')
  if (!notif) return
  notif.textContent = 'Хост переключил: ' + title + ' — выберите серию в плеере'
  notif.style.display = 'block'
  clearTimeout(notif._t)
  notif._t = setTimeout(() => { notif.style.display = 'none' }, 7000)
}

// ── Player events ────────────────────────────────────────────

window.addEventListener('message', e => {
  const data = e.data
  if (!data || data.type !== 'playerEvent') return

  console.log('[party] playerEvent', JSON.stringify(data))

  const ev = data.event

  if (ev === 'ready' || ev === 'sync_ready') {
    playerReady = true
    document.getElementById('partyLoading').style.display = 'none'
    return
  }

  if (data.time !== undefined) currentTime = data.time

  if (ev === 'play' || ev === 'started' || ev === 'start') isPlaying = true
  if (ev === 'pause' || ev === 'end') isPlaying = false

  if (!isHost) return

  const syncEvents = ['play', 'pause', 'seek', 'timeupdate', 'started', 'start', 'file', 'playlist_changed', 'audiotrack_changed']
  if (!syncEvents.includes(ev)) return

  if (ev === 'seek' || ev === 'play' || ev === 'started') lastTimeupdateSent = 0

  if (ev === 'timeupdate') {
    const now = Date.now()
    if (now - lastTimeupdateSent < TIMEUPDATE_INTERVAL) return
    lastTimeupdateSent = now
  }

  if (ev === 'file' || ev === 'playlist_changed') {
    if (data.playlistId != null) currentPlaylistId = data.playlistId
    if (data.file != null) currentFile = data.file
  }
  if (ev === 'audiotrack_changed' && data.audioTrack != null) {
    currentAudioTrack = data.audioTrack
  }

  wsSend({ type: 'sync', event: ev, time: data.time, playlistId: data.playlistId ?? null, file: data.file ?? null, audioTrack: data.audioTrack ?? null, audioTracks: data.audioTracks ?? null, playlistInfo: data.playlistInfo ?? null })
})

// ── Vibix player ─────────────────────────────────────────────

let _vibixScriptLoaded = false

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

  connect()

  document.getElementById('partyJoinBtn').addEventListener('click', async () => {
    document.getElementById('partyJoinOverlay').classList.remove('active')
    await startPlayer()
    wsSend({ type: 'request_sync' })
  })
}

async function startPlayer() {
  try {
    const r = await fetch(`${API_BASE}/api/movie/${movieId}`)
    if (!r.ok) throw new Error()
    const movie = await r.json()
    const vibix = (movie.players || []).find(p => p.name === 'Vibix')
    if (!vibix) throw new Error('Vibix недоступен')

    const slot = document.getElementById('vibix-slot')
    slot.innerHTML = `<ins data-publisher-id="677393820" data-type="kp" data-id="${vibix.url}" data-design="2" data-sync="true" data-color1="#333333" data-color2="#666666" data-color3="#999999" data-color4="#CCCCCC" data-color5="#FFFFFF"></ins>`

    const waitForIframe = () => new Promise(resolve => {
      const existing = slot.querySelector('iframe')
      if (existing) { resolve(existing); return }
      const obs = new MutationObserver(() => {
        const f = slot.querySelector('iframe')
        if (f) { obs.disconnect(); resolve(f) }
      })
      obs.observe(slot, { childList: true, subtree: true })
    })

    if (_vibixScriptLoaded) {
      const frame = await waitForIframe()
      frame.id = 'vibix-frame'
      document.getElementById('partyLoading').style.display = 'none'
      playerReady = true
    } else {
      const script = document.createElement('script')
      script.src = 'https://graphicslab.io/sdk/v2/rendex-sdk.min.js'
      script.onload = async () => {
        _vibixScriptLoaded = true
        const frame = await waitForIframe()
        frame.id = 'vibix-frame'
        document.getElementById('partyLoading').style.display = 'none'
        playerReady = true
      }
      script.onerror = () => {
        document.getElementById('partyLoading').innerHTML =
          '<i class="fas fa-exclamation-circle"></i><span>Ошибка загрузки плеера</span>'
      }
      document.head.appendChild(script)
    }
  } catch (e) {
    document.getElementById('partyLoading').innerHTML =
      `<i class="fas fa-exclamation-circle"></i><span>${e.message || 'Ошибка загрузки плеера'}</span>`
  }
}

// ── Chat ─────────────────────────────────────────────────────

function sendMessage() {
  const input = document.getElementById('partyChatInput')
  if (!input || !input.value.trim()) return
  const text = input.value.trim()
  wsSend({ type: 'chat', message: text })
  addChatMessage(username, text, false)
  input.value = ''
}

// ── Copy link ─────────────────────────────────────────────────

function copyLink() {
  const url = location.origin + location.pathname + '?id=' + movieId + '&room=' + roomId
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.getElementById('copyBtnText')
    btn.textContent = 'Скопировано!'
    setTimeout(() => { btn.textContent = 'Скопировать ссылку' }, 2000)
  })
}
