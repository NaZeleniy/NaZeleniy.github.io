// Поддержка обоих форматов: /movie/123 (чистый URL) и ?id=123 (обратная совместимость)
const movieId = (() => {
  const fromPath = location.pathname.match(/\/movie\/(\d+)/)
  return fromPath ? fromPath[1] : new URLSearchParams(location.search).get('id')
})()

async function fetchWithRetry(url, opts, retries = 2, delay = 1200) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fetch(url, opts)
    } catch (e) {
      if (i === retries) throw e
      await new Promise(r => setTimeout(r, delay))
    }
  }
}

function ratingClass(r) {
  if (r >= 7.0) return 'rating-value high'
  if (r < 5.0) return 'rating-value low'
  return 'rating-value'
}

function formatAge(age) {
  const n = age.replace(/^age/, '')
  return (n === '' || n === '0') ? '0+' : n + '+'
}

function joinList(arr, key) {
  return arr.map(x => x[key]).join(', ')
}



function togglePlayerDropdown() {
  const dd = document.getElementById('playerDropdown')
  const chevron = document.getElementById('playerDropdownChevron')
  const open = dd.classList.toggle('open')
  chevron.style.transform = open ? 'rotate(180deg)' : ''
}

let _playerGen = 0
let _playerCleanup = null
let _players = []

let _currentUserRating = null
let _currentKpId = null
let _isFavorited = false
let _favoriteInFlight = false
let _favoriteAbort = null
let _commentsOffset = 0
let _hasMoreComments = false
let _nzCloseHandler = null

function playerSetState(state, gen) {
  if (gen !== undefined && gen !== _playerGen) return
  const wrapper = document.querySelector('.player-wrapper')
  if (!wrapper) return
  wrapper.classList.remove('loading', 'ready', 'error')
  if (state) wrapper.classList.add(state)
  // TV: при готовности плеера фокусируем iframe — без этого первый OK уходит в
  // spatial nav (кликает по кнопке выбора), а не в сам плеер
  if (state === 'ready' && window.innerWidth >= 1400) {
    const frame = document.getElementById('player-frame')
    if (frame) frame.focus()
  }
}

function playerUpdateUI(name) {
  document.getElementById('playerSelectedName').textContent = name
  document.getElementById('playerDropdown').classList.remove('open')
  document.getElementById('playerDropdownChevron').style.transform = ''
  document.querySelectorAll('.player-option').forEach(o => {
    o.classList.toggle('active', o.dataset.name === name)
  })
}

function selectPlayer(name, url, type) {
  if (_playerCleanup) { _playerCleanup(); _playerCleanup = null }

  const gen = ++_playerGen
  let frame = document.getElementById('player-frame')

  playerSetState('loading', gen)
  playerUpdateUI(name)

  if (type === 'turbo') {
    const fresh = document.createElement('iframe')
    fresh.id = 'player-frame'
    fresh.frameBorder = '0'
    fresh.title = 'Видеоплеер'
    fresh.setAttribute('allow', 'autoplay; fullscreen')

    let done = false
    const markReady = () => {
      if (done) return
      done = true
      clearTimeout(errorTimer)
      clearTimeout(forceTimer)
      window.removeEventListener('message', onMsg)
      playerSetState('ready', gen)
    }

    // Путь 1: postMessage от плеера (в т.ч. из вложенных iframe внутри плеера)
    const onMsg = e => {
      let d = e.data
      if (typeof d === 'string') { try { d = JSON.parse(d) } catch { return } }
      if (d && typeof d.event === 'string') markReady()
    }
    window.addEventListener('message', onMsg)

    // Путь 2: load + 500ms (плеер инициализируется чуть после load)
    fresh.addEventListener('load', () => {
      setTimeout(() => {
        if (!fresh.contentWindow) return
        fresh.contentWindow.postMessage({ api: 'ready' }, '*')
        for (const ev of ['play', 'pause', 'time', 'end', 'ready']) {
          fresh.contentWindow.postMessage({ api: 'addEventListener', value: ev }, '*')
        }
      }, 300)
      setTimeout(markReady, 500)
    })

    // Путь 3: форс-ready через 15 секунд (хуже чем ошибка — покажем что есть)
    const forceTimer = setTimeout(markReady, 15000)

    // Ошибка только если совсем ничего за 60 секунд (не должно срабатывать)
    const errorTimer = setTimeout(() => {
      if (!done) { done = true; window.removeEventListener('message', onMsg); playerSetState('error', gen) }
    }, 60000)

    fresh.src = url
    frame.parentNode.replaceChild(fresh, frame)

    _playerCleanup = () => {
      done = true
      window.removeEventListener('message', onMsg)
      clearTimeout(forceTimer)
      clearTimeout(errorTimer)
    }
    return
  }

  // Для не-turbo плееров сбрасываем src/srcdoc у существующего iframe
  frame.removeAttribute('srcdoc')
  frame.removeAttribute('src')

  if (type === 'vibix') {
    const h = Math.round(document.querySelector('.player-wrapper').offsetHeight)
    let done = false
    const markReady = success => {
      if (done) return
      done = true
      clearTimeout(timer)
      frame.removeEventListener('load', onLoad)
      playerSetState(success ? 'ready' : 'error', gen)
    }
    const onLoad = () => markReady(true)
    const timer = setTimeout(() => markReady(false), 30000)
    frame.addEventListener('load', onLoad)
    frame.srcdoc = vibixSrcdoc(url, h)
    _playerCleanup = () => { done = true; clearTimeout(timer); frame.removeEventListener('load', onLoad) }
    return
  }

  frame.src = url

  if (type === 'flixcdn') {
    if (typeof window.khS !== 'undefined') window.khS = false
    if (typeof khCL === 'function') { window.khF = frame; setTimeout(khCL, 0) }
    const done = success => {
      clearTimeout(timer)
      window.removeEventListener('message', onMsg)
      playerSetState(success ? 'ready' : 'error', gen)
    }
    const onMsg = e => { if (e.data === 'khL') done(true) }
    const timer = setTimeout(() => done(false), 12000)
    window.addEventListener('message', onMsg)
    _playerCleanup = () => { clearTimeout(timer); window.removeEventListener('message', onMsg); window.khF = null }
  } else {
    const onLoad = () => {
      clearTimeout(timer)
      frame.removeEventListener('load', onLoad)
      playerSetState('ready', gen)
    }
    const timer = setTimeout(() => {
      frame.removeEventListener('load', onLoad)
      playerSetState('error', gen)
    }, 30000)
    frame.addEventListener('load', onLoad)
    _playerCleanup = () => { clearTimeout(timer); frame.removeEventListener('load', onLoad) }
  }
}

document.addEventListener('click', e => {
  const wrap = document.getElementById('playerSelectWrap')
  if (wrap && !wrap.contains(e.target)) {
    document.getElementById('playerDropdown')?.classList.remove('open')
    const chevron = document.getElementById('playerDropdownChevron')
    if (chevron) chevron.style.transform = ''
  }
})

function playerSectionHtml(movie) {
  // Плееры грузятся отдельным запросом GET /api/players/:id (loadPlayers).
  // Рендерим оболочку сразу (со спиннером), наполняем когда приедут плееры.
  const id = movie.kinopoiskId || movie.imdbId
  if (!id) return ''

  return `<details class="player-section">
    <summary class="player-summary">
      <i class="fas fa-play-circle"></i>
      <span>Смотреть онлайн</span>
      <i class="fas fa-chevron-down player-chevron"></i>
    </summary>
    <div class="player-select-wrap" id="playerSelectWrap">
      <div class="player-select-inner">
        <button class="player-select-trigger" onclick="togglePlayerDropdown()">
          <span id="playerSelectedName">Загрузка...</span>
          <i class="fas fa-chevron-down" id="playerDropdownChevron"></i>
        </button>
        <div class="player-dropdown" id="playerDropdown"></div>
      </div>
      <div id="watchPartySlot"></div>
    </div>
    <div class="player-wrapper">
      <iframe id="player-frame" title="Видеоплеер" frameborder="0" allow="autoplay; fullscreen; encrypted-media; picture-in-picture"></iframe>
      <div class="player-loading">
        <i class="fas fa-circle-notch fa-spin"></i>
      </div>
      <div class="player-error">
        <i class="fas fa-exclamation-circle"></i>
        <span>Плеер не доступен, попробуйте другой</span>
      </div>
    </div>
  </details>`
}

// «Смотреть вместе» (party) — soft-deleted: точку входа не рендерим.
// Код party.html/party.js/бэкенд-роуты оставлены на месте (обратимо) — чтобы
// вернуть фичу, восстановить тело функции ниже.
function applyWatchParty(id, players) {
  const slot = document.getElementById('watchPartySlot')
  if (!slot) return
  slot.innerHTML = ''
}

// Один запрос за плеерами → массив (пустой при ошибке/пустом ответе)
async function _fetchPlayers(res) {
  try {
    const r = res ? await res : await fetch(`${API_BASE}/api/players/${movieId}`)
    if (r.ok) return (await r.json()).players || []
  } catch {}
  return []
}

// Асинхронная загрузка плееров (после рендера метаданных).
// Холодный тайтл: бэкенд не успевает опросить провайдеров за свой таймаут и отдаёт
// пустой список (он не кешируется → повторный запрос обычно уже находит плееры).
// Поэтому при пустом ответе ретраим, держа спиннер «проверки», вместо «Нет плееров».
async function loadPlayers(res, id) {
  const section = document.querySelector('.player-section')
  if (!section) return
  let players = await _fetchPlayers(res)
  for (let i = 0; players.length === 0 && i < 3; i++) {
    await new Promise(r => setTimeout(r, 2000))
    players = await _fetchPlayers(null)
  }
  applyWatchParty(id, players)
  initPlayerLazyLoad(players)
}

function preconnectPlayerDomains(players) {
  const origins = new Set()
  for (const p of players) {
    if (p.type === 'vibix') {
      origins.add('https://graphicslab.io')
    } else {
      try { origins.add(new URL(p.url).origin) } catch {}
    }
    if (p.type === 'turbo') {
      const l = document.createElement('link')
      l.rel = 'prefetch'
      l.href = p.url
      document.head.appendChild(l)
    }
  }
  for (const origin of origins) {
    if (document.querySelector(`link[rel="preconnect"][href="${origin}"]`)) continue
    const l = document.createElement('link')
    l.rel = 'preconnect'
    l.href = origin
    document.head.appendChild(l)
  }
}

function initPlayerLazyLoad(players) {
  const details = document.querySelector('.player-section')
  if (!details) return

  if (!players.length) {
    document.getElementById('playerSelectedName').textContent = 'Нет плееров'
    playerSetState('error')
    return
  }

  // плееры приехали — убираем спиннер «проверки плееров» (выставлен в renderMovie)
  playerSetState('')

  _players = players
  preconnectPlayerDomains(players)

  const dropdown = document.getElementById('playerDropdown')
  dropdown.innerHTML = ''
  players.forEach(p => {
    const opt = document.createElement('button')
    opt.type = 'button'
    opt.className = 'player-option'
    opt.dataset.name = p.name
    opt.textContent = p.name
    opt.addEventListener('click', () => selectPlayer(p.name, p.url, p.type))
    dropdown.appendChild(opt)
  })

  let started = false
  const startFirstPlayer = () => {
    if (started) return
    started = true
    selectPlayer(players[0].name, players[0].url, players[0].type)
  }

  // Начинаем загрузку при наведении (до клика), с debounce 200ms
  const summary = details.querySelector('summary')
  if (summary) {
    let hoverTimer = null
    summary.addEventListener('pointerenter', () => {
      hoverTimer = setTimeout(startFirstPlayer, 200)
    }, { once: true })
    summary.addEventListener('pointerleave', () => {
      clearTimeout(hoverTimer)
    }, { once: true })
  }

  // TV (≥1400px): запускаем первый плеер сразу — нет hover-preload через pointerenter,
  // iframe грузится в фоне пока <details> закрыт, при открытии уже готов
  if (window.innerWidth >= 1400) {
    startFirstPlayer()
    details.addEventListener('toggle', () => {
      if (!details.open) return
      startFirstPlayer()
    }, { once: true })
    return
  }

  // На LG WebOS 1.x/2.x <details> не поддерживается — toggle не срабатывает,
  // контент всегда виден, поэтому стартуем плеер сразу
  if (!('open' in details) || details.open) {
    startFirstPlayer()
  } else {
    details.addEventListener('toggle', () => {
      if (!details.open) return
      startFirstPlayer()
    }, { once: true })
  }
}

let _movieRenderedId = null

function renderMovie(movie) {
  // Превью (из карточки) и полные данные приходят разными вызовами. Если это тот же
  // фильм и DOM уже построен — патчим существующие узлы вместо пересборки innerHTML,
  // иначе постер перезагружается и страница «мигает» (видимая пересборка).
  const _id = String(movie.kinopoiskId || movie.filmId || '')
  const isPatch = _movieRenderedId === _id && _id !== '' &&
                  !!document.querySelector('#movieContent .movie-layout')
  _movieRenderedId = _id

  // Сброс состояния плеера только при настоящей пересборке (не при патче того же фильма)
  if (!isPatch) {
    if (_playerCleanup) { _playerCleanup(); _playerCleanup = null }
    _playerGen = 0
  }

  historyAdd(movie)
  const title = movie.nameRu || movie.nameEn || 'Без названия'
  document.title = title + ' — NaZeleniy'

  const descMeta = (movie.description || movie.shortDescription || '').slice(0, 200)
  const ogImage = posterUrl(movie.posterUrl || movie.posterUrlPreview)
  const ogUrl = 'https://nazeleniy.site/movie/' + (movie.kinopoiskId || movie.filmId || '')
  document.querySelector('meta[name="description"]')?.setAttribute('content', descMeta)
  document.querySelector('meta[property="og:title"]')?.setAttribute('content', title)
  document.querySelector('meta[property="og:description"]')?.setAttribute('content', descMeta)
  document.querySelector('meta[property="og:image"]')?.setAttribute('content', ogImage)
  document.querySelector('meta[property="og:url"]')?.setAttribute('content', ogUrl)

  const bgEl = document.getElementById('bg-poster')
  const bgUrl = posterUrl(movie.posterUrlPreview || movie.posterUrl)
  if (bgEl && bgUrl) {
    bgEl.style.backgroundImage = `url("${bgUrl}")`
    localStorage.setItem('nz_bg_poster', bgUrl)
  }

  let ratingsHtml = ''
  if (movie.ratingKinopoisk > 0) {
    ratingsHtml += `
      <div class="rating-container">
        <a class="rating-link" href="https://www.kinopoisk.ru/film/${movie.kinopoiskId}" target="_blank" rel="noopener noreferrer"
           title="Оценок: ${movie.ratingKinopoiskVoteCount || 0}">
          <img src="/img/logo/logo_kp.svg" alt="KP" class="rating-logo-img"/>
          <span class="${ratingClass(movie.ratingKinopoisk)}">${movie.ratingKinopoisk.toFixed(1)}</span>
          <img src="/img/logo/link.png" alt="link" class="rating-link-icon"/>
        </a>
      </div>`
  }
  if (movie.ratingImdb > 0) {
    const imdbHref = movie.imdbId ? `https://www.imdb.com/title/${movie.imdbId}` : null
    const imdbInner = `
          <img src="/img/logo/logo_imdb.svg" alt="IMDb" class="rating-logo-img"/>
          <span class="${ratingClass(movie.ratingImdb)}">${movie.ratingImdb.toFixed(1)}</span>
          ${imdbHref ? `<img src="/img/logo/link.png" alt="link" class="rating-link-icon"/>` : ''}`
    ratingsHtml += `
      <div class="rating-container">
        ${imdbHref
          ? `<a class="rating-link" href="${imdbHref}" target="_blank" rel="noopener noreferrer" title="Оценок: ${movie.ratingImdbVoteCount || 0}">${imdbInner}</a>`
          : `<span class="rating-link" title="Оценок: ${movie.ratingImdbVoteCount || 0}">${imdbInner}</span>`
        }
      </div>`
  }

  const nzVotes = movie.ratingNazeleniyVoteCount || 0
  const nzRating = movie.ratingNazeleniy || 0
  ratingsHtml += nzVotes > 0
    ? `<div class="rating-container" id="nz-rating-display">
        <div class="rating-link nz-rating-link" title="Оценок на NaZeleniy: ${nzVotes}">
          <img src="/img/logo/logo_na.svg" alt="NZ" class="rating-logo-img"/>
          <span class="${ratingClass(nzRating)}">${nzRating.toFixed(1)}</span>
        </div>
      </div>`
    : `<div class="rating-container" id="nz-rating-display" style="display:none"></div>`

  const rows = []
  if (movie.nameOriginal && movie.nameOriginal !== movie.nameRu)       rows.push(['Оригинальное название', movie.nameOriginal])
  if (movie.year > 0)                                                  rows.push(['Год выпуска', movie.year])
  if (movie.countries?.length)                                         rows.push(['Страна', joinList(movie.countries, 'country')])
  if (movie.genres?.length)                                            rows.push(['Жанры', joinList(movie.genres, 'genre')])
  if (movie.filmLength > 0)                                            rows.push(['Длительность', movie.filmLength + ' мин'])
  if (movie.slogan && movie.slogan !== '-' && movie.slogan !== 'null') rows.push(['Слоган', '«' + movie.slogan + '»'])

  const infoRowsHtml = rows.map(([k, v]) => `<li><strong>${k}:</strong> ${escapeHtml(String(v))}</li>`).join('\n')

  const ageHtml = (movie.ratingAgeLimits && movie.ratingAgeLimits !== 'age0')
    ? `<li class="rating-boxes"><div class="rating-box age"><strong>${formatAge(movie.ratingAgeLimits)}</strong></div></li>`
    : ''

  const posterSrc = posterUrl(movie.posterUrlPreview || movie.posterUrl)
  const posterFull = posterUrl(movie.posterUrl || movie.posterUrlPreview)
  const safeTitle = escapeHtml(title)
  const posterHtml = `<a class="movie-poster-side" href="${posterFull}" target="_blank" rel="noopener noreferrer">
       <img class="movie-poster" src="${posterSrc}" alt="${safeTitle}"
            onload="this.classList.add('loaded')"
            onerror="this.classList.add('loaded');this.onerror=null;this.src=(this.src!=='${posterFull}'?'${posterFull}':'/img/placeholder.svg')"/>
     </a>
     <div id="nz-poster-rating" class="nz-poster-rating"></div>
     <div id="nz-favorite-wrap"></div>`

  const desc = movie.description || movie.shortDescription || ''
  const descHtml = desc
    ? `<div class="content-info"><p class="content-description-text">${escapeHtml(desc)}</p></div>`
    : ''

  // Патч-путь: тот же фильм уже отрисован (превью → полные данные). Обновляем
  // только изменившиеся узлы, не трогая постер/плеер/подсекции — без вспышки.
  if (isPatch) {
    const c = document.getElementById('movieContent')
    const titleEl = c.querySelector('.content-title')
    if (titleEl) titleEl.textContent = title
    const rl = c.querySelector('.ratings-links')
    if (rl) rl.innerHTML = ratingsHtml
    const il = c.querySelector('.info-list')
    if (il) il.innerHTML = infoRowsHtml + '\n' + ageHtml
    const img = c.querySelector('.movie-poster')
    if (img && posterSrc && img.getAttribute('src') !== posterSrc) img.src = posterSrc
    const plink = c.querySelector('.movie-poster-side')
    if (plink && posterFull) plink.setAttribute('href', posterFull)
    const descP = c.querySelector('.content-description-text')
    if (desc) {
      if (descP) descP.textContent = desc
      else c.querySelector('.movie-layout-main')?.insertAdjacentHTML('beforeend', descHtml)
    } else if (descP) {
      descP.closest('.content-info')?.remove()
    }
    return
  }

  document.getElementById('movieContent').innerHTML = `
    <div class="content-header">
      <h1 class="content-title">${safeTitle}</h1>
    </div>
    <div class="ratings-links">${ratingsHtml}</div>
    <div class="movie-layout">
      <div class="movie-layout-poster">
        ${posterHtml}
      </div>
      <div class="movie-layout-main">
        <ul class="info-list">
          ${infoRowsHtml}
          ${ageHtml}
        </ul>
        <div id="cast-section"></div>
        <div id="platforms-section"></div>
        ${descHtml}
      </div>
    </div>
    ${playerSectionHtml(movie)}
    <div id="sequels-section"></div>
    <div id="similars-section"></div>
    <div id="comments-section"></div>
  `
  // Плееры приедут отдельным запросом (loadPlayers). Пока показываем спиннер в области плеера.
  if (movie.kinopoiskId || movie.imdbId) playerSetState('loading')
}

// Студии / платформы тайтла. Источник — raw.companies (любой kind: network/studio)
// + raw.availability.platform. Слаги резолвим из /api/filters (platforms[]). Карточки
// оформлены как каст, но синие. Кликабельны (ведут на /platform/<slug>) те компании,
// что есть в каталоге платформ; остальные (продакшн-студии) — статичные серые карточки,
// т.к. бэкенд не умеет фильтровать по произвольной студии.
async function loadPlatforms(raw) {
  const section = document.getElementById('platforms-section')
  if (!section || !raw) return

  // Все компании (network + studio) + availability.platform, дедуп по имени
  const names = []
  const seen = new Set()
  const add = n => {
    const name = String(n || '').trim()
    if (!name) return
    const key = name.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    names.push(name)
  }
  ;(raw.companies || []).forEach(c => { if (c) add(c.name) })
  if (raw.availability && raw.availability.platform) add(raw.availability.platform)
  if (!names.length) return

  // Карта name -> { slug, poster_url } из /api/filters (кеш в sessionStorage)
  let platforms = []
  try {
    const cached = sessionStorage.getItem('nz_platforms')
    if (cached) platforms = JSON.parse(cached)
  } catch {}
  if (!platforms.length) {
    try {
      const r = await fetch(`${API_BASE}/api/filters`)
      if (r.ok) {
        platforms = (await r.json()).platforms || []
        try { sessionStorage.setItem('nz_platforms', JSON.stringify(platforms)) } catch {}
      }
    } catch {}
  }
  const byName = new Map()
  platforms.forEach(p => byName.set(String(p.name || '').toLowerCase(), p))

  // Кликабельные платформы — вперёд, статичные студии — следом
  names.sort((a, b) => (byName.has(b.toLowerCase()) ? 1 : 0) - (byName.has(a.toLowerCase()) ? 1 : 0))

  // Просто текстовая надпись (как каст: подчёркивание, через запятую), без hover-карточки.
  // Синяя+ссылка для каталожных платформ, серая для остальных студий.
  const renderCompany = name => {
    const safe = escapeHtml(name)
    const meta = byName.get(name.toLowerCase())
    const slug = meta && meta.slug
    return slug
      ? `<a class="cast-item cast-item--platform" href="/platform/${encodeURIComponent(slug)}"><span class="cast-name">${safe}</span></a>`
      : `<span class="cast-item cast-item--platform cast-item--static"><span class="cast-name">${safe}</span></span>`
  }

  section.innerHTML = `
    <div class="cast-section">
      <div class="cast-group">
        <div class="cast-group-title">${_nzLang === 'en' ? 'Studios & platforms' : 'Студии'}</div>
        <div class="cast-list">${names.map(renderCompany).join('')}</div>
      </div>
    </div>`
}

// data — уже распарсенный `{cast:[...]}` (встроен в /api/movie через include=cast).
// Если не передан — фолбэк на отдельный запрос /api/staff.
async function loadStaff(data) {
  const section = document.getElementById('cast-section')
  if (!section || !movieId) return
  try {
    if (!data) {
      const r = await fetch(`${API_BASE}/api/staff/${movieId}`)
      if (!r.ok) return
      data = await r.json()
    }
    const staff = normalizeStaff(data)

    const directors = staff.filter(p => p.professionKey === 'DIRECTOR').slice(0, 4)
    const actors    = staff.filter(p => p.professionKey === 'ACTOR').slice(0, 10)
    if (!directors.length && !actors.length) return

    const renderPerson = p => {
      const nameRu = p.nameRu || p.nameEn || ''
      const nameEn = p.nameEn || ''
      const name   = (_nzLang === 'en' && nameEn) ? nameEn : nameRu
      const photo  = p.posterUrl ? personPhotoUrl(p.posterUrl) : ''
      const da     = `data-ru="${escapeHtml(nameRu)}" data-en="${escapeHtml(nameEn)}"`
      const safe   = escapeHtml(name)
      // Нет kp_id персоны → нет страницы /person и нет данных для карточки:
      // рендерим обычным текстом, без ссылочного выделения и без hover-карточки.
      if (!p.staffId) {
        return `
          <span class="cast-item cast-item--noperson">
            <div class="cast-name-wrap">
              <span class="cast-name" ${da}>${safe}</span>
            </div>
          </span>`
      }
      return `
        <a class="cast-item" href="/person/${p.staffId}" data-staff-id="${p.staffId}">
          <div class="cast-name-wrap">
            <span class="cast-name" ${da}>${safe}</span>
          </div>
          <div class="cast-card">
            ${photo ? `<img class="cast-card-photo" src="${escapeHtml(photo)}" alt="${safe}" loading="lazy" onerror="this.style.display='none'"/>` : ''}
            <div class="cast-card-body">
              <div class="cast-card-name" ${da}>${safe}</div>
              ${nameEn && nameEn !== nameRu ? `<div class="cast-card-name-en">${escapeHtml(nameEn)}</div>` : ''}
              <div class="cast-card-extra"></div>
            </div>
          </div>
        </a>`
    }

    const dirTitle = _nzLang === 'en' ? ('Director' + (directors.length > 1 ? 's' : '')) : ('Режиссёр' + (directors.length > 1 ? 'ы' : ''))
    const castTitle = _nzLang === 'en' ? 'Cast' : 'В ролях'
    let html = '<div class="cast-section">'
    if (directors.length) html += `
      <div class="cast-group">
        <div class="cast-group-title">${dirTitle}</div>
        <div class="cast-list">${directors.map(renderPerson).join('')}</div>
      </div>`
    if (actors.length) html += `
      <div class="cast-group">
        <div class="cast-group-title">${castTitle}</div>
        <div class="cast-list">${actors.map(renderPerson).join('')}</div>
      </div>`
    html += '</div>'
    section.innerHTML = html
    if (typeof _nzApplyCast === 'function') _nzApplyCast()

    const fetched = new Set()
    section.querySelectorAll('.cast-item[data-staff-id]').forEach(item => {
      item.addEventListener('mouseenter', async () => {
        const id = item.dataset.staffId
        if (fetched.has(id)) return
        fetched.add(id)
        const extra = item.querySelector('.cast-card-extra')
        extra.innerHTML = '<i class="fas fa-circle-notch fa-spin cast-card-spinner"></i>'
        try {
          const r = await fetch(`${API_BASE}/api/person/${id}`)
          if (!r.ok) throw new Error()
          const d = normalizePerson(await r.json())
          let metaHtml = ''
          if (d.birthYear) {
            metaHtml += `<div class="cast-card-meta">${d.birthYear} г.р.</div>`
          }
          if (d.birthplace) {
            metaHtml += `<div class="cast-card-meta cast-card-birthplace">${escapeHtml(d.birthplace)}</div>`
          }
          extra.innerHTML = metaHtml
        } catch {
          extra.innerHTML = ''
        }
      }, { once: true })
    })
  } catch {}
}

// data — уже распарсенный `{items}` (встроен в /api/movie через include=franchise).
// Если не передан — фолбэк на отдельный запрос /api/sequels.
async function loadSequels(data) {
  const section = document.getElementById('sequels-section')
  if (!section || !movieId) return
  try {
    if (!data) {
      const r = await fetch(`${API_BASE}/api/sequels/${movieId}`)
      if (!r.ok) { section.innerHTML = ''; return }
      data = await r.json()
    }
    const items = (data.items || []).map(normalizeStub).filter(m => String(m.filmId) !== String(movieId))
    if (!items.length) { section.innerHTML = ''; return }

    const cards = items.map(m => {
      const id    = m.filmId
      const name  = m.nameRu || m.nameEn || m.nameOriginal || 'Без названия'
      const safe  = escapeHtml(name)
      const thumb = posterUrl(m.posterUrlPreview || m.posterUrl)
      const full  = posterUrl(m.posterUrl)
      const meta  = escapeHtml(String(m.year || ''))
      const preview = JSON.stringify({ filmId: id, nameRu: m.nameRu, nameEn: m.nameEn, posterUrl: m.posterUrl, posterUrlPreview: m.posterUrlPreview, year: m.year }).replace(/'/g, '&#39;').replace(/"/g, '&quot;')
      return `
        <a class="similar-card" href="/movie/${id}" onclick="sessionStorage.setItem('moviePreview','${preview}')">
          <div class="similar-poster-wrap">
            <img src="${thumb}" alt="${safe}" loading="lazy" onerror="this.src=(this.src!=='${full}'&&'${full}'.indexOf('placeholder')<0)?'${full}':(this.onerror=null,'/img/placeholder.svg')"/>
          </div>
          <div class="similar-info">
            <div class="similar-title">${safe}</div>
            ${meta ? `<div class="similar-meta">${meta}</div>` : ''}
          </div>
        </a>`
    }).join('')

    section.innerHTML = `
      <div class="similars-section">
        <div class="cast-group-title">Сиквелы и Приквелы</div>
        <div class="similars-list">${cards}</div>
      </div>`
  } catch { section.innerHTML = '' }
}

// data — уже распарсенный `{items,relation}` (встроен в /api/movie через include=similar).
// Если не передан — фолбэк на отдельный запрос /api/similars.
async function loadSimilars(data) {
  const section = document.getElementById('similars-section')
  if (!section || !movieId) return
  section.innerHTML = `<div class="similars-loading"><i class="fas fa-circle-notch fa-spin"></i></div>`
  try {
    if (!data) {
      const r = await fetch(`${API_BASE}/api/similars/${movieId}`)
      if (!r.ok) { section.innerHTML = ''; return }
      data = await r.json()
    }
    const items = (data.items || []).map(normalizeStub)
    if (!items.length) { section.innerHTML = ''; return }

    const cards = items.map(m => {
      const id    = m.filmId
      const name  = m.nameRu || m.nameEn || m.nameOriginal || 'Без названия'
      const safe  = escapeHtml(name)
      const thumb = posterUrl(m.posterUrlPreview || m.posterUrl)
      const full  = posterUrl(m.posterUrl)
      const meta  = escapeHtml([m.year, m.nameEn && m.nameEn !== m.nameRu ? m.nameEn : null].filter(Boolean).join(' · '))
      const preview = JSON.stringify({ filmId: id, nameRu: m.nameRu, nameEn: m.nameEn, posterUrl: m.posterUrl, posterUrlPreview: m.posterUrlPreview, year: m.year }).replace(/'/g, '&#39;').replace(/"/g, '&quot;')
      return `
        <a class="similar-card" href="/movie/${id}" onclick="sessionStorage.setItem('moviePreview','${preview}')">
          <div class="similar-poster-wrap">
            <img src="${thumb}" alt="${safe}" loading="lazy" onerror="this.src=(this.src!=='${full}'&&'${full}'.indexOf('placeholder')<0)?'${full}':(this.onerror=null,'/img/placeholder.svg')"/>
          </div>
          <div class="similar-info">
            <div class="similar-title">${safe}</div>
            ${meta ? `<div class="similar-meta">${meta}</div>` : ''}
          </div>
        </a>`
    }).join('')

    section.innerHTML = `
      <div class="similars-section">
        <div class="cast-group-title">Похожие</div>
        <div class="similars-list">${cards}</div>
      </div>`
  } catch { section.innerHTML = '' }
}

// ── NaZeleniy Rating Widget ────────────────────────────────

function initRatingWidget(movie) {
  const kpId = movie.kinopoiskId || movie.filmId
  if (!kpId) return
  _currentKpId = kpId
  _currentUserRating = null
  _favoriteInFlight = false
  if (_favoriteAbort) { _favoriteAbort.abort(); _favoriteAbort = null }
  nzRenderRatingClosed()
}

function nzRatingColor(v) {
  if (v <= 4) return [231, 76, 60]
  if (v <= 6) return [149, 165, 166]
  return [39, 174, 96]
}

function nzRenderRatingClosed() {
  if (_nzCloseHandler) {
    document.removeEventListener('click', _nzCloseHandler)
    _nzCloseHandler = null
  }
  const c = document.getElementById('nz-poster-rating')
  if (!c) return
  c.querySelector('.nz-rate-picker')?.remove()
  if (_currentUserRating) {
    const [r, g, b] = nzRatingColor(_currentUserRating)
    c.innerHTML = `
      <div class="nz-rate-display" style="--nz-r:${r};--nz-g:${g};--nz-b:${b}">
        <div class="nz-rate-display-left">
          <div class="nz-rate-big-val">${_currentUserRating}</div>
          <div class="nz-rate-display-label">ваша оценка</div>
        </div>
        <div class="nz-rate-display-divider"></div>
        <div class="nz-rate-display-right">
          <button class="nz-rate-change-btn" onclick="nzOpenPicker()">Изменить</button>
          <button class="nz-rate-remove-btn" onclick="doDeleteRating()">Убрать</button>
        </div>
      </div>
      <div class="nz-rate-msg" id="nz-rate-msg"></div>`
  } else {
    c.innerHTML = `
      <button class="nz-rate-open-btn" onclick="nzOpenPicker()">
        <span class="nz-rate-open-icon">★</span>
        <span>Оценить фильм</span>
      </button>
      <div class="nz-rate-msg" id="nz-rate-msg"></div>`
  }
}

function nzOpenPicker() {
  const c = document.getElementById('nz-poster-rating')
  if (!c) return
  c.querySelector('.nz-rate-picker')?.remove()

  const nums = Array.from({ length: 10 }, (_, i) => i + 1)
    .map(n => `<span class="nz-num" data-v="${n}">${n}</span>`).join('')

  const picker = document.createElement('div')
  picker.id = 'nz-rate-picker'
  picker.className = 'nz-rate-picker'
  picker.innerHTML = `<div class="nz-num-row" id="nz-num-row">${nums}</div>`
  c.innerHTML = ''
  c.appendChild(picker)
  nzInitSlider(_currentUserRating || 5)

  _nzCloseHandler = e => {
    if (!c.contains(e.target)) nzRenderRatingClosed()
  }
  setTimeout(() => document.addEventListener('click', _nzCloseHandler), 0)
}

function nzInitSlider(startVal) {
  const numRow = document.getElementById('nz-num-row')
  if (!numRow) return

  let val = startVal

  let _rating = false
  numRow.addEventListener('click', async e => {
    if (_rating) return
    const target = e.target.closest('.nz-num')
    if (!target) return
    _rating = true
    val = +target.dataset.v
    if (_nzCloseHandler) {
      document.removeEventListener('click', _nzCloseHandler)
      _nzCloseHandler = null
    }
    await doRate(val)
  })
}

async function doRate(value) {
  if (!_currentKpId) return
  try {
    const r = await fetch(`${API_BASE}/api/ratings/${_currentKpId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ..._bearerHeader() },
      credentials: _CREDS,
      body: JSON.stringify({ rating: value })
    })
    if (r.status === 401) {
      nzRenderRatingClosed()
      showAuthRequiredToast()
      return
    }
    if (!r.ok) throw new Error()
    _currentUserRating = value
    nzRenderRatingClosed()
    refreshNzRating()
  } catch {
    nzRenderRatingClosed()
    const msg = document.getElementById('nz-rate-msg')
    if (msg) msg.innerHTML = `<span class="nz-msg-error">Ошибка, попробуйте ещё раз</span>`
  }
}

async function doDeleteRating() {
  if (!_currentKpId) return
  try {
    const r = await fetch(`${API_BASE}/api/ratings/${_currentKpId}`, {
      method: 'DELETE',
      credentials: _CREDS,
      headers: _bearerHeader()
    })
    if (r.status === 401) {
      showAuthRequiredToast()
      return
    }
    if (r.status === 204 || r.ok) {
      _currentUserRating = null
      nzRenderRatingClosed()
      refreshNzRating()
    }
  } catch {}
}

async function refreshNzRating() {
  if (!_currentKpId) return
  // Только для авторизованных: эндпоинт нужен ради ИХ оценки; публичный
  // агрегат NZ уже приходит в /api/movie. Анонимам — лишний запрос.
  if (!window._nzUser && !sessionStorage.getItem('nz_me')) return
  try {
    const r = await fetch(`${API_BASE}/api/ratings/${_currentKpId}`, { credentials: _CREDS, headers: _bearerHeader() })
    if (!r.ok) return
    const data = await r.json()

    // обновляем userRating из этого же запроса
    const newRating = data.user_rating ?? data.userRating ?? null
    if (newRating !== _currentUserRating) {
      _currentUserRating = newRating
      nzRenderRatingClosed()
    }

    const el = document.getElementById('nz-rating-display')
    if (!el) return
    if ((data.ratingNazeleniyVoteCount || 0) > 0) {
      el.style.display = ''
      el.innerHTML = `
        <div class="rating-link nz-rating-link" title="Оценок на NaZeleniy: ${data.ratingNazeleniyVoteCount}">
          <img src="/img/logo/logo_na.svg" alt="NZ" class="rating-logo-img"/>
          <span class="${ratingClass(data.ratingNazeleniy)}">${(data.ratingNazeleniy || 0).toFixed(1)}</span>
        </div>`
    }
  } catch {}
}

// ── Favorites ─────────────────────────────────────────────

async function initFavorite(kpId) {
  if (_favoriteAbort) { _favoriteAbort.abort(); _favoriteAbort = null }
  let cached = null
  try { const r = localStorage.getItem('nz_me'); if (r) cached = JSON.parse(r) } catch {}
  if (!window._nzUser && !cached) {
    _isFavorited = false
    renderFavoriteBtn()
    return
  }
  const ctrl = new AbortController()
  _favoriteAbort = ctrl
  const result = await getFavoriteStatus(kpId, ctrl.signal)
  if (ctrl.signal.aborted) return
  _favoriteAbort = null
  _isFavorited = result
  renderFavoriteBtn()
}

async function getFavoriteStatus(kpId, signal) {
  try {
    const r = await fetch(`${API_BASE}/api/favorites/${kpId}`, {
      credentials: _CREDS,
      headers: _bearerHeader(),
      signal,
    })
    if (!r.ok) return false
    const data = await r.json()
    return data.favorited
  } catch {
    return false
  }
}

function renderFavoriteBtn() {
  const wrap = document.getElementById('nz-favorite-wrap')
  if (!wrap) return
  if (_isFavorited) {
    wrap.innerHTML = `
      <button class="nz-favorite-btn nz-favorite-btn--active" onclick="toggleFavorite()">
        <span class="nz-favorite-icon">♥</span>
        <span>В списке просмотра</span>
      </button>`
  } else {
    wrap.innerHTML = `
      <button class="nz-favorite-btn" onclick="toggleFavorite()">
        <span class="nz-favorite-icon">♡</span>
        <span>Буду смотреть</span>
      </button>`
  }
}

function renderFavoriteBtnLoading() {
  const wrap = document.getElementById('nz-favorite-wrap')
  if (!wrap) return
  wrap.innerHTML = `
    <button class="nz-favorite-btn" disabled>
      <i class="fas fa-circle-notch fa-spin nz-favorite-icon"></i>
      <span>${_isFavorited ? 'Убираю...' : 'Добавляю...'}</span>
    </button>`
}

async function toggleFavorite() {
  if (!window._nzUser && !sessionStorage.getItem('nz_me')) {
    showAuthRequiredToast()
    return
  }
  if (_favoriteInFlight) return
  const kpId = _currentKpId
  if (!kpId) return
  _favoriteInFlight = true
  renderFavoriteBtnLoading()
  try {
    const method = _isFavorited ? 'DELETE' : 'POST'
    const r = await fetch(`${API_BASE}/api/favorites/${kpId}`, {
      method,
      credentials: _CREDS,
      headers: _bearerHeader(),
    })
    if (r.status === 401) { showAuthRequiredToast(); return }
    // DELETE+404 = уже удалено — считаем успехом
    if (r.ok || (method === 'DELETE' && r.status === 404)) {
      _isFavorited = (method === 'POST')
    }
  } finally {
    // Всегда возвращаем кнопку в актуальное состояние — иначе при ошибке
    // сервера она залипала бы в disabled-loading до перезагрузки.
    _favoriteInFlight = false
    renderFavoriteBtn()
  }
}

// ── Comments ───────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatCommentDate(iso) {
  try {
    const d = new Date(iso)
    const now = new Date()
    const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    const sameDay = (a, b) =>
      a.getDate() === b.getDate() &&
      a.getMonth() === b.getMonth() &&
      a.getFullYear() === b.getFullYear()
    if (sameDay(d, now)) return `Сегодня, ${time}`
    const yesterday = new Date(now)
    yesterday.setDate(now.getDate() - 1)
    if (sameDay(d, yesterday)) return `Вчера, ${time}`
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) + ' ' + time
  } catch { return '' }
}

function renderCommentHtml(comment) {
  let u = window._nzUser
  if (!u) { try { const r = localStorage.getItem('nz_me'); if (r) { const p = JSON.parse(r); u = p.data || p } } catch {} }
  const uid = u ? String(u.user_id ?? '') : ''
  const isOwn = uid && comment.user_id != null && String(comment.user_id) === uid
  const deleteBtn = isOwn
    ? `<button class="comment-delete-btn" onclick="doDeleteComment('${comment.id}')" title="Удалить"><i class="fas fa-times"></i></button>`
    : ''
  return `
    <div class="comment-item" data-comment-id="${comment.id}">
      <div class="comment-header">
        <span class="comment-author">${escapeHtml(comment.display_name)}</span>
        <span class="comment-date">${formatCommentDate(comment.created_at)}</span>
        ${deleteBtn}
      </div>
      <p class="comment-text">${escapeHtml(comment.text)}</p>
    </div>`
}

function initComments(movie) {
  const section = document.getElementById('comments-section')
  if (!section) return
  const kpId = movie.kinopoiskId || movie.filmId
  if (!kpId) return

  _commentsOffset = 0
  _hasMoreComments = false

  section.innerHTML = `
    <div class="comments-wrap">
      <div class="nz-section-title">Комментарии</div>
      <div class="comments-moderation-warn">
        <i class="fas fa-exclamation-triangle"></i>
        <span>Осторожно, комментарии временно не модерируются!</span>
      </div>
      <button class="comments-show-btn" id="comments-show-btn" onclick="nzUnblurComments(${kpId})">
        <i class="fas fa-eye"></i>
        <span>Показать комментарии</span>
      </button>
    </div>`
}

async function _loadComments(kpId) {
  try {
    const r = await fetch(`${API_BASE}/api/comments/${kpId}?limit=20&offset=0`, { credentials: _CREDS, headers: _bearerHeader() })
    if (!r.ok) return
    const comments = await r.json()
    _commentsOffset = comments.length
    _hasMoreComments = comments.length >= 20
    const listEl = document.getElementById('comments-list')
    if (!listEl) return
    listEl.innerHTML = comments.length
      ? comments.map(renderCommentHtml).join('')
      : '<div class="comments-empty">Комментариев пока нет. Будьте первым!</div>'
    const moreWrap = document.getElementById('comments-load-more-wrap')
    if (moreWrap) moreWrap.style.display = _hasMoreComments ? '' : 'none'
  } catch {}
}

function nzUnblurComments(kpId) {
  const wrap = document.querySelector('.comments-wrap')
  if (!wrap) return
  wrap.innerHTML = `
    <div class="nz-section-title">Комментарии</div>
    <div class="comments-inner">
      <div class="comment-form">
        <textarea class="comment-textarea" id="comment-input"
          placeholder="Напишите комментарий..."
          maxlength="1000"
          oninput="document.getElementById('comment-char-count').textContent=this.value.length+'/1000'"></textarea>
        <div class="comment-form-footer">
          <span class="comment-char-count" id="comment-char-count">0 / 1000</span>
          <button class="comment-submit-btn" onclick="doSubmitComment(${kpId})">Отправить</button>
        </div>
        <div class="comment-form-msg" id="comment-form-msg"></div>
      </div>
      <div class="comments-list" id="comments-list">
        <div class="similars-loading"><i class="fas fa-circle-notch fa-spin"></i></div>
      </div>
      <div class="comments-load-more-wrap" id="comments-load-more-wrap" style="display:none">
        <button class="comments-load-more-btn" onclick="doLoadMoreComments(${kpId})">Показать ещё</button>
      </div>
    </div>`
  _loadComments(kpId)
}

async function doSubmitComment(kpId) {
  const input = document.getElementById('comment-input')
  const msgEl = document.getElementById('comment-form-msg')
  if (!input || !msgEl) return

  const text = input.value.trim()
  if (text.length < 3) {
    msgEl.innerHTML = '<span class="nz-msg-error">Комментарий слишком короткий (минимум 3 символа)</span>'
    return
  }

  const btn = document.querySelector('.comment-submit-btn')
  if (btn) btn.disabled = true
  msgEl.innerHTML = ''

  try {
    const r = await fetch(`${API_BASE}/api/comments/${kpId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ..._bearerHeader() },
      credentials: _CREDS,
      body: JSON.stringify({ text })
    })
    if (r.status === 401) {
      showAuthRequiredToast()
      return
    }
    if (!r.ok) {
      msgEl.innerHTML = '<span class="nz-msg-error">Ошибка отправки комментария</span>'
      return
    }
    const comment = await r.json()
    input.value = ''
    const counter = document.getElementById('comment-char-count')
    if (counter) counter.textContent = '0 / 1000'

    const listEl = document.getElementById('comments-list')
    if (listEl) {
      const emptyEl = listEl.querySelector('.comments-empty')
      if (emptyEl) emptyEl.remove()
      listEl.insertAdjacentHTML('afterbegin', renderCommentHtml(comment))
    }
    msgEl.innerHTML = '<span class="nz-msg-success">Комментарий добавлен</span>'
    setTimeout(() => { if (msgEl) msgEl.innerHTML = '' }, 3000)
  } catch {
    msgEl.innerHTML = '<span class="nz-msg-error">Ошибка, попробуйте ещё раз</span>'
  } finally {
    if (btn) btn.disabled = false
  }
}

async function doDeleteComment(commentId) {
  try {
    const r = await fetch(`${API_BASE}/api/comments/${commentId}`, {
      method: 'DELETE',
      credentials: _CREDS,
      headers: _bearerHeader()
    })
    if (r.status === 401) {
      showAuthRequiredToast()
      return
    }
    if (r.status === 404) {
      showToast('Можно удалять только свои комментарии', 'error')
      return
    }
    if (r.status === 204 || r.ok) {
      const el = document.querySelector(`.comment-item[data-comment-id="${commentId}"]`)
      if (el) el.remove()
      const listEl = document.getElementById('comments-list')
      if (listEl && !listEl.querySelector('.comment-item')) {
        listEl.innerHTML = '<div class="comments-empty">Комментариев пока нет. Будьте первым!</div>'
      }
    }
  } catch {}
}

async function doLoadMoreComments(kpId) {
  const btn = document.querySelector('.comments-load-more-btn')
  if (btn) btn.disabled = true
  try {
    const r = await fetch(`${API_BASE}/api/comments/${kpId}?limit=20&offset=${_commentsOffset}`, {
      credentials: _CREDS,
      headers: _bearerHeader()
    })
    if (!r.ok) return
    const comments = await r.json()
    _commentsOffset += comments.length
    _hasMoreComments = comments.length >= 20
    const listEl = document.getElementById('comments-list')
    if (listEl && comments.length) {
      const emptyEl = listEl.querySelector('.comments-empty')
      if (emptyEl) emptyEl.remove()
      listEl.insertAdjacentHTML('beforeend', comments.map(renderCommentHtml).join(''))
    }
    const moreWrap = document.getElementById('comments-load-more-wrap')
    if (moreWrap) moreWrap.style.display = _hasMoreComments ? '' : 'none'
  } catch {} finally {
    if (btn) btn.disabled = false
  }
}

function showAuthRequiredToast() {
  showToast('Необходимо <a href="/login" onclick="event.preventDefault();openAuthModal()">авторизоваться</a>', 'error')
}

function showToast(msg, type = 'info') {
  const existing = document.getElementById('nz-toast')
  if (existing) existing.remove()
  const toast = document.createElement('div')
  toast.id = 'nz-toast'
  toast.className = `nz-toast nz-toast-${type}`
  toast.innerHTML = msg
  document.body.appendChild(toast)
  toast.offsetHeight // reflow
  toast.classList.add('visible')
  setTimeout(() => {
    toast.classList.remove('visible')
    setTimeout(() => toast.remove(), 300)
  }, 3000)
}

function renderError(message) {
  document.getElementById('movieContent').innerHTML = `
    <div class="empty-state">
      <i class="fas fa-film"></i>
      <p>${message}</p>
    </div>
  `
}

// ── Полная инфа + переключение языка (порт надстройки из /ref) ──────────────
// Работает поверх renderMovie: берёт сырой сгруппированный ответ Kinodata
// (двуязычные поля) и дозаполняет инфо-лист, критиков, описание, факты;
// тумблер RU/EN перерисовывает всё на лету. Язык хранится в localStorage['nz_lang'].

// Приоритет: ручной выбор тумблером (nz_lang) → язык по умолчанию из настроек
// (nz_settings.lang) → 'ru'. Settings загружен синхронно (js/settings.js в movie.html).
let _nzLang = (() => {
  try {
    const ov = localStorage.getItem('nz_lang')
    if (ov) return ov
    const def = (typeof Settings !== 'undefined') ? Settings.get().lang : null
    return def || 'ru'
  } catch { return 'ru' }
})()
let _movieRaw = null
let _movieFacts = []
let _factsLoaded = false
let _descExpanded = false

const NZ_UI = {
  ru: { orig: 'Оригинальное название', year: 'Год выпуска', country: 'Страна', genres: 'Жанры',
        runtime: 'Длительность', tagline: 'Слоган', mpaa: 'MPAA', budget: 'Бюджет', box: 'Сборы в мире',
        awards: 'Награды', studio: 'Студии', premiere: 'Премьера', critics: 'Критики',
        more: 'Подробнее', less: 'Свернуть', trivia: 'Знаете ли вы, что…', bloopers: 'Ошибки в фильме',
        min: 'мин', spoilerTip: 'Спойлер — нажмите, чтобы показать' },
  en: { orig: 'Original title', year: 'Year', country: 'Country', genres: 'Genres',
        runtime: 'Runtime', tagline: 'Tagline', mpaa: 'MPAA', budget: 'Budget', box: 'Box office',
        awards: 'Awards', studio: 'Studios', premiere: 'Premiere', critics: 'Critics',
        more: 'Read more', less: 'Show less', trivia: 'Did you know…', bloopers: 'Goofs',
        min: 'min', spoilerTip: 'Spoiler — click to reveal' },
}

function _nzPick(ru, en) {
  const r = (ru == null ? '' : String(ru)).trim()
  const e = (en == null ? '' : String(en)).trim()
  return _nzLang === 'en' ? (e || r) : (r || e)
}

function _nzMoney(n) {
  if (!n) return ''
  const m = Math.round(n / 1e6)
  return _nzLang === 'ru' ? '$' + m + ' млн' : '$' + m + 'M'
}

// Список постеров по приоритету для текущего языка (без пустых).
// RU: kp первым (часто с русским названием), EN: imdb/tmdb (англоязычные/оригинальные).
// Источники иногда отдают мёртвые ссылки (особенно imdb/amazon → 404), поэтому
// возвращаем всю цепочку — _nzApplyPoster перебирает её при ошибке загрузки.
function _nzPosterList() {
  const m = (_movieRaw && _movieRaw.media) || {}
  const order = _nzLang === 'en'
    ? [m.poster_imdb, m.poster_tmdb, m.poster_kp, m.backdrop_url]
    : [m.poster_kp, m.poster_tmdb, m.poster_imdb, m.backdrop_url]
  return order.filter(Boolean).map(posterUrl)
}

// Меняет постер карточки и фон под выбранный язык (вызывается из _nzApply).
// Перебирает источники: если постер 404/не загрузился — пробует следующий,
// в конце — плейсхолдер. Фон и ссылка обновляются по реально загрузившемуся.
function _nzApplyPoster() {
  const list = _nzPosterList()
  if (!list.length) return
  const img = document.querySelector('.movie-poster')
  if (!img) return
  const link = document.querySelector('.movie-poster-side')
  const bgEl = document.getElementById('bg-poster')

  let i = 0
  const showBg = src => {
    if (link) link.href = src
    if (bgEl) {
      bgEl.style.backgroundImage = `url("${src}")`
      try { localStorage.setItem('nz_bg_poster', src) } catch {}
    }
  }
  img.onload = () => { img.classList.add('loaded'); showBg(img.src) }
  img.onerror = () => {
    i++
    if (i < list.length) { img.src = list[i] }            // следующий источник
    else { img.onerror = null; img.classList.add('loaded'); img.src = posterUrl('') } // плейсхолдер
  }

  if (img.getAttribute('src') !== list[0]) {
    img.classList.remove('loaded')
    img.src = list[0]
  } else if (img.complete && img.naturalWidth === 0) {
    img.onerror()                                          // текущий уже сломан — перебираем
  } else if (img.complete) {
    showBg(img.src)                                        // уже загружен — обновим фон/ссылку
  }
}

function _nzDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString(_nzLang === 'en' ? 'en-US' : 'ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  } catch { return String(iso) }
}

function _nzAwards(aw) {
  if (!aw) return ''
  const en = _nzLang === 'en'
  const parts = []
  if (aw.oscars_won)      parts.push(en ? `${aw.oscars_won} Oscars`            : `${aw.oscars_won} «Оскар»`)
  if (aw.awards_won)      parts.push(en ? `${aw.awards_won} wins`              : `${aw.awards_won} побед`)
  if (aw.awards_nominated)parts.push(en ? `${aw.awards_nominated} nominations` : `${aw.awards_nominated} номинаций`)
  return parts.length ? parts.join(' · ') : (aw.awards_text || '')
}

function enrichMovie(raw) {
  if (!raw || !raw.ids) return
  _movieRaw = raw
  _descExpanded = false

  const header = document.querySelector('.content-header')
  if (header && !header.querySelector('.nz-lang')) {
    const toggle = document.createElement('div')
    toggle.className = 'nz-lang'
    toggle.innerHTML = `<button data-l="ru">RU</button><button data-l="en">EN</button>`
    header.appendChild(toggle)
    toggle.addEventListener('click', e => {
      const b = e.target.closest('button')
      if (!b) return
      _nzLang = b.dataset.l
      try { localStorage.setItem('nz_lang', _nzLang) } catch {}
      _nzApply()
    })
  }
  _nzApply()
}

function _nzApply() {
  if (!_movieRaw) return
  document.querySelectorAll('.nz-lang button').forEach(b => b.classList.toggle('on', b.dataset.l === _nzLang))
  const t = _movieRaw.title || {}
  const titleEl = document.querySelector('.content-title')
  if (titleEl) titleEl.textContent = _nzPick(t.title_ru, t.title_en) || t.title_original || 'Без названия'
  _nzApplyPoster()
  _nzRenderInfo()
  _nzRenderCritics()
  _nzRenderDescription()
  _nzApplyCast()
  try { document.documentElement.lang = _nzLang } catch {}
}

function _nzRenderInfo() {
  const list = document.querySelector('.info-list')
  if (!list) return
  const raw = _movieRaw, L = NZ_UI[_nzLang]
  const t = raw.title || {}, rel = raw.release || {}, syn = raw.synopsis || {}
  const cls = raw.classification || {}, fin = raw.finance || {}
  const titleNow = _nzPick(t.title_ru, t.title_en)
  const rows = []
  if (t.title_original && t.title_original !== titleNow) rows.push([L.orig, t.title_original])
  if (rel.year) rows.push([L.year, rel.year])
  const countries = (raw.countries || []).map(c => _nzPick(c.name_ru, c.name_en)).filter(Boolean)
  if (countries.length) rows.push([L.country, countries.join(', ')])
  const genres = (raw.genres || []).map(g => _nzPick(g.name_ru, g.name_en)).filter(Boolean)
  if (genres.length) rows.push([L.genres, genres.join(', ')])
  if (rel.runtime) rows.push([L.runtime, rel.runtime + ' ' + L.min])
  const tagline = _nzPick(syn.tagline_ru, syn.tagline_en)
  if (tagline) rows.push([L.tagline, '«' + tagline + '»'])
  if (fin.budget) rows.push([L.budget, _nzMoney(fin.budget)])
  const box = fin.box_office || fin.revenue
  if (box) rows.push([L.box, _nzMoney(box)])
  const awards = _nzAwards(raw.awards)
  if (awards) rows.push([L.awards, awards])
  // Студии больше не в info-блоке: рендерятся карточками в #platforms-section (loadPlatforms)
  const prem = rel.premiere_ru || rel.premiere_world || rel.release_date
  if (prem) rows.push([L.premiere, _nzDate(prem)])

  let html = rows.map(([k, v]) => `<li><strong>${escapeHtml(k)}:</strong> ${escapeHtml(String(v))}</li>`).join('')
  const age = cls.age_limit
  if (age != null && age !== 0) html += `<li class="rating-boxes"><div class="rating-box age"><strong>${formatAge('age' + age)}</strong></div></li>`
  list.innerHTML = html
}

function _nzRenderCritics() {
  const ratings = document.querySelector('.ratings-links')
  if (!ratings) return
  const r = _movieRaw.ratings || {}, L = NZ_UI[_nzLang]
  const parts = []
  if (r.rating_rt != null)         parts.push(`<span>Rotten Tomatoes <b>${r.rating_rt}%</b></span>`)
  if (r.rating_metacritic != null) parts.push(`<span>Metacritic <b>${r.rating_metacritic}</b></span>`)
  if (r.rating_critics != null)    parts.push(`<span>${L.critics} <b>${Number(r.rating_critics).toFixed(1)}</b></span>`)
  let el = document.querySelector('.nz-critics')
  if (!parts.length) { if (el) el.remove(); return }
  if (!el) { el = document.createElement('div'); el.className = 'nz-critics'; ratings.insertAdjacentElement('afterend', el) }
  el.innerHTML = parts.join('')
}

function _nzHasFacts() {
  return _nzLang === 'ru' && _movieFacts.some(f => f.kind === 'fact' || f.kind === 'blooper')
}

function _nzFactsHtml() {
  if (_nzLang !== 'ru') return '' // факты/киноляпы только на русском
  const L = NZ_UI[_nzLang]
  const trivia   = _movieFacts.filter(f => f.kind === 'fact')
  const bloopers = _movieFacts.filter(f => f.kind === 'blooper')
  const section = (title, headIcon, cls, items, listIcon) => {
    if (!items.length) return ''
    const li = items.map(it => {
      const sc = it.is_spoiler ? ' nz-spoiler' : ''
      const tip = it.is_spoiler ? ` title="${L.spoilerTip}"` : ''
      return `<li><i class="ph ${listIcon}"></i><span class="nz-itext${sc}"${tip}>${escapeHtml(it.text)}</span></li>`
    }).join('')
    return `<section class="nz-extra"><div class="nz-extra-head ${cls}"><i class="${headIcon}"></i>` +
      `<h3 class="nz-extra-title">${title}</h3></div><ul class="nz-list ${cls}">${li}</ul></section>`
  }
  return section(L.trivia, 'ph-fill ph-lightbulb', 'trivia', trivia, 'ph-lightbulb') +
         section(L.bloopers, 'ph-fill ph-warning', 'bloop', bloopers, 'ph-warning-circle')
}

function _nzRenderDescription() {
  const main = document.querySelector('.movie-layout-main')
  if (!main) return
  const syn = _movieRaw.synopsis || {}
  const full  = _nzPick(syn.overview_ru, syn.overview_en_tmdb || syn.overview_en_imdb || syn.overview_alter)
  const short = _nzLang === 'ru' ? (syn.short_overview_ru || '') : ''
  if (!full && !short) { main.querySelector('.content-info')?.remove(); return }

  let info = main.querySelector('.content-info')
  if (!info) { info = document.createElement('div'); info.className = 'content-info'; main.appendChild(info) }

  const collapsed = short || full
  const expanded  = full || short
  const hasToggle = (full && short && full !== short) || _nzHasFacts()

  info.innerHTML = `<p class="content-description-text" id="nz-desc"></p><div id="nz-extended" style="display:none">${_nzFactsHtml()}</div>`
  const descP = info.querySelector('#nz-desc')
  const ext = info.querySelector('#nz-extended')
  ext.addEventListener('click', e => {
    const sp = e.target.closest('.nz-spoiler')
    if (sp) sp.classList.add('revealed')
  })

  let toggle = null
  if (hasToggle) {
    toggle = document.createElement('button')
    toggle.className = 'nz-desc-toggle'
    toggle.innerHTML = `<span></span><i class="ph ph-caret-down"></i>`
    info.appendChild(toggle)
    toggle.addEventListener('click', () => _nzToggleDesc(descP, ext, toggle, collapsed, expanded))
  }
  _nzPaintDesc(descP, ext, toggle, collapsed, expanded)
}

// Раскрытие «Подробнее»: факты грузятся ЛЕНИВО при первом раскрытии (RU) —
// это самый медленный холодный запрос (~1.6с), и большинству он не нужен.
async function _nzToggleDesc(descP, ext, toggle, collapsed, expanded) {
  _descExpanded = !_descExpanded
  if (_descExpanded && !_factsLoaded && _nzLang === 'ru') {
    _factsLoaded = true
    try {
      const r = await fetch(`${API_BASE}/api/facts/${movieId}`)
      if (r.ok) _movieFacts = (await r.json()).items || []
    } catch {}
    if (_movieFacts.length) { _nzRenderDescription(); return } // перестроит с фактами, _descExpanded сохранится
  }
  _nzPaintDesc(descP, ext, toggle, collapsed, expanded)
}

function _nzPaintDesc(descP, ext, toggle, collapsed, expanded) {
  const L = NZ_UI[_nzLang]
  if (descP) descP.textContent = _descExpanded ? expanded : collapsed
  if (ext) {
    ext.style.display = _descExpanded ? '' : 'none'
    ext.querySelectorAll('.nz-extra').forEach(s => { s.style.display = _nzLang === 'ru' ? '' : 'none' })
  }
  if (toggle) {
    toggle.classList.toggle('open', _descExpanded)
    toggle.querySelector('span').textContent = _descExpanded ? L.less : L.more
  }
}

function _nzApplyCast() {
  document.querySelectorAll('#cast-section .cast-name, #cast-section .cast-card-name').forEach(el => {
    const ru = el.dataset.ru
    if (ru == null) return
    const en = el.dataset.en
    const target = (_nzLang === 'en' && en) ? en : ru
    if (el.textContent !== target) el.textContent = target
  })
  // в EN режиме английский подзаголовок дублирует имя — прячем
  document.querySelectorAll('#cast-section .cast-card-name-en').forEach(el => {
    el.style.display = _nzLang === 'en' ? 'none' : ''
  })
}

async function loadMovie() {
  if (!movieId) {
    renderError('ID фильма не указан')
    return
  }

  try {
    const preview = JSON.parse(sessionStorage.getItem('moviePreview') || 'null')
    if (preview && String(preview.kinopoiskId || preview.filmId) === movieId) {
      renderMovie(preview)
      sessionStorage.removeItem('moviePreview')
    }
  } catch {}

  // Запускаем вторичные запросы немедленно, параллельно с основным.
  // Каст, похожие и франшиза НЕ запрашиваются отдельно — они встроены в ответ
  // /api/movie (include=cast,similar,franchise), это экономит холодные upstream-запросы.
  const playersRes  = fetchWithRetry(`${API_BASE}/api/players/${movieId}`)
  // Предотвращаем unhandled rejection если основной запрос упадёт раньше
  playersRes.catch(() => {})

  try {
    const r = await fetchWithRetry(`${API_BASE}/api/movie/${movieId}`)
    if (!r.ok) throw new Error('Фильм не найден')
    const raw = await r.json()
    const movie = normalizeMovie(raw)
    renderMovie(movie)
    enrichMovie(raw) // полная инфа + языковой тумблер (поверх renderMovie)
    initRatingWidget(movie)
    initFavorite(movie.kinopoiskId || movie.filmId)
    // DOM готов — рендерим всё остальное без ожидания
    refreshNzRating()
    initComments(movie)
    loadStaff(raw.cast)         // {cast:[...]} встроен в /api/movie
    loadPlatforms(raw)          // платформы (networks) → кликабельные синие карточки
    loadSequels(raw.franchise)  // {items} встроен в /api/movie (include=franchise)
    loadSimilars(raw.similar)   // {items,relation} встроен в /api/movie
    loadPlayers(playersRes, movie.kinopoiskId || movie.filmId)
  } catch (e) {
    if (!document.getElementById('movieContent').children.length) {
      renderError(e.message || 'Ошибка загрузки фильма')
    }
  }
}

loadMovie()
