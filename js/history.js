const HISTORY_KEY = 'nz_history'
const HISTORY_MAX = 20

function historyGet() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') } catch { return [] }
}

function historyAdd(movie) {
  const id = String(movie.kinopoiskId || movie.filmId || '')
  if (!id) return
  const items = historyGet().filter(m => String(m.kinopoiskId || m.filmId) !== id)
  items.unshift({
    kinopoiskId: movie.kinopoiskId || movie.filmId,
    nameRu: movie.nameRu,
    nameEn: movie.nameEn,
    year: movie.year,
    type: movie.type,
    ratingKinopoisk: movie.ratingKinopoisk,
    posterUrlPreview: movie.posterUrlPreview,
    posterUrl: movie.posterUrl,
  })
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, HISTORY_MAX)))
}

function historyClear() {
  localStorage.removeItem(HISTORY_KEY)
}
