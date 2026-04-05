const movieId = new URLSearchParams(window.location.search).get('id')

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
}

function selectPlayer(name, url, type) {
  const gen = ++_playerGen
  const frame = document.getElementById('player-frame')
  playerSetState('loading', gen)
  playerUpdateUI(name)

  if (type === 'vibix') {
    const h = Math.round(document.querySelector('.player-wrapper').offsetHeight)
    frame.srcdoc = vibixSrcdoc(url, h)
    const onLoad = () => {
      frame.removeEventListener('load', onLoad)
      playerSetState('ready', gen)
    }
    frame.addEventListener('load', onLoad)
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
      <a class="watch-party-btn" href="party.html?id=${id}" target="_blank" title="Совместный просмотр">
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
      <iframe id="player-frame" frameborder="0" allowfullscreen></iframe>
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

function initPlayerLazyLoad(players) {
  const details = document.querySelector('.player-section')
  if (!details) return

  if (!players.length) {
    document.getElementById('playerSelectedName').textContent = 'Нет плееров'
    playerSetState('error')
    return
  }

  const dropdown = document.getElementById('playerDropdown')
  dropdown.innerHTML = players.map(p =>
    `<div class="player-option" data-name="${p.name}"
      onclick="selectPlayer('${p.name}','${p.url}','${p.type}')">${p.name}</div>`
  ).join('')

  details.addEventListener('toggle', () => {
    if (!details.open) return
    selectPlayer(players[0].name, players[0].url, players[0].type)
  }, { once: true })
}

function renderMovie(movie) {
  historyAdd(movie)
  const title = movie.nameRu || movie.nameEn || 'Без названия'
  document.title = title + ' — NaZeleniy'

  const descMeta = (movie.description || movie.shortDescription || '').slice(0, 200)
  const ogImage = posterUrl(movie.posterUrl || movie.posterUrlPreview)
  const ogUrl = 'https://nazeleniy.github.io/movie.html?id=' + (movie.kinopoiskId || movie.filmId || '')
  document.querySelector('meta[name="description"]')?.setAttribute('content', descMeta)
  document.querySelector('meta[property="og:title"]')?.setAttribute('content', title)
  document.querySelector('meta[property="og:description"]')?.setAttribute('content', descMeta)
  document.querySelector('meta[property="og:image"]')?.setAttribute('content', ogImage)
  document.querySelector('meta[property="og:url"]')?.setAttribute('content', ogUrl)

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
        <a class="rating-link" href="https://www.imdb.com/title/${movie.imdbId}" target="_blank" rel="noopener noreferrer" title="Оценок: ${movie.ratingImdbVoteCount || 0}">
          <img src="/img/logo/logo_imdb.svg" alt="IMDb" class="rating-logo-img"/>
          <span class="${ratingClass(movie.ratingImdb)}">${movie.ratingImdb.toFixed(1)}</span>
        </a>
      </div>`
  }

  const rows = []
  if (movie.nameOriginal && movie.nameOriginal !== movie.nameRu)       rows.push(['Оригинальное название', movie.nameOriginal])
  if (movie.year > 0)                                                  rows.push(['Год выпуска', movie.year])
  if (movie.countries?.length)                                         rows.push(['Страна', joinList(movie.countries, 'country')])
  if (movie.genres?.length)                                            rows.push(['Жанры', joinList(movie.genres, 'genre')])
  if (movie.filmLength > 0)                                            rows.push(['Длительность', movie.filmLength + ' мин'])
  if (movie.slogan && movie.slogan !== '-' && movie.slogan !== 'null') rows.push(['Слоган', '«' + movie.slogan + '»'])

  const infoRowsHtml = rows.map(([k, v]) => `<li><strong>${k}:</strong> ${v}</li>`).join('\n')

  const ageHtml = (movie.ratingAgeLimits && movie.ratingAgeLimits !== 'age0')
    ? `<li class="rating-boxes"><div class="rating-box age"><strong>${formatAge(movie.ratingAgeLimits)}</strong></div></li>`
    : ''

  const posterSrc = posterUrl(movie.posterUrlPreview || movie.posterUrl)
  const posterFull = posterUrl(movie.posterUrl || movie.posterUrlPreview)
  const posterHtml = `<a class="movie-poster-side" href="${posterFull}" target="_blank" rel="noopener noreferrer">
       <img class="movie-poster" src="${posterSrc}" alt="${title}"
            onload="this.classList.add('loaded')"
            onerror="this.classList.add('loaded');this.onerror=null;this.src=(this.src!=='${posterFull}'?'${posterFull}':'/img/placeholder.svg')"/>
     </a>`

  const desc = movie.description || movie.shortDescription || ''
  const descHtml = desc
    ? `<div class="content-info"><p class="content-description-text">${desc}</p></div>`
    : ''

  document.getElementById('movieContent').innerHTML = `
    <div class="content-header">
      <h1 class="content-title">${title}</h1>
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
  `
  if (movie.kinopoiskId || movie.imdbId) initPlayerLazyLoad(movie.players || [])
}

async function loadStaff() {
  const section = document.getElementById('cast-section')
  if (!section || !movieId) return
  try {
    const r = await fetch(`${API_BASE}/api/staff/${movieId}`)
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

async function loadSequels() {
  const section = document.getElementById('sequels-section')
  if (!section || !movieId) return
  try {
    const r = await fetch(`${API_BASE}/api/sequels/${movieId}`)
    if (!r.ok) { section.innerHTML = ''; return }
    const items = await r.json()
    if (!items?.length) { section.innerHTML = ''; return }

    const typeLabel = { SEQUEL: 'Сиквел', PREQUEL: 'Приквел', REMAKE: 'Ремейк' }

    const cards = items.map(m => {
      const id    = m.filmId
      const name  = m.nameRu || m.nameEn || m.nameOriginal || 'Без названия'
      const thumb = posterUrl(m.posterUrlPreview || m.posterUrl)
      const meta  = typeLabel[m.relationType] || m.relationType || ''
      return `
        <a class="similar-card" href="movie.html?id=${id}">
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

async function loadSimilars() {
  const section = document.getElementById('similars-section')
  if (!section || !movieId) return
  section.innerHTML = `<div class="similars-loading"><i class="fas fa-circle-notch fa-spin"></i></div>`
  try {
    const r = await fetch(`${API_BASE}/api/similars/${movieId}`)
    if (!r.ok) { section.innerHTML = ''; return }
    const items = await r.json()
    if (!items?.length) { section.innerHTML = ''; return }

    const cards = items.map(m => {
      const id    = m.filmId
      const name  = m.nameRu || m.nameEn || m.nameOriginal || 'Без названия'
      const thumb = posterUrl(m.posterUrlPreview || m.posterUrl)
      const meta  = [m.year, m.nameEn && m.nameEn !== m.nameRu ? m.nameEn : null].filter(Boolean).join(' · ')
      return `
        <a class="similar-card" href="movie.html?id=${id}">
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

  try {
    const r = await fetch(`${API_BASE}/api/movie/${movieId}`)
    if (!r.ok) throw new Error('Фильм не найден')
    renderMovie(await r.json())
  } catch (e) {
    if (!document.getElementById('movieContent').children.length) {
      renderError(e.message || 'Ошибка загрузки фильма')
    }
  }

  loadStaff()
  loadSequels()
  loadSimilars()
}

loadMovie()
