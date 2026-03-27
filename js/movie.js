// Movie detail page script.
// Reads ?id=<kinopoiskId> from the URL and fetches the movie from the API.
// Depends on API_BASE defined in api.js.

// Read movie ID from URL query: movie.html?id=123
const movieId = new URLSearchParams(window.location.search).get('id')

// ── Sidebar toggle ──────────────────────────────────────────
const sidebar    = document.getElementById('sidebar')
const toggleBtn  = document.getElementById('toggleBtn')
const toggleIcon = document.getElementById('toggleIcon')

toggleBtn.addEventListener('click', () => {
  const isOpen = sidebar.classList.toggle('open')
  toggleIcon.className = isOpen ? 'fas fa-chevron-left' : 'fas fa-chevron-right'
})

// ── Render helpers ──────────────────────────────────────────
function displayType(type) {
  switch (type) {
    case 'TV_SERIES':
    case 'MINI_SERIES': return 'Сериал'
    case 'TV_SHOW':     return 'Шоу'
    default:            return 'Фильм'
  }
}

function ratingClass(r) {
  if (r >= 7.0) return 'rating-value high'
  if (r < 5.0)  return 'rating-value low'
  return 'rating-value'
}

function formatAge(age) {
  const n = age.replace(/^age/, '')
  return (n === '' || n === '0') ? '0+' : n + '+'
}

function joinList(arr, key) {
  return arr.map(x => x[key]).join(', ')
}

// ── Render ──────────────────────────────────────────────────
function renderMovie(movie) {
  const title = movie.nameRu || movie.nameEn || 'Без названия'
  document.title = title + ' — NaZeleniy'

  // Ratings
  let ratingsHtml = ''
  if (movie.ratingKinopoisk > 0) {
    const kpUrl = `https://www.kinopoisk.ru/film/${movie.kinopoiskId}`
    ratingsHtml += `
      <div class="rating-container">
        <a class="rating-link" href="${kpUrl}" target="_blank" rel="noopener noreferrer"
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

  // Info rows
  const rows = []
  if (movie.type)                                                   rows.push(['Тип', displayType(movie.type)])
  if (movie.year > 0)                                               rows.push(['Год выпуска', movie.year])
  if (movie.nameRu)                                                 rows.push(['Название', movie.nameRu])
  if (movie.nameEn)                                                 rows.push(['Оригинальное название', movie.nameEn])
  if (movie.countries?.length)                                      rows.push(['Страна производства', joinList(movie.countries, 'country')])
  if (movie.genres?.length)                                         rows.push(['Жанры', joinList(movie.genres, 'genre')])
  if (movie.filmLength > 0)                                         rows.push(['Длительность', movie.filmLength + ' мин'])
  if (movie.slogan && movie.slogan !== '-' && movie.slogan !== 'null') rows.push(['Слоган', '«' + movie.slogan + '»'])

  const infoRowsHtml = rows.map(([k, v]) => `<li><strong>${k}:</strong> ${v}</li>`).join('\n')

  const ageHtml = (movie.ratingAgeLimits && movie.ratingAgeLimits !== 'age0')
    ? `<li class="rating-boxes"><div class="rating-box age"><strong>${formatAge(movie.ratingAgeLimits)}</strong></div></li>`
    : ''

  const posterHtml = movie.posterUrl
    ? `<div class="movie-poster-container desktop-only">
         <a href="${movie.posterUrl}" target="_blank" rel="noopener noreferrer">
           <img class="movie-poster" src="${movie.posterUrl}" alt="${title}"/>
         </a>
       </div>`
    : ''

  const desc = movie.description || movie.shortDescription || ''
  const descHtml = desc
    ? `<div class="content-info"><p class="content-description-text">${desc}</p></div>`
    : ''

  document.getElementById('movieContent').innerHTML = `
    <a href="/" class="back-btn">
      <i class="fas fa-arrow-left"></i>
      <span>Назад</span>
    </a>
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
  `
}

function renderError(message) {
  document.getElementById('movieContent').innerHTML = `
    <a href="/" class="back-btn">
      <i class="fas fa-arrow-left"></i>
      <span>Назад</span>
    </a>
    <div class="empty-state">
      <i class="fas fa-film"></i>
      <p>${message}</p>
    </div>
  `
}

// ── Load ────────────────────────────────────────────────────
async function loadMovie() {
  if (!movieId) {
    renderError('ID фильма не указан')
    return
  }

  try {
    const r = await fetch(`${API_BASE}/api/movie/${movieId}`)
    if (!r.ok) throw new Error('Фильм не найден')
    const movie = await r.json()
    renderMovie(movie)
  } catch (e) {
    console.error('loadMovie:', e)
    renderError(e.message || 'Ошибка загрузки фильма')
  }
}

loadMovie()
