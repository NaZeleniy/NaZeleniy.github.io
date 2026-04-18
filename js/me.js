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
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  } catch { return '' }
}

function renderRatingItem(item) {
  const id = item.kinopoiskId
  if (!id) return ''
  const title    = escapeHtml(item.nameRu || item.nameOriginal || `Фильм #${id}`)
  const original = item.nameOriginal && item.nameOriginal !== item.nameRu
    ? `<span class="me-item-original">${escapeHtml(item.nameOriginal)}</span>` : ''
  const genreList = Array.isArray(item.genres) && item.genres.length
    ? `<div class="me-item-genres">${item.genres.slice(0, 3).map(g =>
        `<span class="me-item-genre">${escapeHtml(g.genre || g)}</span>`
      ).join('')}</div>` : ''
  const imgSrc  = item.posterUrl || '/img/placeholder.svg'
  const color   = ratingColor(item.userRating)
  const date    = item.ratedAt ? formatDate(item.ratedAt) : ''
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
}

function renderFavoriteItem(item) {
  const id = item.kinopoiskId
  if (!id) return ''
  const title    = escapeHtml(item.nameRu || item.nameOriginal || `Фильм #${id}`)
  const original = item.nameOriginal && item.nameOriginal !== item.nameRu
    ? `<span class="me-item-original">${escapeHtml(item.nameOriginal)}</span>` : ''
  const genreList = Array.isArray(item.genres) && item.genres.length
    ? `<div class="me-item-genres">${item.genres.slice(0, 3).map(g =>
        `<span class="me-item-genre">${escapeHtml(g.genre || g)}</span>`
      ).join('')}</div>` : ''
  const imgSrc  = posterUrl(item.posterUrl)
  const date    = item.favoritedAt ? formatDate(item.favoritedAt) : ''
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
        <span class="me-item-fav-icon"><i class="fas fa-heart"></i></span>
      </div>
    </a>`
}

// ── Tab switching ──────────────────────────────────────────

let _activeTab = 'ratings'
let _favoritesLoaded = false

function switchTab(tab) {
  if (_activeTab === tab) return
  _activeTab = tab

  document.getElementById('tab-btn-ratings').classList.toggle('me-tab--active', tab === 'ratings')
  document.getElementById('tab-btn-favorites').classList.toggle('me-tab--active', tab === 'favorites')
  document.getElementById('me-ratings-section').style.display = tab === 'ratings' ? '' : 'none'
  document.getElementById('me-favorites-section').style.display = tab === 'favorites' ? '' : 'none'

  if (tab === 'favorites' && !_favoritesLoaded) loadFavorites()
}

async function loadFavorites() {
  _favoritesLoaded = true
  const grid = document.getElementById('me-favorites-grid')
  grid.innerHTML = `<div class="me-loading"><i class="fas fa-circle-notch fa-spin"></i></div>`

  try {
    const r = await fetch(API_BASE + '/api/me/favorites?limit=50&offset=0', {
      credentials: _CREDS,
      headers: _bearerHeader()
    })
    if (!r.ok) throw new Error()
    const body = await r.json()
    const items = body.items || []
    const total = body.total ?? items.length

    const badge = document.getElementById('tab-badge-favorites')
    if (badge) badge.textContent = total || ''

    if (!items.length) {
      grid.innerHTML = `
        <div class="me-empty">
          <i class="fas fa-heart me-empty-icon"></i>
          <p>Список пуст — добавляйте фильмы<br>кнопкой «Буду смотреть»</p>
        </div>`
      return
    }

    grid.innerHTML = items.map(renderFavoriteItem).join('')
  } catch {
    grid.innerHTML = `
      <div class="me-empty">
        <i class="fas fa-exclamation-circle me-empty-icon"></i>
        <p>Ошибка загрузки</p>
      </div>`
    _favoritesLoaded = false
  }
}

// ── Main ───────────────────────────────────────────────────

async function loadMe() {
  let user = window._nzUser || null
  if (!user) {
    try {
      const raw = localStorage.getItem('nz_me')
      if (raw) {
        const parsed = JSON.parse(raw)
        user = parsed.data || parsed
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
      location.replace('/login?next=' + encodeURIComponent(location.pathname + location.search))
    }
    return
  }

  // Шапка профиля
  const displayName = (user.name || '').replace(/^@/, '') || 'Профиль'
  const initials = displayName.slice(0, 1).toUpperCase()
  const avatarEl = document.getElementById('me-avatar')
  if (user.avatar_url) {
    avatarEl.innerHTML = `<img src="${escapeHtml(user.avatar_url)}" alt="${escapeHtml(initials)}" class="me-avatar-img"/>`
    avatarEl.classList.add('me-avatar--photo')
  } else {
    const TG_GRADIENTS = [
      ['#FF516A','#FF8B5F'],['#FFA943','#FFCD6A'],['#A0DE7E','#54CB68'],
      ['#53EDD6','#28B9B5'],['#72D5FD','#2A9EF1'],['#E46EFF','#AC44CC'],['#FF86A6','#FF599D'],
    ]
    const [c1, c2] = TG_GRADIENTS[(user.telegram_id || 0) % TG_GRADIENTS.length]
    avatarEl.textContent = initials
    avatarEl.style.background = `linear-gradient(135deg, ${c1}, ${c2})`
    avatarEl.style.border = 'none'
    avatarEl.style.color = '#fff'
  }
  document.getElementById('me-name').textContent = displayName
  document.getElementById('me-header').style.display = ''
  document.getElementById('me-tabs').style.display = ''
  document.getElementById('me-ratings-section').style.display = ''

  // Загружаем оценки
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

  const badge = document.getElementById('tab-badge-ratings')
  if (badge) badge.textContent = ratingsTotal || ''

  const grid = document.getElementById('me-ratings-grid')

  if (!ratings.length) {
    grid.innerHTML = `
      <div class="me-empty">
        <i class="fas fa-star me-empty-icon"></i>
        <p>Вы ещё не оценили ни одного фильма</p>
      </div>`
    return
  }

  grid.innerHTML = ratings.map(renderRatingItem).join('')
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
