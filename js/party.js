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
let vibixBaseUrl = null  // iframe URL without season/episode/nc — used for episode switching
let currentTime = 0
let isPlaying = false
let hostPlaying = false  // last known host playing state — applied immediately after episode reload
let reconnectTimer = null
let pingTimer = null
let latency = 0           // половина RTT в секундах
let lastTimeupdateSent = 0
let lastSyncAt = 0        // время последнего принудительного seek
let currentPlaylistId = null
let currentFile = null
let currentAudioTrack = null
let currentPlaylistSnapshot = null
let currentEpisodeState = null
let pendingInitialState = null
let pendingInitialSyncEvents = []
let pendingInitialPlaybackSync = null
let pendingInitialAudioSync = null
let pendingInitialEpisodeSync = null
let pendingRequestSyncTimer = null
const SYNC_THRESHOLD = 1  // секунды
const SYNC_COOLDOWN = 3000  // мс между принудительными seek
const TIMEUPDATE_INTERVAL = 2500  // ms between timeupdate sends

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

function scheduleRequestSync(delay = 0, reason = '') {
  if (isHost) return
  clearTimeout(pendingRequestSyncTimer)
  pendingRequestSyncTimer = setTimeout(() => {
    pendingRequestSyncTimer = null
    console.log('[party][viewer] request_sync', JSON.stringify({ reason }))
    wsSend({ type: 'request_sync' })
  }, delay)
}

function sendEpisodeSync(seed) {
  if (!seed || !isHost) return
  wsSend({
    type: 'episode_sync',
    seasonIndex: seed.seasonIndex,
    episodeIndex: seed.episodeIndex,
    playlistId: seed.playlistId,
    voice: seed.voice ?? null,
  })
  console.log('[party][host] episode_sync sent', JSON.stringify({
    seasonIndex: seed.seasonIndex,
    episodeIndex: seed.episodeIndex,
    playlistId: seed.playlistId,
    voice: seed.voice ?? null,
  }))
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
        if (['play', 'started', 'start'].includes(data.event)) hostPlaying = true
        else if (data.event === 'pause') hostPlaying = false
        console.log('[party][viewer] ws sync', JSON.stringify(data))
        if (!playerReady) {
          if (data.event === 'audiotrack_changed') {
            pendingInitialAudioSync = data
          } else if (['play', 'pause', 'seek', 'timeupdate', 'started', 'start'].includes(data.event)) {
            pendingInitialPlaybackSync = data
          } else {
            pendingInitialSyncEvents.push(data)
          }
          console.log('[party][viewer] buffered ws sync until player ready', JSON.stringify({ event: data.event, fileEvents: pendingInitialSyncEvents.length, hasPlayback: !!pendingInitialPlaybackSync, hasAudio: !!pendingInitialAudioSync }))
        } else {
          applySync(data)
        }
      }
      break

    case 'state':
      if (!isHost) {
        if (data.playing !== undefined) hostPlaying = data.playing
        console.log('[party][viewer] ws state', JSON.stringify(data))
        if (!playerReady) {
          pendingInitialState = data
          console.log('[party][viewer] buffered ws state until player ready', JSON.stringify(data))
        } else {
          applyState(data)
        }
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

    case 'episode_sync':
      if (!isHost) {
        console.log('[party][viewer] episode_sync received', JSON.stringify({
          seasonIndex: data.seasonIndex ?? null,
          episodeIndex: data.episodeIndex ?? null,
          playlistId: data.playlistId ?? null,
          voice: data.voice ?? null,
        }))
        if (!playerReady) {
          pendingInitialEpisodeSync = data
        } else {
          applyEpisodeSync(data)
        }
      }
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

function parsePlaylistTree(rawData) {
  if (typeof rawData !== 'string' || !rawData.trim()) return null

  let parsed
  try {
    parsed = JSON.parse(rawData)
  } catch (error) {
    console.log('[party] playlist snapshot parse error', JSON.stringify({ message: error?.message || String(error) }))
    return null
  }

  if (!Array.isArray(parsed)) return null

  const seasons = parsed.map((season, seasonIndex) => {
    const episodes = Array.isArray(season?.folder) ? season.folder.map((episode, episodeIndex) => ({
      seasonIndex,
      episodeIndex,
      seasonTitle: season?.title ?? null,
      episodeTitle: episode?.title ?? null,
      playlistId: episode?.id ?? null,
      file: episode?.file ?? null,
      voices: episode?.voices && typeof episode.voices === 'object' ? { ...episode.voices } : null,
    })) : []

    return {
      seasonIndex,
      title: season?.title ?? null,
      episodes,
    }
  })

  return {
    seasons,
    byPlaylistId: Object.fromEntries(seasons.flatMap(season => season.episodes).filter(episode => episode.playlistId).map(episode => [episode.playlistId, episode])),
  }
}

function inferVoiceForPlaylist(snapshot, playlistId, audioTrack) {
  if (!snapshot?.byPlaylistId || !playlistId || audioTrack == null) return null
  const episode = snapshot.byPlaylistId[playlistId]
  if (!episode?.voices) return null

  for (const [voiceName, voicePlaylistId] of Object.entries(episode.voices)) {
    if (voicePlaylistId === audioTrack) return voiceName
  }
  return null
}

function updateEpisodeState(reason, playlistId = currentPlaylistId, audioTrack = currentAudioTrack) {
  if (!currentPlaylistSnapshot?.byPlaylistId || !playlistId) {
    console.log('[party] episode state skipped', JSON.stringify({ reason, playlistId: playlistId ?? null, hasSnapshot: !!currentPlaylistSnapshot?.byPlaylistId }))
    return null
  }
  const episode = currentPlaylistSnapshot.byPlaylistId[playlistId]
  if (!episode) {
    console.log('[party] episode lookup miss', JSON.stringify({ reason, playlistId, knownIds: Object.keys(currentPlaylistSnapshot.byPlaylistId).slice(0, 5), totalIds: Object.keys(currentPlaylistSnapshot.byPlaylistId).length }))
    return null
  }

  const voice = inferVoiceForPlaylist(currentPlaylistSnapshot, playlistId, audioTrack)
  currentEpisodeState = {
    seasonIndex: episode.seasonIndex,
    episodeIndex: episode.episodeIndex,
    seasonTitle: episode.seasonTitle,
    episodeTitle: episode.episodeTitle,
    playlistId,
    audioTrack: audioTrack ?? null,
    voice,
  }
  console.log('[party] episode state', JSON.stringify({ reason, ...currentEpisodeState }))
  const syncSeed = { seasonIndex: episode.seasonIndex, episodeIndex: episode.episodeIndex, playlistId, voice, reason }
  console.log('[party] episode sync seed', JSON.stringify(syncSeed))
  if (isHost && ['player_event_file', 'player_event_playlist_changed'].includes(reason)) sendEpisodeSync(syncSeed)
  return currentEpisodeState
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

  if (fileEvent || playlistChanged || fileChanged) {
    // Episode switch is handled by episode_sync → applyEpisodeSync (iframe reload).
    // Just update local state here; do not attempt sendFileCommand.
    if (data.playlistId != null) currentPlaylistId = data.playlistId
    if (fileObj) currentFile = fileObj
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
  if (fileObj) currentFile = fileObj
  if (playlistChanged) {
    // Switch to new episode; iframe will reload and re-sync via ready handler
    applyEpisodeSync({
      playlistId: data.playlistId,
      seasonIndex: data.seasonIndex ?? null,
      episodeIndex: data.episodeIndex ?? null,
    })
    return
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

function applyEpisodeSync(data) {
  if (!data || !data.playlistId) return
  if (data.playlistId === currentPlaylistId) return

  console.log('[party][viewer] applyEpisodeSync', JSON.stringify({
    seasonIndex: data.seasonIndex ?? null,
    episodeIndex: data.episodeIndex ?? null,
    playlistId: data.playlistId,
    voice: data.voice ?? null,
  }))

  const iframe = document.getElementById('vibix-frame')
  if (!iframe || !iframe.src) return

  currentPlaylistId = data.playlistId
  playerReady = false
  isPlaying = false  // player starts fresh after reload
  currentTime = 0

  try {
    // Use stored base URL (original kinopoisk ID, no season/episode/nc params)
    const base = vibixBaseUrl || iframe.src.split('?')[0]
    const sep = base.includes('?') ? '&' : '?'

    // Build URL manually — episode[] brackets must NOT be percent-encoded
    let newSrc = base
    if (data.seasonIndex != null) newSrc += sep + 'season=' + (data.seasonIndex + 1)
    const epSep = newSrc.includes('?') ? '&' : '?'
    if (data.episodeIndex != null) newSrc += epSep + 'episode[]=' + (data.episodeIndex + 1)
    // autoplay=true tells the player to start playing natively — works around browser autoplay policy
    if (hostPlaying) newSrc += '&autoplay=true'
    newSrc += '&nc=' + Date.now()

    console.log('[party][viewer] reloading iframe for episode', newSrc)
    iframe.src = newSrc
  } catch (err) {
    console.log('[party][viewer] applyEpisodeSync iframe reload failed', String(err))
    playerReady = true  // restore so viewers can still interact
  }

  // After player reloads it will emit ready → scheduleRequestSync runs in the ready handler
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


// ── Player events ────────────────────────────────────────────

window.addEventListener('message', e => {
  const data = e.data
  if (!data || typeof data !== 'object') return

  const serialized = JSON.stringify(data)
  if (!serialized) return

  const looksRelevant = /file|playlist|episode/i.test(serialized)
  if (!looksRelevant) return

  if (data.event === 'file' && typeof data.data === 'string') {
    const snapshot = parsePlaylistTree(data.data)
    if (snapshot) {
      currentPlaylistSnapshot = snapshot
      const seasonsCount = snapshot.seasons.length
      const episodesCount = snapshot.seasons.reduce((sum, season) => sum + season.episodes.length, 0)
      console.log('[party] playlist snapshot', JSON.stringify({ seasonsCount, episodesCount }))
      updateEpisodeState('raw_playlist_tree')
    }
  }

  console.log(isHost ? '[party][host] raw message' : '[party][viewer] raw message', JSON.stringify({ origin: e.origin, data }))
})

window.addEventListener('message', e => {
  const data = e.data
  if (!data || data.type !== 'playerEvent') return

  const ev = data.event
  const resolvedPlayerPlaylistId = data.playlistId ?? data.file?.playlistId ?? data.playlistInfo?.currentId ?? null
  if (resolvedPlayerPlaylistId) currentPlaylistId = resolvedPlayerPlaylistId
  if (data.file && typeof data.file === 'object') currentFile = { ...data.file }

  if (ev === 'file' || ev === 'playlist_changed' || ev === 'ready' || ev === 'sync_ready' || ev === 'start' || ev === 'started') {
    console.log(isHost ? '[party][host] playerEvent' : '[party][viewer] playerEvent', JSON.stringify(data))
  }

  if ((ev === 'file' || ev === 'playlist_changed' || ev === 'start' || ev === 'started') && resolvedPlayerPlaylistId) {
    updateEpisodeState('player_event_' + ev, resolvedPlayerPlaylistId, currentAudioTrack)
  }

  if (ev === 'ready' || ev === 'sync_ready') {
    playerReady = true
    document.getElementById('partyLoading').style.display = 'none'

    if (!isHost) {
      if (pendingInitialState) {
        const state = pendingInitialState
        pendingInitialState = null
        console.log('[party][viewer] replay buffered state after ready', JSON.stringify(state))
        applyState(state)
      }
      if (pendingInitialSyncEvents.length) {
        const events = pendingInitialSyncEvents.slice()
        pendingInitialSyncEvents = []
        console.log('[party][viewer] replay buffered sync events after ready', JSON.stringify({ count: events.length }))
        events.forEach(applySync)
      }
      if (pendingInitialAudioSync) {
        const audioSync = pendingInitialAudioSync
        pendingInitialAudioSync = null
        console.log('[party][viewer] replay buffered audio sync after ready', JSON.stringify(audioSync))
        applySync(audioSync)
      }
      if (pendingInitialEpisodeSync) {
        const episodeSync = pendingInitialEpisodeSync
        pendingInitialEpisodeSync = null
        console.log('[party][viewer] replay buffered episode sync after ready', JSON.stringify(episodeSync))
        applyEpisodeSync(episodeSync)
      }
      if (pendingInitialPlaybackSync) {
        const playbackSync = pendingInitialPlaybackSync
        pendingInitialPlaybackSync = null
        console.log('[party][viewer] replay buffered playback sync after ready', JSON.stringify(playbackSync))
        applySync(playbackSync)
      }
      scheduleRequestSync(300, 'after_ready')
    }
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

  const fileObj = normalizeFileData(data)
  if (ev === 'file' || ev === 'playlist_changed') {
    if (data.playlistId != null) currentPlaylistId = data.playlistId
    if (fileObj) currentFile = fileObj
    const resolvedPlaylistId = data.playlistId ?? fileObj?.playlistId ?? data.playlistInfo?.currentId ?? currentPlaylistId
    console.log('[party] file event', JSON.stringify({ event: ev, playlistId: data.playlistId ?? null, playlistInfoCurrentId: data.playlistInfo?.currentId ?? null, file: data.file ?? null, fileId: data.fileId ?? null, playlistIndex: data.playlistIndex ?? null, normalizedFile: fileObj, resolvedPlaylistId }))
    updateEpisodeState(ev, resolvedPlaylistId, currentAudioTrack)
  }
  if (ev === 'audiotrack_changed' && data.audioTrack != null) {
    currentAudioTrack = data.audioTrack
    updateEpisodeState(ev, currentPlaylistId, currentAudioTrack)
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
  console.log('[party] iframe src', iframe.src)
  // Store base URL for episode switching: strip season/episode[]/nc so we can rebuild cleanly
  try {
    const url = new URL(iframe.src)
    url.searchParams.delete('season')
    url.searchParams.delete('nc')
    // Remove episode[] (URLSearchParams encodes [] as %5B%5D)
    const cleaned = url.toString()
      .replace(/[&?]episode%5B%5D=[^&]*/g, '')
      .replace(/[&?]episode\[\]=[^&]*/g, '')
      .replace(/\?&/, '?')
    vibixBaseUrl = cleaned
    console.log('[party] vibix base url', vibixBaseUrl)
  } catch {}
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
