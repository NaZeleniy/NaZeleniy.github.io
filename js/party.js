const params  = new URLSearchParams(window.location.search)
const movieId = params.get('id')
let   roomId  = params.get('room')

if (!roomId) {
  roomId = 'room-' + Math.random().toString(36).slice(2, 12)
  params.set('room', roomId)
  history.replaceState(null, '', '?' + params.toString())
  // sessionStorage is per-tab — prevents other tabs in the same browser from
  // claiming the creator role when testing or when the creator opens their own link
  sessionStorage.setItem('nz_host_room_' + roomId, '1')
}

const isCreator = sessionStorage.getItem('nz_host_room_' + roomId) === '1'

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

// ── Player adapters ──────────────────────────────────────────
//
// Each adapter exposes:
//   send(command, value)  — translate internal command → player-specific postMessage
//   parse(data)           — translate player-specific postMessage → internal event
//
// Internal event shape:
//   { event, time, playlistId?, file?, audioTrack?, audioTracks? }
//
// Internal commands: 'play', 'pause', 'seek' (value=seconds),
//                    'audiotrack' (value=index), 'file' (value=fileObj)

let playerType = null  // 'vibix' | 'turbo'
let adapter    = null

// Vibix — graphicslab SDK postMessage protocol
function vibixAdapter(frame) {
  return {
    send(command, value) {
      frame.contentWindow.postMessage(
        { type: 'playerCommand', command, value, timestamp: Date.now() }, '*'
      )
    },
    parse(data) {
      if (!data || data.type !== 'playerEvent') return null
      return {
        event:       data.event,
        time:        data.time        ?? null,
        playlistId:  data.playlistId  ?? data.file?.playlistId ?? data.playlistInfo?.currentId ?? null,
        file:        data.file        ?? null,
        audioTrack:  data.audioTrack  ?? null,
        audioTracks: data.audioTracks ?? null,
      }
    },
  }
}

// Turbo — actual postMessage format (discovered from runtime logs):
//   Events: {event:'play'|'pause'|'time'|'seek'|..., time:seconds, data:..., duration:...}
//           {event:'new', id:'contentId-seasonIdx-episodeIdx-voiceIdx'} — episode change
//   Commands: {api:'play'}, {api:'pause'}, {api:'seek', set:seconds}
const TURBO_EV_MAP = {
  inited:  'ready',    // player initialised → treat as ready
  play:    'play',
  pause:   'pause',
  time:    'timeupdate',
  seek:    'seek',
  start:   'started',
  started: 'started',
  stop:    'end',
}

// Parse Turbo episode id: 'contentId-seasonIdx-episodeIdx-voiceIdx'
// Trailing 3 numeric segments are indices (0-based); content id may contain dashes.
function parseTurboEpisodeId(id) {
  if (!id || typeof id !== 'string') return null
  const parts = id.split('-')
  // Walk from the end collecting numeric segments
  const nums = []
  for (let i = parts.length - 1; i >= 0 && nums.length < 3; i--) {
    const n = parseInt(parts[i], 10)
    if (!isNaN(n) && String(n) === parts[i]) nums.unshift(n)
    else break
  }
  if (nums.length < 2) return null
  return { seasonIndex: nums[0], episodeIndex: nums[1], voiceIndex: nums[2] ?? 0 }
}

function turboAdapter(frame) {
  return {
    send(command, value) {
      let msg = null
      if (command === 'play')  msg = { api: 'play' }
      if (command === 'pause') msg = { api: 'pause' }
      if (command === 'seek')       msg = { api: 'seek', set: value }
      if (!msg) { console.log('[party] turbo: unsupported command', command); return }
      frame.contentWindow.postMessage(msg, '*')
    },
    parse(data) {
      if (!data || typeof data.event !== 'string') return null
      // Episode change event
      if (data.event === 'new') {
        const ep = parseTurboEpisodeId(data.id)
        if (!ep) return null
        return {
          event: 'turbo_episode',
          time: 0,
          seasonIndex: ep.seasonIndex,
          episodeIndex: ep.episodeIndex,
          voiceIndex: ep.voiceIndex,
          playlistId: data.id,  // raw id — used for dedup on viewers
        }
      }
      const event = TURBO_EV_MAP[data.event]
      if (!event) return null
      return { event, time: data.time ?? 0 }
    },
  }
}

function getPlayerFrame() {
  return document.getElementById('party-frame')
}

// ── WebSocket sync ───────────────────────────────────────────

let ws = null
let isHost = false
let playerReady = false
let playerBaseUrl = null  // base URL without season/episode/nc — for episode switching
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
// Turbo episode tracking — season/episode/voice indices from 'new' events
let currentTurboSeasonIndex = null
let currentTurboEpisodeIndex = null
let currentTurboVoiceIndex = null
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

    // Turbo race: player may fire 'inited' before WS opens, so scheduleRequestSync
    // was called against a closed socket. Re-schedule now that we're connected.
    // The re-check inside scheduleRequestSync's callback handles the case where
    // role_assigned arrives (isHost=true) within the delay window.
    if (playerReady) scheduleRequestSync(600, 'ws_open_player_already_ready')
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
    if (isHost) return  // role may have been assigned (via role_assigned) since we scheduled
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
        // If host is using a different player, switch before applying state
        if (data.playerName && data.playerName !== activePlayerName) {
          const target = partyPlayers.find(p => p.name === data.playerName)
          if (target) {
            console.log('[party][viewer] state: switching player to', data.playerName)
            pendingInitialState = data  // buffer — applied after new player fires ready
            switchPlayer(target)
            break
          }
        }
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

    case 'player_switch':
      if (!isHost && data.playerName) {
        const target = partyPlayers.find(p => p.name === data.playerName)
        if (target && target.name !== activePlayerName) {
          console.log('[party][viewer] player_switch received', data.playerName)
          switchPlayer(target)
          // player will request sync after it becomes ready via onPlayerReady → scheduleRequestSync
        }
      }
      break

    case 'request_sync':
      if (isHost) wsSend({ type: 'state', time: currentTime, playing: isPlaying, playlistId: currentPlaylistId, file: currentFile, audioTrack: currentAudioTrack, playerName: activePlayerName })
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
  if (!data) return

  // ── Turbo ──────────────────────────────────────────────────────
  if (playerType === 'turbo') {
    if (data.seasonIndex == null || data.episodeIndex == null) return

    const voiceIndex = data.voice != null ? parseInt(data.voice, 10) : null

    // Skip if nothing changed
    if (
      data.seasonIndex === currentTurboSeasonIndex &&
      data.episodeIndex === currentTurboEpisodeIndex &&
      (voiceIndex == null || isNaN(voiceIndex) || voiceIndex === currentTurboVoiceIndex)
    ) return

    const iframe = getPlayerFrame()
    if (!iframe) return

    // Update state before reload
    currentTurboSeasonIndex = data.seasonIndex
    currentTurboEpisodeIndex = data.episodeIndex
    if (voiceIndex != null && !isNaN(voiceIndex)) currentTurboVoiceIndex = voiceIndex
    if (data.playlistId != null) currentPlaylistId = data.playlistId

    playerReady = false
    isPlaying = false
    currentTime = 0

    const url = new URL(playerBaseUrl || iframe.src.split('?')[0])
    url.searchParams.delete('season')
    url.searchParams.delete('episode')
    url.searchParams.delete('translation')
    url.searchParams.delete('autoplay')
    url.searchParams.delete('nc')
    url.searchParams.set('season', data.seasonIndex + 1)
    url.searchParams.set('episode', data.episodeIndex + 1)
    if (voiceIndex != null && !isNaN(voiceIndex)) url.searchParams.set('translation', voiceIndex)
    if (hostPlaying) url.searchParams.set('autoplay', 'true')
    url.searchParams.set('nc', Date.now())

    const newSrc = url.toString()
    console.log('[turbo] reload', { seasonIndex: data.seasonIndex, episodeIndex: data.episodeIndex, voiceIndex, url: newSrc })
    iframe.src = newSrc
    // onPlayerReady() will apply buffered sync after the iframe fires its ready event
    return
  }

  // ── Vibix ──────────────────────────────────────────────────────
  if (!data.playlistId) return
  if (data.playlistId === currentPlaylistId) return

  const iframe = getPlayerFrame()
  if (!iframe || !iframe.src) return

  currentPlaylistId = data.playlistId
  playerReady = false
  isPlaying = false
  currentTime = 0

  // episode[] brackets must NOT be percent-encoded — build URL manually
  const base = playerBaseUrl || iframe.src.split('?')[0]
  const sep = base.includes('?') ? '&' : '?'
  let newSrc = base
  if (data.seasonIndex != null) newSrc += sep + 'season=' + (data.seasonIndex + 1)
  if (data.episodeIndex != null) newSrc += (newSrc.includes('?') ? '&' : '?') + 'episode[]=' + (data.episodeIndex + 1)
  if (hostPlaying) newSrc += '&autoplay=true'
  newSrc += '&nc=' + Date.now()

  console.log('[vibix] reload', { seasonIndex: data.seasonIndex, episodeIndex: data.episodeIndex, playlistId: data.playlistId, url: newSrc })
  iframe.src = newSrc
  // onPlayerReady() will apply buffered sync after the iframe fires its ready event
}

// ── Player commands ──────────────────────────────────────────

function sendPlayerCommand(command, value) {
  const frame = getPlayerFrame()
  if (!frame?.contentWindow || !adapter) {
    console.log('[party] sendPlayerCommand skipped: no frame or adapter', command, JSON.stringify(value))
    return
  }
  console.log('[party] sendPlayerCommand', command, JSON.stringify(value))
  adapter.send(command, value)
}


// ── Player events ─────────────────────────────────────────────
//
// Vibix-only: raw playlist tree snapshot sent as {event:'file', data: jsonString}
// This is Vibix SDK-specific and not part of the Playerjs protocol.

window.addEventListener('message', e => {
  if (playerType !== 'vibix') return
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

// Unified event handler — normalizes via active adapter
window.addEventListener('message', e => {
  if (!adapter) return
  const raw = e.data
  if (raw == null) return

  // Some Playerjs builds serialize events as a JSON string — parse them
  let data = raw
  if (typeof data === 'string') {
    try { data = JSON.parse(data) } catch { return }
  }
  if (!data || typeof data !== 'object') return

  const ev = adapter.parse(data)
  if (!ev) return

  handlePlayerEvent(ev)
})

function onPlayerReady() {
  if (playerReady) return  // idempotent
  playerReady = true
  document.getElementById('partyLoading').style.display = 'none'
  console.log('[party] player ready', JSON.stringify({ isHost, playerType }))

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
}

function handlePlayerEvent(ev) {
  const resolvedPlayerPlaylistId = ev.playlistId ?? null
  if (resolvedPlayerPlaylistId) currentPlaylistId = resolvedPlayerPlaylistId
  if (ev.file && typeof ev.file === 'object') currentFile = { ...ev.file }

  if (ev.event === 'file' || ev.event === 'playlist_changed' || ev.event === 'ready' || ev.event === 'sync_ready' || ev.event === 'start' || ev.event === 'started') {
    console.log(isHost ? '[party][host] playerEvent' : '[party][viewer] playerEvent', JSON.stringify(ev))
  }

  if ((ev.event === 'file' || ev.event === 'playlist_changed' || ev.event === 'start' || ev.event === 'started') && resolvedPlayerPlaylistId) {
    updateEpisodeState('player_event_' + ev.event, resolvedPlayerPlaylistId, currentAudioTrack)
  }

  if (ev.event === 'ready' || ev.event === 'sync_ready') {
    onPlayerReady()
    return
  }

  // Turbo (Playerjs) may not send a 'ready' event — treat first 'time' tick as implicit ready
  if (!playerReady && ev.event === 'timeupdate') {
    console.log('[party] implicit ready via first timeupdate')
    onPlayerReady()
  }

  if (ev.time != null) currentTime = ev.time

  if (ev.event === 'play' || ev.event === 'started' || ev.event === 'start') isPlaying = true
  if (ev.event === 'pause' || ev.event === 'end') isPlaying = false

  // Turbo episode/voice change — sync to viewers and return (not a standard sync event)
  if (ev.event === 'turbo_episode') {
    currentTurboSeasonIndex = ev.seasonIndex
    currentTurboEpisodeIndex = ev.episodeIndex
    currentTurboVoiceIndex = ev.voiceIndex
    console.log('[party] turbo_episode', JSON.stringify({ seasonIndex: ev.seasonIndex, episodeIndex: ev.episodeIndex, voiceIndex: ev.voiceIndex, playlistId: ev.playlistId }))
    if (isHost) {
      sendEpisodeSync({
        seasonIndex: ev.seasonIndex,
        episodeIndex: ev.episodeIndex,
        playlistId: ev.playlistId,
        voice: String(ev.voiceIndex),  // string — matches backend inMsg.Voice *string
      })
    }
    return
  }

  if (!isHost) return

  const syncEvents = ['play', 'pause', 'seek', 'timeupdate', 'started', 'start', 'file', 'playlist_changed', 'audiotrack_changed']
  if (!syncEvents.includes(ev.event)) return

  if (ev.event === 'seek' || ev.event === 'play' || ev.event === 'started') lastTimeupdateSent = 0

  if (ev.event === 'timeupdate') {
    const now = Date.now()
    if (now - lastTimeupdateSent < TIMEUPDATE_INTERVAL) return
    lastTimeupdateSent = now
  }

  const fileObj = ev.file ? normalizeFileData({ file: ev.file }) : null
  if (ev.event === 'file' || ev.event === 'playlist_changed') {
    if (ev.playlistId != null) currentPlaylistId = ev.playlistId
    if (fileObj) currentFile = fileObj
    updateEpisodeState(ev.event, ev.playlistId ?? currentPlaylistId, currentAudioTrack)
  }
  if (ev.event === 'audiotrack_changed' && ev.audioTrack != null) {
    currentAudioTrack = ev.audioTrack
    updateEpisodeState(ev.event, currentPlaylistId, currentAudioTrack)
  }

  wsSend({ type: 'sync', event: ev.event, time: ev.time, playlistId: ev.playlistId ?? null, file: fileObj ?? null, audioTrack: ev.audioTrack ?? null, audioTracks: ev.audioTracks ?? null })
}

// ── Player startup ────────────────────────────────────────────

let partyPlayers = []   // available party-capable players from API
let activePlayerName = null

async function init() {
  let players = []

  try {
    const r = await fetch(`${API_BASE}/api/movie/${movieId}`)
    if (r.ok) {
      const movie = await r.json()
      const title = movie.nameRu || movie.nameEn || 'Untitled'
      document.title = title + ' - Watch Party'
      document.getElementById('partyTitle').textContent = title

      players = (movie.players || []).filter(p => p.type === 'vibix' || p.type === 'turbo')
    }
  } catch {}

  if (!players.length) {
    // Fallback: treat movieId as a Vibix KP ID
    players = [{ name: 'Vibix', url: movieId, type: 'vibix' }]
  }

  partyPlayers = players
  buildPlayerSelector(players)

  // Prefer Vibix (full episode/audio sync), fall back to first available
  const preferred = players.find(p => p.type === 'vibix') || players[0]
  switchPlayer(preferred)

  connect()

  document.getElementById('partyJoinBtn').addEventListener('click', () => {
    document.getElementById('partyJoinOverlay').classList.remove('active')
    wsSend({ type: 'request_sync' })
  })
}

function buildPlayerSelector(players) {
  if (players.length < 2) return
  const wrap = document.getElementById('partyPlayerSelect')
  const btns = document.getElementById('partyPlayerBtns')
  if (!wrap || !btns) return
  btns.innerHTML = players.map(p =>
    `<button class="party-player-btn" data-name="${p.name}" onclick="switchPlayer(partyPlayers.find(x=>x.name==='${p.name}'))">${p.name}</button>`
  ).join('')
  wrap.style.display = 'flex'
}

function setActiveSelectorBtn(name) {
  document.querySelectorAll('.party-player-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.name === name)
  })
}

function switchPlayer(player) {
  if (!player) return
  if (activePlayerName === player.name) return

  activePlayerName = player.name
  setActiveSelectorBtn(player.name)

  // Reset state for new player
  playerReady = false
  isPlaying = false
  currentTime = 0
  playerBaseUrl = null
  adapter = null
  currentTurboSeasonIndex = null
  currentTurboEpisodeIndex = null
  currentTurboVoiceIndex = null

  // Clear previous player DOM
  const slot = document.getElementById('party-player-slot')
  slot.innerHTML = ''

  if (player.type === 'turbo') {
    playerType = 'turbo'
    startTurbo(player.url)
  } else {
    playerType = 'vibix'
    startVibix(player.url)
  }

  // Notify viewers about player switch (only if connected and is host)
  if (isHost) wsSend({ type: 'player_switch', playerName: player.name })

  console.log('[party] switched to player', player.name)
}

// ── Vibix player ──────────────────────────────────────────────

function startVibix(vibixId) {
  const slot = document.getElementById('party-player-slot')
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
  iframe.id = 'party-frame'
  adapter = vibixAdapter(iframe)
  console.log('[party] vibix iframe src', iframe.src)
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
    playerBaseUrl = cleaned
    console.log('[party] player base url', playerBaseUrl)
  } catch {}
}

// ── Turbo player (Playerjs / ?api=1) ─────────────────────────

function startTurbo(embedUrl) {
  const slot = document.getElementById('party-player-slot')
  const iframe = document.createElement('iframe')
  iframe.id = 'party-frame'
  iframe.src = embedUrl
  iframe.frameBorder = '0'
  iframe.allowFullscreen = true
  iframe.allow = 'autoplay; fullscreen'
  iframe.style.cssText = 'width:100%;height:100%;position:absolute;top:0;left:0;'
  slot.appendChild(iframe)

  adapter = turboAdapter(iframe)

  // Store base URL for episode switching (strip dynamic/episode params so applyEpisodeSync can rebuild cleanly)
  try {
    const url = new URL(embedUrl)
    url.searchParams.delete('nc')
    url.searchParams.delete('autoplay')
    url.searchParams.delete('season')
    url.searchParams.delete('episode')
    playerBaseUrl = url.toString()
    console.log('[party] turbo base url', playerBaseUrl)
  } catch {
    playerBaseUrl = embedUrl
  }

  iframe.addEventListener('load', () => {
    console.log('[party] turbo iframe loaded')

    // Playerjs handshake: some builds require the parent to send {api:'ready'} and
    // explicit addEventListener calls before they start emitting events.
    setTimeout(() => {
      if (!iframe.contentWindow) return
      iframe.contentWindow.postMessage({ api: 'ready' }, '*')
      for (const ev of ['play', 'pause', 'time', 'end', 'ready']) {
        iframe.contentWindow.postMessage({ api: 'addEventListener', value: ev }, '*')
      }
      console.log('[party] turbo handshake sent')
    }, 300)

    // Fallback: if still not ready 1s after load, unblock buffered sync
    setTimeout(() => {
      if (!playerReady) {
        console.log('[party] turbo ready fallback (no events received)')
        onPlayerReady()
      }
    }, 1000)
  })

  console.log('[party] turbo iframe created', embedUrl)
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
