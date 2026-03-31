const movieId = new URLSearchParams(window.location.search).get('id')

const sidebar = document.getElementById('sidebar')
const toggleBtn = document.getElementById('toggleBtn')
const toggleIcon = document.getElementById('toggleIcon')

toggleBtn.addEventListener('click', () => {
  const isOpen = sidebar.classList.toggle('open')
  toggleIcon.className = isOpen ? 'fas fa-chevron-left' : 'fas fa-chevron-right'
})

function displayType(type) {
  switch (type) {
    case 'TV_SERIES':
    case 'MINI_SERIES': return 'Сериал'
    case 'TV_SHOW': return 'Шоу'
    default: return 'Фильм'
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

function backBtn() {
  return `<a href="/" class="back-btn" onclick="if(document.referrer&&new URL(document.referrer).origin===location.origin){event.preventDefault();history.back()}">
    <i class="fas fa-arrow-left"></i>
    <span>Назад</span>
  </a>`
}

const PLAYERS = [
  { name: 'Vibix',          vibix: true },
  { name: 'VideoSeed',      url: (r, id) => `https://tv-2-kinoserial.net/embed_auto/${id}/?token=dbe140b3c3f68769a13ee6e953f7ce96`, useLoad: true },
  { name: 'VideoBalanser',  asyncUrl: (r, id) => `${API_BASE}/api/player/videobalanser/${id}`, kpOnly: true, useLoad: true },
  { name: 'FlixCDN',        url: (r, id) => `//player0.flixcdn.space/show/${r}/${id}?no_sharing=1` },
]

function togglePlayerDropdown() {
  const dd = document.getElementById('playerDropdown')
  const chevron = document.getElementById('playerDropdownChevron')
  const open = dd.classList.toggle('open')
  chevron.style.transform = open ? 'rotate(180deg)' : ''
}

let _playerGen = 0

function playerSetState(state, gen) {
  if (gen !== undefined && gen !== _playerGen) return
  const wrapper = document.querySelector('.player-wrapper')
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
  const player = PLAYERS.find(p => p.name === name)
}

function playerError() { playerSetState('error') }

function selectVibixPlayer(type, id) {
  const gen = ++_playerGen
  const wrapper = document.querySelector('.player-wrapper')
  wrapper.classList.remove('vibix')
  document.getElementById('vibix-slot').innerHTML = ''
  wrapper.classList.add('vibix')
  playerSetState('loading', gen)

  const slot = document.getElementById('vibix-slot')
  slot.innerHTML = `<ins data-publisher-id="677393820"
    data-type="${type}"
    data-id="${id}"
    data-design="2"
    data-color1="#333333"
    data-color2="#666666"
    data-color3="#999999"
    data-color4="#CCCCCC"
    data-color5="#FFFFFF"></ins>`

  const old = document.getElementById('rendex-sdk')
  if (old) old.remove()
  const script = document.createElement('script')
  script.id = 'rendex-sdk'
  script.src = 'https://graphicslab.io/sdk/v2/rendex-sdk.min.js'
  script.onload = () => {
    if (gen !== _playerGen) return
    const existing = slot.querySelector('iframe')
    if (existing) { waitForLoad(existing); return }
    const noIframeTimer = setTimeout(() => { observer.disconnect(); playerSetState('error', gen) }, 5000)
    const observer = new MutationObserver(() => {
      const iframe = slot.querySelector('iframe')
      if (iframe) { observer.disconnect(); clearTimeout(noIframeTimer); waitForLoad(iframe) }
    })
    observer.observe(slot, { childList: true, subtree: true })
  }
  script.onerror = () => playerSetState('error', gen)

  function waitForLoad(iframe) {
    const timer = setTimeout(() => playerSetState('error', gen), 8000)
    iframe.addEventListener('load', () => { clearTimeout(timer); playerSetState('ready', gen) }, { once: true })
  }
  document.head.appendChild(script)

  playerUpdateUI('Vibix')
}

async function selectPlayer(name, src) {
  const gen = ++_playerGen
  const frame = document.getElementById('flixcdn')
  const wrapper = frame.closest('.player-wrapper')
  wrapper.classList.remove('vibix')
  document.getElementById('vibix-slot').innerHTML = ''
  playerSetState('loading', gen)
  playerUpdateUI(name)

  const player = PLAYERS.find(p => p.name === name)

  if (player?.asyncUrl) {
    try {
      const r = await fetch(player.asyncUrl('kinopoisk', src))
      if (!r.ok) throw new Error('status ' + r.status)
      const data = await r.json()
      if (gen !== _playerGen) return
      frame.src = data.src
    } catch {
      playerSetState('error', gen)
      return
    }
  } else {
    frame.src = src
  }

  if (player?.useLoad) {
    const done = success => {
      clearTimeout(timer)
      playerSetState(success ? 'ready' : 'error', gen)
    }
    const timer = setTimeout(() => done(false), 5000)
    frame.addEventListener('load', () => done(true), { once: true })
  } else {
    if (typeof window.khS !== 'undefined') window.khS = false
    if (typeof khCL === 'function') { window.khF = frame; setTimeout(khCL, 0) }

    const done = success => {
      clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      playerSetState(success ? 'ready' : 'error', gen)
    }
    const onMessage = e => { if (e.data === 'khL') done(true) }
    const timer = setTimeout(() => done(false), 3000)
    window.addEventListener('message', onMessage)
  }
}

document.addEventListener('click', e => {
  const wrap = document.getElementById('playerSelectWrap')
  if (wrap && !wrap.contains(e.target)) {
    document.getElementById('playerDropdown')?.classList.remove('open')
    document.getElementById('playerDropdownChevron').style.transform = ''
  }
})

function playerSectionHtml(movie) {
  let resource, id
  if (movie.kinopoiskId) {
    resource = 'kinopoisk'
    id = movie.kinopoiskId
  } else if (movie.imdbId) {
    resource = 'imdb'
    id = movie.imdbId
  } else {
    return ''
  }

  const vType = resource === 'kinopoisk' ? 'kp' : 'imdb'
  const options = PLAYERS
    .filter(p => !p.kpOnly || resource === 'kinopoisk')
    .map(p => {
      let onclick
      if (p.vibix) {
        onclick = `selectVibixPlayer('${vType}','${id}')`
      } else if (p.asyncUrl) {
        onclick = `selectPlayer('${p.name}','${id}')`
      } else {
        onclick = `selectPlayer('${p.name}','${p.url(resource, id)}')`
      }
      return `<div class="player-option" data-name="${p.name}" onclick="${onclick}">${p.name}</div>`
    }).join('')

  return `<details class="player-section">
    <summary class="player-summary">
      <i class="fas fa-play-circle"></i>
      <span>Смотреть онлайн</span>
      <i class="fas fa-chevron-down player-chevron"></i>
    </summary>
    <div class="player-select-wrap" id="playerSelectWrap">
      <button class="player-select-trigger" onclick="togglePlayerDropdown()">
        <span id="playerSelectedName">Выберите плеер</span>
        <i class="fas fa-chevron-down" id="playerDropdownChevron"></i>
      </button>
      <div class="player-dropdown" id="playerDropdown">${options}</div>
    </div>
    <div class="player-wrapper">
      <iframe id="flixcdn" frameborder="0" allowfullscreen></iframe>
      <div id="vibix-slot" class="vibix-slot"></div>
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


function initPlayerLazyLoad(resource, id) {
  const details = document.querySelector('.player-section')
  if (!details) return
  details.addEventListener('toggle', () => {
    if (!details.open) return
    const available = PLAYERS.filter(p => !p.kpOnly || resource === 'kinopoisk')
    const first = available[0]
    if (!first) return
    if (first.vibix) {
      const vType = resource === 'kinopoisk' ? 'kp' : 'imdb'
      selectVibixPlayer(vType, id)
    } else if (first.asyncUrl) {
      selectPlayer(first.name, id)
    } else {
      selectPlayer(first.name, first.url(resource, id))
    }
  }, { once: true })
}

function renderMovie(movie) {
  historyAdd(movie)
  const title = movie.nameRu || movie.nameEn || 'Без названия'
  document.title = title + ' — NaZeleniy'

  const bgEl = document.getElementById('bg-poster')
  const bgUrl = posterUrl(movie.posterUrlPreview || movie.posterUrl)
  if (bgEl && bgUrl) bgEl.style.backgroundImage = `url(${bgUrl})`

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
    ratingsHtml += `
      <div class="rating-container">
        <a class="rating-link" href="#" title="Оценок: ${movie.ratingImdbVoteCount || 0}">
          <img src="/img/logo/logo_imdb.svg" alt="IMDb" class="rating-logo-img"/>
          <span class="${ratingClass(movie.ratingImdb)}">${movie.ratingImdb.toFixed(1)}</span>
        </a>
      </div>`
  }

  const rows = []
  if (movie.type)                                                      rows.push(['Тип', displayType(movie.type)])
  if (movie.year > 0)                                                  rows.push(['Год выпуска', movie.year])
  if (movie.nameRu)                                                    rows.push(['Название', movie.nameRu])
  if (movie.nameEn)                                                    rows.push(['Оригинальное название', movie.nameEn])
  if (movie.countries?.length)                                         rows.push(['Страна производства', joinList(movie.countries, 'country')])
  if (movie.genres?.length)                                            rows.push(['Жанры', joinList(movie.genres, 'genre')])
  if (movie.filmLength > 0)                                            rows.push(['Длительность', movie.filmLength + ' мин'])
  if (movie.slogan && movie.slogan !== '-' && movie.slogan !== 'null') rows.push(['Слоган', '«' + movie.slogan + '»'])

  const infoRowsHtml = rows.map(([k, v]) => `<li><strong>${k}:</strong> ${v}</li>`).join('\n')

  const ageHtml = (movie.ratingAgeLimits && movie.ratingAgeLimits !== 'age0')
    ? `<li class="rating-boxes"><div class="rating-box age"><strong>${formatAge(movie.ratingAgeLimits)}</strong></div></li>`
    : ''

  const posterSrc = posterUrl(movie.posterUrlPreview || movie.posterUrl)
  const posterFull = posterUrl(movie.posterUrl || movie.posterUrlPreview)
  const posterHtml = posterSrc
    ? `<div class="movie-poster-container desktop-only">
         <a href="${posterFull}" target="_blank" rel="noopener noreferrer">
           <img class="movie-poster" src="${posterSrc}" alt="${title}"
                onerror="if(this.src!=='${posterFull}')this.src='${posterFull}'"/>
         </a>
       </div>`
    : ''

  const desc = movie.description || movie.shortDescription || ''
  const descHtml = desc
    ? `<div class="content-info"><p class="content-description-text">${desc}</p></div>`
    : ''

  document.getElementById('movieContent').innerHTML = `
    ${backBtn()}
    <div class="content-header">
      <h1 class="content-title">${title}</h1>
    </div>
    <div class="ratings-links">${ratingsHtml}</div>
    <div class="additional-info">
      <h2 class="additional-info-title">Подробнее</h2>
      <div class="info-content">
        ${posterHtml}
        <div class="details-container">
          <ul class="info-list">
            ${infoRowsHtml}
            ${ageHtml}
          </ul>
          ${descHtml}
        </div>
      </div>
    </div>
    ${playerSectionHtml(movie)}
  `
  const { resource, id } = (() => {
    if (movie.kinopoiskId) return { resource: 'kinopoisk', id: movie.kinopoiskId }
    if (movie.imdbId) return { resource: 'imdb', id: movie.imdbId }
    return {}
  })()
  if (id) initPlayerLazyLoad(resource, id)
}

function renderError(message) {
  document.getElementById('movieContent').innerHTML = `
    ${backBtn()}
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

  try {
    const r = await fetch(`${API_BASE}/api/movie/${movieId}`)
    if (!r.ok) throw new Error('Фильм не найден')
    renderMovie(await r.json())
  } catch (e) {
    if (!document.getElementById('movieContent').children.length) {
      renderError(e.message || 'Ошибка загрузки фильма')
    }
  }
}

loadMovie()
