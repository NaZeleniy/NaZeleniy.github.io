const ME_API = window.location.hostname.endsWith('github.io')
  ? 'https://nazeleniy.mooo.com'
  : ''

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
  const wrap = document.getElementById('me-content')

  // 1. Проверяем авторизацию
  let user = null
  try {
    const r = await fetch(ME_API + '/api/me', { credentials: 'include' })
    if (r.ok) user = await r.json()
  } catch {}

  if (!user) {
    location.replace('/login.html?next=' + encodeURIComponent(location.pathname + location.search))
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
  try {
    const r = await fetch(ME_API + '/api/me/ratings', { credentials: 'include' })
    if (r.ok) ratings = await r.json()
  } catch {}

  const countEl = document.getElementById('me-ratings-count')
  countEl.textContent = ratings.length
    ? `${ratings.length} ${pluralRatings(ratings.length)}`
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
    const title    = escapeHtml(item.nameRu || item.nameOriginal || `Фильм #${item.kp_id}`)
    const original = item.nameOriginal && item.nameOriginal !== item.nameRu
      ? `<span class="me-item-original">${escapeHtml(item.nameOriginal)}</span>`
      : ''
    const imgSrc = item.posterUrl
      ? ME_API + '/proxy/poster?url=' + encodeURIComponent(item.posterUrl)
      : '/img/placeholder.svg'
    const color = ratingColor(item.rating)
    const date  = item.created_at ? formatDate(item.created_at) : ''
    return `
      <a href="/movie.html?id=${item.kp_id}" class="me-item">
        <img class="me-item-poster" src="${imgSrc}" alt="${title}" loading="lazy"/>
        <div class="me-item-info">
          <span class="me-item-title">${title}</span>
          ${original}
        </div>
        <div class="me-item-meta">
          ${date ? `<span class="me-item-date">${date}</span>` : ''}
          <span class="me-item-rating" style="background:${color}">${item.rating}</span>
        </div>
      </a>`
  }).join('')
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  } catch { return '' }
}

function pluralRatings(n) {
  const mod10 = n % 10, mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'оценка'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'оценки'
  return 'оценок'
}

async function meLogout() {
  await fetch(ME_API + '/auth/logout', { method: 'POST', credentials: 'include' })
  location.href = '/login.html'
}

loadMe()
