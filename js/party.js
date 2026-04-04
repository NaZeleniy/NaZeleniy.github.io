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
const USE_NATIVE_WATCH_PARTY = true
let nativeParty = null
let watchPartyPrototypePatched = false
const NATIVE_ONLY_EVENTS = new Set(['file', 'playlist_changed'])

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
let pendingRemoteFile = null
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
      if (!isHost) {
        console.log('[party][viewer] ws sync', JSON.stringify(data))
        applySync(data)
      }
      break

    case 'state':
      if (!isHost) {
        console.log('[party][viewer] ws state', JSON.stringify(data))
        applyState(data)
      }
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
function normalizeFileData(data) {
  if (!data) return null

  if (data.file && typeof data.file === 'object') {
    return { ...data.file }
  }

  const fileObj = {}
  const keys = ['playlistId', 'fileId', 'playlistIndex', 'seasonId', 'seasonIndex', 'episodeId', 'episodeIndex']
  let hasAny = false
  for (const key of keys) {
    if (key in data) {
      fileObj[key] = data[key]
      hasAny = true
    }
  }

  if (!hasAny && data.playlistId != null) {
    return { playlistId: data.playlistId, fileId: null, playlistIndex: null }
  }

  return hasAny ? fileObj : null
}

function sameFile(a, b) {
  if (!a && !b) return true
  if (!a || !b) return false
  return a.playlistId === b.playlistId
    && a.fileId === b.fileId
    && a.playlistIndex === b.playlistIndex
    && a.seasonId === b.seasonId
    && a.seasonIndex === b.seasonIndex
    && a.episodeId === b.episodeId
    && a.episodeIndex === b.episodeIndex
}


function applySync(data) {
  if (!playerReady) {
    console.log('[party][viewer] applySync skipped: player not ready', JSON.stringify(data))
    return
  }
  const compensated = (data.time ?? 0) + latency
  const fileObj = normalizeFileData(data)
  const fileEvent = data.event === 'file' || data.event === 'playlist_changed'
  const playlistChanged = data.playlistId != null && data.playlistId !== currentPlaylistId
  const fileChanged = fileObj && !sameFile(fileObj, currentFile)

  console.log('[party][viewer] applySync normalized', JSON.stringify({ event: data.event, playlistId: data.playlistId ?? null, file: data.file ?? null, normalizedFile: fileObj, playlistChanged, fileChanged, currentPlaylistId, currentFile }))

  if (USE_NATIVE_WATCH_PARTY && (fileEvent || playlistChanged || fileChanged)) {
    if (data.playlistId != null) currentPlaylistId = data.playlistId
    if (fileObj) currentFile = fileObj
    return
  }

  if (fileEvent || playlistChanged || fileChanged) {
    if (data.playlistId != null) currentPlaylistId = data.playlistId
    if (fileObj) currentFile = fileObj
    if (pendingRemoteFile?.timer) clearTimeout(pendingRemoteFile.timer)
    pendingRemoteFile = {
      playlistId: fileObj?.playlistId ?? data.playlistId ?? null,
      bufferedPlay: null,
      timer: setTimeout(() => {
        console.log('[party][viewer] pending file timeout', JSON.stringify(pendingRemoteFile))
        const buffered = pendingRemoteFile?.bufferedPlay
        pendingRemoteFile = null
        if (buffered) flushBufferedPlayback(buffered)
      }, 1500)
    }
    sendFileCommand(fileObj || { playlistId: data.playlistId, fileId: null, playlistIndex: null })
    return
  }

  if (pendingRemoteFile && ['play', 'pause', 'seek', 'timeupdate', 'started', 'start'].includes(data.event)) {
    pendingRemoteFile.bufferedPlay = { event: data.event, compensated, rawTime: data.time ?? 0 }
    console.log('[party][viewer] buffering playback until file ack', JSON.stringify(pendingRemoteFile.bufferedPlay))
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
      if (data.audioTrack != null && data.audioTrack !== currentAudioTrack) {
        currentAudioTrack = data.audioTrack
        const idx = Array.isArray(data.audioTracks) ? data.audioTracks.indexOf(data.audioTrack) : -1
        sendPlayerCommand('audiotrack', idx >= 0 ? idx : data.audioTrack)
      }
      break
  }
}

function applyState(data) {
  if (!playerReady) {
    console.log('[party][viewer] applyState skipped: player not ready', JSON.stringify(data))
    return
  }
  const fileObj = normalizeFileData(data)
  const playlistChanged = data.playlistId != null && data.playlistId !== currentPlaylistId
  const fileChanged = fileObj && !sameFile(fileObj, currentFile)

  console.log('[party][viewer] applyState normalized', JSON.stringify({ playlistId: data.playlistId ?? null, file: data.file ?? null, normalizedFile: fileObj, playlistChanged, fileChanged, currentPlaylistId, currentFile }))
  if (USE_NATIVE_WATCH_PARTY && (playlistChanged || fileChanged)) {
    if (data.playlistId != null) currentPlaylistId = data.playlistId
    if (fileObj) currentFile = fileObj
  } else if (playlistChanged || fileChanged) {
    if (data.playlistId != null) currentPlaylistId = data.playlistId
    if (fileObj) currentFile = fileObj
    sendFileCommand(fileObj || { playlistId: data.playlistId, fileId: null, playlistIndex: null })
  } else if (fileObj && !data.playlistId) sendPlayerCommand('file', fileObj)
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
  if (!frame || !frame.contentWindow) {
    console.log('[party] sendPlayerCommand skipped: no frame', command, JSON.stringify(value))
    return
  }
  console.log('[party] sendPlayerCommand', command, JSON.stringify(value))
  frame.contentWindow.postMessage({ type: 'playerCommand', command, value, timestamp: Date.now() }, '*')
}

function sendFileCommand(fileObj) {
  const variants = []
  if (fileObj) variants.push(fileObj)
  if (fileObj?.playlistId) variants.push({ playlistId: fileObj.playlistId })
  if (fileObj?.playlistId) variants.push(fileObj.playlistId)

  variants.forEach((variant, index) => {
    setTimeout(() => {
      console.log('[party][viewer] sendFile variant', index + 1, JSON.stringify(variant))
      sendPlayerCommand('file', variant)
    }, index * 250)
  })
}

function flushBufferedPlayback(buffered) {
  if (!buffered) return
  console.log('[party][viewer] flush buffered playback', JSON.stringify(buffered))
  switch (buffered.event) {
    case 'play':
    case 'started':
    case 'start':
      sendPlayerCommand('play')
      isPlaying = true
      if (Math.abs(currentTime - buffered.compensated) > SYNC_THRESHOLD) sendPlayerCommand('seek', buffered.compensated)
      break
    case 'pause':
      sendPlayerCommand('pause')
      break
    case 'seek':
      sendPlayerCommand('seek', buffered.compensated)
      isPlaying = true
      break
    case 'timeupdate':
      if (isPlaying && Math.abs(currentTime - buffered.compensated) > SYNC_THRESHOLD) sendPlayerCommand('seek', buffered.compensated)
      break
  }
}

// ── Player events ────────────────────────────────────────────

window.addEventListener('message', e => {
  const data = e.data
  if (!data || typeof data !== 'object') return

  const serialized = JSON.stringify(data)
  if (!serialized) return

  const looksRelevant = /file|playlist|episode/i.test(serialized)
  if (!looksRelevant) return

  console.log(isHost ? '[party][host] raw message' : '[party][viewer] raw message', JSON.stringify({ origin: e.origin, data }))
})

window.addEventListener('message', e => {
  const data = e.data
  if (!data || data.type !== 'playerEvent') return

  const ev = data.event
  if (ev === 'file' || ev === 'playlist_changed' || ev === 'ready' || ev === 'sync_ready' || ev === 'start' || ev === 'started') {
    console.log(isHost ? '[party][host] playerEvent' : '[party][viewer] playerEvent', JSON.stringify(data))
  }

  if (ev === 'ready' || ev === 'sync_ready') {
    playerReady = true
    document.getElementById('partyLoading').style.display = 'none'
    return
  }

  if (data.time !== undefined) currentTime = data.time

  if (ev === 'play' || ev === 'started' || ev === 'start') isPlaying = true
  if (ev === 'pause' || ev === 'end') isPlaying = false

  if (!isHost && pendingRemoteFile && (ev === 'file' || ev === 'playlist_changed')) {
    const ackPlaylistId = data.file?.playlistId ?? data.playlistId ?? null
    if (!pendingRemoteFile.playlistId || ackPlaylistId === pendingRemoteFile.playlistId) {
      console.log('[party][viewer] file ack', JSON.stringify({ ackPlaylistId, pendingRemoteFile }))
      const buffered = pendingRemoteFile.bufferedPlay
      clearTimeout(pendingRemoteFile.timer)
      pendingRemoteFile = null
      flushBufferedPlayback(buffered)
    }
  }

  if (!isHost) return

  const syncEvents = USE_NATIVE_WATCH_PARTY
    ? ['play', 'pause', 'seek', 'timeupdate', 'started', 'start', 'audiotrack_changed']
    : ['play', 'pause', 'seek', 'timeupdate', 'started', 'start', 'file', 'playlist_changed', 'audiotrack_changed']
  if (!syncEvents.includes(ev)) return

  if (ev === 'seek' || ev === 'play' || ev === 'started') lastTimeupdateSent = 0

  if (ev === 'timeupdate') {
    const now = Date.now()
    if (now - lastTimeupdateSent < TIMEUPDATE_INTERVAL) return
    lastTimeupdateSent = now
  }

  const fileObj = normalizeFileData(data)
  if (ev === 'file' || ev === 'playlist_changed') {
    if (data.playlistId != null) currentPlaylistId = data.playlistId
    if (fileObj) currentFile = fileObj
    console.log('[party] file event', JSON.stringify({ event: ev, playlistId: data.playlistId ?? null, file: data.file ?? null, fileId: data.fileId ?? null, playlistIndex: data.playlistIndex ?? null, normalizedFile: fileObj }))
  }
  if (ev === 'audiotrack_changed' && data.audioTrack != null) {
    currentAudioTrack = data.audioTrack
  }

  wsSend({ type: 'sync', event: ev, time: data.time, playlistId: data.playlistId ?? null, file: fileObj ?? null, audioTrack: data.audioTrack ?? null, audioTracks: data.audioTracks ?? null })
})

// ── Vibix player ─────────────────────────────────────────────

async function init() {
  let vibixId = movieId

  try {
    const r = await fetch(`${API_BASE}/api/movie/${movieId}`)
    if (r.ok) {
      const movie = await r.json()
      const title = movie.nameRu || movie.nameEn || 'Untitled'
      document.title = title + ' - Watch Party'
      document.getElementById('partyTitle').textContent = title

      const vibix = (movie.players || []).find(p => p.name === 'Vibix')
      if (vibix?.url) vibixId = vibix.url
    }
  } catch {}

  startVibix(vibixId)
  connect()

  document.getElementById('partyJoinBtn').addEventListener('click', () => {
    document.getElementById('partyJoinOverlay').classList.remove('active')
    wsSend({ type: 'request_sync' })
  })
}

function startVibix(vibixId) {
  const slot = document.getElementById('vibix-slot')
  slot.innerHTML = `<ins
    data-publisher-id="677393820"
    data-type="kp"
    data-id="${vibixId}"
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
  initNativeWatchParty()
}

function patchWatchPartyPrototype() {
  if (!USE_NATIVE_WATCH_PARTY || watchPartyPrototypePatched || typeof WatchParty !== 'function') return

  const proto = WatchParty.prototype
  if (typeof proto.handlePlayerEvent === 'function') {
    const originalHandlePlayerEvent = proto.handlePlayerEvent
    proto.handlePlayerEvent = function(eventData) {
      const eventName = eventData?.event || null
      if (eventName && !NATIVE_ONLY_EVENTS.has(eventName)) return
      return originalHandlePlayerEvent.call(this, eventData)
    }
  }

  watchPartyPrototypePatched = true
}

function hideNativeWatchPartyUi() {
  const root = document.querySelector('.party-page')
  const hideNode = node => {
    if (!(node instanceof HTMLElement)) return
    if (root && root.contains(node)) return

    const style = window.getComputedStyle(node)
    const zIndex = Number.parseInt(style.zIndex || '0', 10)
    const rect = node.getBoundingClientRect()
    const looksLikeFloatingWidget = style.position === 'fixed'
      && zIndex >= 100
      && rect.width > 120
      && rect.width < 420
      && rect.height > 40

    if (looksLikeFloatingWidget) node.style.display = 'none'
  }

  document.querySelectorAll('body *').forEach(hideNode)
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) mutation.addedNodes.forEach(hideNode)
  })
  observer.observe(document.body, { childList: true, subtree: true })
}

function initNativeWatchParty() {
  if (!USE_NATIVE_WATCH_PARTY || nativeParty || typeof WatchParty !== 'function') return
  patchWatchPartyPrototype()
  const iframe = document.getElementById('vibix-frame')
  if (!iframe) return

  nativeParty = new WatchParty({
    iframe: '#vibix-frame',
    roomId,
    username,
    debug: true,
  })
  hideNativeWatchPartyUi()
  console.log('[party] native WatchParty initialized', JSON.stringify({ roomId, username }))
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
