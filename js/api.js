const API_BASE = window.location.hostname.endsWith('github.io')
  ? 'https://aucklanda.online'
  : ''

// credentials mode для fetch:
// - same-origin (API_BASE = ''): 'include' — куки работают
// - github.io cross-origin с корректным origin: 'include' — CORS разрешает
// - TV/webview с null-origin, app://-схемой или любым нестандартным origin: 'omit'
//   (браузер блокирует 'include' когда сервер отвечает Access-Control-Allow-Origin: *)
//   Bearer-токен в Authorization-заголовке работает без cookies
const _CREDS = (() => {
  if (!API_BASE) return 'include'
  const o = location.origin  // API_BASE !== '' только на github.io-страницах
  if (o === 'null' || !o.endsWith('github.io')) return 'omit'
  return 'include'
})()

const PLACEHOLDER = '/img/placeholder.svg'

// Хосты KP/Яндекса — отдаём напрямую (быстро в РФ, нам бесплатно, не грузит наш
// сервер). Остальные разрешённые прокси-хосты (TMDB/IMDb) в РФ часто заблокированы
// и выгоднее идти через наш /proxy/poster (доступность + конверсия в WebP, кеш 24ч).
const _KP_HOSTS = /avatars\.mds\.yandex\.net|st\.kp\.yandex\.net/
const _PROXY_HOSTS = /image\.tmdb\.org|m\.media-amazon\.com|kinopoiskapiunofficial\.tech/

// Возвращает готовый src постера. KP — напрямую, TMDB/IMDb — через /proxy/poster,
// неизвестные хосты — как есть. Бэкенд принимает только белый список хостов (иначе 403).
function posterUrl(url) {
  if (!url || url.includes('no-poster')) return PLACEHOLDER
  if (_PROXY_HOSTS.test(url) && !_KP_HOSTS.test(url)) {
    return API_BASE + '/proxy/poster?url=' + encodeURIComponent(url)
  }
  return url
}

// Известные CDN-хосты фото персон (совпадают с белым списком бэкенда posterHosts).
const _PERSON_HOSTS = /avatars\.mds\.yandex\.net|st\.kp\.yandex\.net|image\.tmdb\.org|m\.media-amazon\.com|kinopoiskapiunofficial\.tech|api\.kinodata\.space/

// Фото персон всегда проксируем через бэкенд — в отличие от постеров, где KP/Яндекс
// отдаются напрямую. Портреты с KP/Кинопоиска часто отдаются с hotlink-защитой и
// нестабильны при прямой загрузке; прокси даёт надёжность, WebP-конверсию и кеш 24ч.
// Неизвестные хосты — напрямую (бэкенд принимает только белый список → иначе 403).
function personPhotoUrl(url) {
  if (!url || url.includes('no-poster')) return PLACEHOLDER
  if (_PERSON_HOSTS.test(url)) {
    return API_BASE + '/proxy/poster?url=' + encodeURIComponent(url)
  }
  return url
}

// Уменьшенный постер для миниатюр в сетке — режет трафик в разы (для прямой
// загрузки и для прокси). KP: .../600x900 → /300x450; TMDB: original → w342.
function _previewPoster(full) {
  if (!full) return ''
  if (_KP_HOSTS.test(full)) return full.replace(/\/\d+x\d+$/, '/300x450')
  if (full.includes('image.tmdb')) return full.replace('/t/p/original/', '/t/p/w342/')
  return full
}

// ── Нормализация ответов Kinodata → плоская camelCase-форма ──────────────
// Бэкенд перешёл на Kinodata: «киношные» эндпоинты отдают сгруппированные
// объекты (ids/title/ratings/media/…), id — строки, списки — title-stub.
// Рендеринг всего фронта исторически ждёт плоский Movie (kinopoiskId, nameRu,
// posterUrl, ratingKinopoisk…). Эти адаптеры конвертируют новый контракт в старый.

function _pickPoster(o) {
  if (!o) return ''
  return o.poster_kp || o.poster_tmdb || o.poster_imdb || o.poster_url || o.backdrop_url || ''
}

// kind Kinodata (movie|series|mini_series|tv_show|anime|cartoon|short) → старый type
function _kindToType(kind) {
  switch (kind) {
    case 'series': return 'TV_SERIES'
    case 'mini_series': return 'MINI_SERIES'
    case 'tv_show': return 'TV_SHOW'
    default: return 'FILM' // movie, anime, cartoon, short
  }
}

// genres: в stub — массив slug-строк, в movie — [{slug,name_ru,name_en}]
function _normGenres(g) {
  if (!Array.isArray(g)) return []
  return g.map(x => typeof x === 'string'
    ? { genre: x }
    : { genre: x.name_ru || x.name_en || x.slug || '' })
}

// countries: [{code,name_ru,name_en}] → [{country}]
function _normCountries(c) {
  if (!Array.isArray(c)) return []
  return c.map(x => typeof x === 'string'
    ? { country: x }
    : { country: x.name_ru || x.name_en || x.code || '' })
}

// title-stub (поиск, подборки, похожие, сиквелы, suggest) → плоская карточка
function normalizeStub(s) {
  if (!s) return s
  const poster = _pickPoster(s)
  return {
    kinopoiskId: s.kp_id, filmId: s.kp_id, imdbId: s.imdb_id || null,
    nameRu: s.title_ru || '', nameEn: s.title_en || '',
    nameOriginal: s.title_original || s.title_en || '',
    year: s.year || null,
    type: _kindToType(s.kind), kind: s.kind || null,
    posterUrl: poster, posterUrlPreview: _previewPoster(poster),
    ratingKinopoisk: s.rating_kp || 0, ratingImdb: s.rating_imdb || 0,
    ratingTmdb: s.rating_tmdb || 0,
    genres: _normGenres(s.genres), countries: _normCountries(s.countries),
  }
}

// Полный ответ /api/movie/:id (сгруппированный Kinodata + players) → плоский Movie.
// Если объект уже плоский (превью из sessionStorage) — возвращаем как есть.
function normalizeMovie(d) {
  if (!d || !d.ids) return d
  const title = d.title || {}
  const rel = d.release || {}
  const syn = d.synopsis || {}
  const r = d.ratings || {}
  const cls = d.classification || {}
  const poster = _pickPoster(d.media)
  return {
    kinopoiskId: d.ids.kp_id, filmId: d.ids.kp_id, imdbId: d.ids.imdb_id || null,
    nameRu: title.title_ru || '', nameEn: title.title_en || '',
    nameOriginal: title.title_original || '',
    year: rel.year || null, filmLength: rel.runtime || 0,
    description: syn.overview_ru || syn.overview_alter || syn.short_overview_ru || '',
    shortDescription: syn.short_overview_ru || '',
    slogan: syn.tagline_ru || '',
    posterUrl: poster, posterUrlPreview: poster,
    ratingKinopoisk: r.rating_kp || 0, ratingKinopoiskVoteCount: r.votes_kp || 0,
    ratingImdb: r.rating_imdb || 0, ratingImdbVoteCount: r.votes_imdb || 0,
    countries: _normCountries(d.countries), genres: _normGenres(d.genres),
    ratingAgeLimits: cls.age_limit != null ? ('age' + cls.age_limit) : null,
    type: _kindToType((d.type || {}).kind), kind: (d.type || {}).kind || null,
    // players больше не приходят в /api/movie — грузятся отдельно через GET /api/players/:id
  }
}

// /api/staff/:id → { cast: [{person,role,character_ru,job,ord}] } → плоский массив
// со старыми полями (professionKey, nameRu, posterUrl, staffId, description).
function normalizeStaff(d) {
  const cast = (d && Array.isArray(d.cast)) ? d.cast : []
  return cast.map(c => {
    const p = c.person || {}
    return {
      staffId: p.kp_id, professionKey: (c.role || '').toUpperCase(),
      nameRu: p.name_ru || '', nameEn: p.name_en || '',
      description: c.character_ru || c.character_en || c.job || '',
      posterUrl: p.photo_url || '',
    }
  })
}

// /api/person/:id → { person: {...} } → плоский объект (birth_year, birthplace)
function normalizePerson(d) {
  const p = (d && d.person) ? d.person : (d || {})
  return {
    staffId: p.kp_id,
    nameRu: p.name_ru || '', nameEn: p.name_en || '',
    birthYear: p.birth_year || null, birthplace: p.birthplace || '',
    posterUrl: p.photo_url || '',
  }
}

function _bearerHeader() {
  try {
    const t = localStorage.getItem('nz_bearer')
    return t ? { Authorization: 'Bearer ' + t } : {}
  } catch { return {} }
}

function vibixSrcdoc(kpId, height) {
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{margin:0;padding:0}body{background:#000}</style>
<script src="https://graphicslab.io/sdk/v2/rendex-sdk.min.js"></script>
</head><body>
<ins data-publisher-id="677393820" data-type="kp" data-id="${kpId}" data-design="2" data-height="${height}" data-color1="#333333" data-color2="#666666" data-color3="#999999" data-color4="#CCCCCC" data-color5="#FFFFFF"></ins>
</body></html>`
}
