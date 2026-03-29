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
  return `<a href="/" class="back-btn" onclick="if(history.length>1){event.preventDefault();history.back()}">
    <i class="fas fa-arrow-left"></i>
    <span>Назад</span>
  </a>`
}

const PLAYERS = [
  { name: 'FlixCDN',  url: (r, id) => `//player0.flixcdn.space/show/${r}/${id}?no_sharing=1` },
]

function selectPlayer(btn, src) {
  document.querySelectorAll('.player-btn').forEach(b => b.classList.remove('active'))
  btn.classList.add('active')
  document.getElementById('playerFrame').src = src
}

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

  const btns = PLAYERS.map((p, i) =>
    `<button class="player-btn${i === 0 ? ' active' : ''}"
      onclick="selectPlayer(this,'${p.url(resource, id)}')">${p.name}</button>`
  ).join('')

  return `<details class="player-section">
    <summary class="player-summary">
      <i class="fas fa-play-circle"></i>
      <span>Выбрать плеер</span>
      <i class="fas fa-chevron-down player-chevron"></i>
    </summary>
    <div class="player-select">${btns}</div>
    <div class="player-wrapper">
      <iframe id="playerFrame" src="${PLAYERS[0].url(resource, id)}"
        width="640" height="480"
        frameborder="0" allowfullscreen></iframe>
    </div>
  </details>`
}

function renderMovie(movie) {
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
