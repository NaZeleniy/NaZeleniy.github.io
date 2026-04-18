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
let _commentsOffset = 0
let _hasMoreComments = false
let _nzCloseHandler = null

function playerSetState(state, gen) {
  if (gen !== undefined && gen !== _playerGen) return
  const wrapper = document.querySelector('.player-wrapper')
  if (!wrapper) return
  wrapper.classList.remove('loading', 'ready', 'error')
  if (state) wrapper.classList.add(state)
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
    const onLoad = () => {
      frame.removeEventListener('load', onLoad)
      playerSetState('ready', gen)
    }
    frame.addEventListener('load', onLoad)
    frame.srcdoc = vibixSrcdoc(url, h)
    _playerCleanup = () => frame.removeEventListener('load', onLoad)
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
    const timer = setTimeout(() => done(false), 3000)
    window.addEventListener('message', onMsg)
    _playerCleanup = () => { clearTimeout(timer); window.removeEventListener('message', onMsg); window.khF = null }
  } else {
    let attempts = 0
    const maxAttempts = 6
    const onLoad = () => {
      clearInterval(interval)
      frame.removeEventListener('load', onLoad)
      playerSetState('ready', gen)
    }
    const interval = setInterval(() => {
      if (++attempts >= maxAttempts) {
        clearInterval(interval)
        frame.removeEventListener('load', onLoad)
        playerSetState('error', gen)
        return
      }
      frame.src = frame.src
    }, 5000)
    frame.addEventListener('load', onLoad)
    _playerCleanup = () => {
      clearInterval(interval)
      frame.removeEventListener('load', onLoad)
    }
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
  const id = movie.kinopoiskId || movie.imdbId
  if (!id || !movie.players?.length) return ''

  const hasParty = (movie.players || []).some(p => p.name === 'Vibix' || p.name === 'Turbo')
  const partyBtn = hasParty ? `
      <a class="watch-party-btn" href="/party?id=${id}" target="_blank" title="Совместный просмотр">
        <i class="fas fa-users"></i>
        <span>Смотреть вместе</span>
      </a>` : ''

  return `${localStorage.getItem('nz_hide_coming_soon') ? '' : `<div class="player-coming-soon" id="player-coming-soon">
    <i class="fas fa-info-circle"></i>
    <span>Планируется добавление новых плееров в будущем</span>
    <button class="player-coming-soon-close" onclick="localStorage.setItem('nz_hide_coming_soon','1');document.getElementById('player-coming-soon').remove()" title="Закрыть"><i class="fas fa-times"></i></button>
  </div>`}
  <details class="player-section">
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
      ${partyBtn}
    </div>
    <div class="player-wrapper">
      <iframe id="player-frame" frameborder="0" allow="autoplay; fullscreen"></iframe>
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

  _players = players
  preconnectPlayerDomains(players)

  const dropdown = document.getElementById('playerDropdown')
  dropdown.innerHTML = ''
  players.forEach(p => {
    const opt = document.createElement('div')
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

  details.addEventListener('toggle', () => {
    if (!details.open) return
    startFirstPlayer()
  }, { once: true })
}

function renderMovie(movie) {
  // Сброс состояния плеера при каждом перерендере (preview → full data)
  if (_playerCleanup) { _playerCleanup(); _playerCleanup = null }
  _playerGen = 0

  historyAdd(movie)
  const title = movie.nameRu || movie.nameEn || 'Без названия'
  document.title = title + ' — NaZeleniy'

  const descMeta = (movie.description || movie.shortDescription || '').slice(0, 200)
  const ogImage = posterUrl(movie.posterUrl || movie.posterUrlPreview)
  const ogUrl = 'https://nazeleniy.github.io/movie/' + (movie.kinopoiskId || movie.filmId || '')
  document.querySelector('meta[name="description"]')?.setAttribute('content', descMeta)
  document.querySelector('meta[property="og:title"]')?.setAttribute('content', title)
  document.querySelector('meta[property="og:description"]')?.setAttribute('content', descMeta)
  document.querySelector('meta[property="og:image"]')?.setAttribute('content', ogImage)
  document.querySelector('meta[property="og:url"]')?.setAttribute('content', ogUrl)

  const bgEl = document.getElementById('bg-poster')
  const bgUrl = posterUrl(movie.posterUrlPreview || movie.posterUrl)
  if (bgEl && bgUrl) {
    bgEl.style.backgroundImage = `url(${bgUrl})`
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

  document.getElementById('movieContent').innerHTML = `
    <button class="mob-back-btn" onclick="history.back()">
      <i class="fas fa-chevron-left"></i> Назад
    </button>
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
        ${descHtml}
      </div>
    </div>
    ${playerSectionHtml(movie)}
    <div id="sequels-section"></div>
    <div id="similars-section"></div>
    <div id="comments-section"></div>
  `
  if (movie.kinopoiskId || movie.imdbId) initPlayerLazyLoad(movie.players || [])
}

async function loadStaff(res) {
  const section = document.getElementById('cast-section')
  if (!section || !movieId) return
  try {
    const r = res ? await res : await fetch(`${API_BASE}/api/staff/${movieId}`)
    if (!r.ok) return
    const staff = await r.json()

    const directors = staff.filter(p => p.professionKey === 'DIRECTOR').slice(0, 4)
    const actors    = staff.filter(p => p.professionKey === 'ACTOR').slice(0, 10)
    if (!directors.length && !actors.length) return

    const renderPerson = p => {
      const name  = p.nameRu || p.nameEn || ''
      const role  = p.description || ''
      const photo = p.posterUrl || ''
      return `
        <div class="cast-item" data-staff-id="${p.staffId}">
          <div class="cast-name-wrap">
            <span class="cast-name">${name}</span>
          </div>
          <div class="cast-card">
            ${photo ? `<img class="cast-card-photo" src="${photo}" alt="${name}" loading="lazy" onerror="this.style.display='none'"/>` : ''}
            <div class="cast-card-body">
              <div class="cast-card-name">${name}</div>
              ${p.nameEn && p.nameEn !== name ? `<div class="cast-card-name-en">${p.nameEn}</div>` : ''}
              <div class="cast-card-extra"></div>
            </div>
          </div>
        </div>`
    }

    let html = '<div class="cast-section">'
    if (directors.length) html += `
      <div class="cast-group">
        <div class="cast-group-title">Режиссёр${directors.length > 1 ? 'ы' : ''}</div>
        <div class="cast-list">${directors.map(renderPerson).join('')}</div>
      </div>`
    if (actors.length) html += `
      <div class="cast-group">
        <div class="cast-group-title">В ролях</div>
        <div class="cast-list">${actors.map(renderPerson).join('')}</div>
      </div>`
    html += '</div>'
    section.innerHTML = html

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
          const d = await r.json()
          let metaHtml = ''
          if (d.birthday) {
            const [y, m, day] = d.birthday.split('-')
            const age = d.age ? ` (${d.age})` : ''
            metaHtml += `<div class="cast-card-meta">${day}.${m}.${y}${age}</div>`
          }
          if (d.birthplace) {
            metaHtml += `<div class="cast-card-meta cast-card-birthplace">${d.birthplace}</div>`
          }
          extra.innerHTML = metaHtml
        } catch {
          extra.innerHTML = ''
        }
      }, { once: true })
    })
  } catch {}
}

async function loadSequels(res) {
  const section = document.getElementById('sequels-section')
  if (!section || !movieId) return
  try {
    const r = res ? await res : await fetch(`${API_BASE}/api/sequels/${movieId}`)
    if (!r.ok) { section.innerHTML = ''; return }
    const items = await r.json()
    if (!items?.length) { section.innerHTML = ''; return }

    const typeLabel = { SEQUEL: 'Сиквел', PREQUEL: 'Приквел', REMAKE: 'Ремейк' }

    const cards = items.map(m => {
      const id    = m.filmId
      const name  = m.nameRu || m.nameEn || m.nameOriginal || 'Без названия'
      const thumb = posterUrl(m.posterUrlPreview || m.posterUrl)
      const meta  = typeLabel[m.relationType] || m.relationType || ''
      const preview = JSON.stringify({ filmId: id, nameRu: m.nameRu, nameEn: m.nameEn, posterUrl: m.posterUrl, posterUrlPreview: m.posterUrlPreview, year: m.year }).replace(/'/g, '&#39;')
      return `
        <a class="similar-card" href="/movie/${id}" onclick="sessionStorage.setItem('moviePreview','${preview}')">
          <div class="similar-poster-wrap">
            <img src="${thumb}" alt="${name}" loading="lazy" onerror="this.src='/img/placeholder.svg'"/>
          </div>
          <div class="similar-info">
            <div class="similar-title">${name}</div>
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

async function loadSimilars(res) {
  const section = document.getElementById('similars-section')
  if (!section || !movieId) return
  section.innerHTML = `<div class="similars-loading"><i class="fas fa-circle-notch fa-spin"></i></div>`
  try {
    const r = res ? await res : await fetch(`${API_BASE}/api/similars/${movieId}`)
    if (!r.ok) { section.innerHTML = ''; return }
    const items = await r.json()
    if (!items?.length) { section.innerHTML = ''; return }

    const cards = items.map(m => {
      const id    = m.filmId
      const name  = m.nameRu || m.nameEn || m.nameOriginal || 'Без названия'
      const thumb = posterUrl(m.posterUrlPreview || m.posterUrl)
      const meta  = [m.year, m.nameEn && m.nameEn !== m.nameRu ? m.nameEn : null].filter(Boolean).join(' · ')
      const preview = JSON.stringify({ filmId: id, nameRu: m.nameRu, nameEn: m.nameEn, posterUrl: m.posterUrl, posterUrlPreview: m.posterUrlPreview, year: m.year }).replace(/'/g, '&#39;')
      return `
        <a class="similar-card" href="/movie/${id}" onclick="sessionStorage.setItem('moviePreview','${preview}')">
          <div class="similar-poster-wrap">
            <img src="${thumb}" alt="${name}" loading="lazy" onerror="this.src='/img/placeholder.svg'"/>
          </div>
          <div class="similar-info">
            <div class="similar-title">${name}</div>
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
  let cached = null
  try { const r = localStorage.getItem('nz_me'); if (r) cached = JSON.parse(r) } catch {}
  if (!window._nzUser && !cached) {
    _isFavorited = false
    renderFavoriteBtn()
    return
  }
  _isFavorited = await getFavoriteStatus(kpId)
  renderFavoriteBtn()
}

async function getFavoriteStatus(kpId) {
  try {
    const r = await fetch(`${API_BASE}/api/favorites/${kpId}`, {
      credentials: _CREDS,
      headers: _bearerHeader(),
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

async function toggleFavorite() {
  if (!window._nzUser) {
    openAuthModal(() => toggleFavorite())
    return
  }
  const kpId = _currentKpId
  if (!kpId) return
  if (_isFavorited) {
    try {
      const r = await fetch(`${API_BASE}/api/favorites/${kpId}`, {
        method: 'DELETE',
        credentials: _CREDS,
        headers: _bearerHeader(),
      })
      if (r.ok || r.status === 404) {
        _isFavorited = false
        renderFavoriteBtn()
      }
    } catch {}
  } else {
    try {
      const r = await fetch(`${API_BASE}/api/favorites/${kpId}`, {
        method: 'POST',
        credentials: _CREDS,
        headers: _bearerHeader(),
      })
      if (r.status === 401) { showAuthRequiredToast(); return }
      if (r.ok) {
        _isFavorited = true
        renderFavoriteBtn()
      }
    } catch {}
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

  // Запускаем вторичные запросы немедленно, параллельно с основным
  const staffRes    = fetchWithRetry(`${API_BASE}/api/staff/${movieId}`)
  const sequelsRes  = fetchWithRetry(`${API_BASE}/api/sequels/${movieId}`)
  const similarsRes = fetchWithRetry(`${API_BASE}/api/similars/${movieId}`)
  // Предотвращаем unhandled rejection если основной запрос упадёт раньше
  staffRes.catch(() => {})
  sequelsRes.catch(() => {})
  similarsRes.catch(() => {})

  try {
    const r = await fetchWithRetry(`${API_BASE}/api/movie/${movieId}`)
    if (!r.ok) throw new Error('Фильм не найден')
    const movie = await r.json()
    renderMovie(movie)
    initRatingWidget(movie)
    initFavorite(movie.kinopoiskId || movie.filmId)
    // DOM готов — рендерим всё остальное без ожидания
    refreshNzRating()
    initComments(movie)
    loadStaff(staffRes)
    loadSequels(sequelsRes)
    loadSimilars(similarsRes)
  } catch (e) {
    if (!document.getElementById('movieContent').children.length) {
      renderError(e.message || 'Ошибка загрузки фильма')
    }
  }
}

loadMovie()
