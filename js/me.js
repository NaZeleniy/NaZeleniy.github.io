function ratingColor(r) {
  if (!r) return '#999'
  if (r >= 7) return '#27ae60'
  if (r >= 5) return '#999'
  return '#e74c3c'
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

async function loadMe() {
  // 1. Проверяем авторизацию — сначала кеш, потом сеть
  let user = window._nzUser || null
  if (!user) {
    try {
      const raw = localStorage.getItem('nz_me')
      if (raw) {
        const parsed = JSON.parse(raw)
        user = parsed.data || parsed // поддержка старого формата без обёртки
      }
    } catch {}
  }
  if (!user) {
    try {
      const r = await fetch(API_BASE + '/api/me', { credentials: _CREDS, headers: _bearerHeader() })
      if (r.ok) {
        user = await r.json()
        window._nzUser = user
      }
    } catch {}
  }

  if (!user) {
    if (typeof openAuthModal === 'function') {
      openAuthModal(() => loadMe())
    } else {
      // fallback на случай если модалка ещё не загрузилась
      location.replace('/login?next=' + encodeURIComponent(location.pathname + location.search))
    }
    return
  }

  // 2. Рендерим шапку профиля
  const initials = (user.name || '?').slice(0, 2).toUpperCase()
  document.getElementById('me-avatar').textContent = initials
  document.getElementById('me-name').textContent = user.name || 'Профиль'
  document.getElementById('me-header').style.display = ''
  document.getElementById('me-ratings-section').style.display = ''

  // 3. Загружаем оценки
  let ratings = []
  let ratingsTotal = 0
  try {
    const r = await fetch(API_BASE + '/api/me/ratings', { credentials: _CREDS, headers: _bearerHeader() })
    if (r.ok) {
      const body = await r.json()
      ratings = body.items || []
      ratingsTotal = body.total ?? ratings.length
    }
  } catch {}

  const countEl = document.getElementById('me-ratings-count')
  countEl.textContent = ratingsTotal
    ? `${ratingsTotal} ${pluralRatings(ratingsTotal)}`
    : 'нет оценок'

  const list = document.getElementById('me-ratings-grid')

  if (!ratings.length) {
    list.innerHTML = `
      <div class="me-empty">
        <i class="fas fa-star me-empty-icon"></i>
        <p>Вы ещё не оценили ни одного фильма</p>
      </div>`
    return
  }

  list.innerHTML = ratings.map(item => {
    const id = item.kinopoiskId
    if (!id) return ''
    const title    = escapeHtml(item.nameRu || item.nameOriginal || `Фильм #${id}`)
    const original = item.nameOriginal && item.nameOriginal !== item.nameRu
      ? `<span class="me-item-original">${escapeHtml(item.nameOriginal)}</span>`
      : ''
    const genreList = Array.isArray(item.genres) && item.genres.length
      ? `<div class="me-item-genres">${item.genres.slice(0, 3).map(g =>
          `<span class="me-item-genre">${escapeHtml(g.genre || g)}</span>`
        ).join('')}</div>`
      : ''
    const imgSrc = item.posterUrl || '/img/placeholder.svg'
    const color = ratingColor(item.userRating)
    const date  = item.ratedAt ? formatDate(item.ratedAt) : ''
    const preview = JSON.stringify({ filmId: id, nameRu: item.nameRu, nameEn: item.nameOriginal, posterUrl: item.posterUrl, posterUrlPreview: item.posterUrl }).replace(/'/g, '&#39;')
    return `
      <a href="/movie/${id}" class="me-item" onclick="sessionStorage.setItem('moviePreview','${preview}')">
        <img class="me-item-poster" src="${imgSrc}" alt="${title}" loading="lazy"/>
        <div class="me-item-info">
          <span class="me-item-title">${title}</span>
          ${original}
          ${genreList}
        </div>
        <div class="me-item-meta">
          ${date ? `<span class="me-item-date">${date}</span>` : ''}
          <span class="me-item-rating" style="background:${color}">${item.userRating}</span>
        </div>
      </a>`
  }).join('')
}

function formatDate(iso) {
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

function pluralRatings(n) {
  const mod10 = n % 10, mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'оценка'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'оценки'
  return 'оценок'
}

async function meLogout() {
  try {
    await fetch(API_BASE + '/auth/logout', {
      method: 'POST',
      credentials: _CREDS,
      headers: _bearerHeader()
    })
  } catch {}
  try { localStorage.removeItem('nz_me') } catch {}
  try { localStorage.removeItem('nz_bearer') } catch {}
  window._nzUser = null
  location.href = '/'
}

loadMe()
