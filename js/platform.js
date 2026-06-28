// Страница платформы (/platform/:slug). Alpine-компонент platformPage().
// Список платформ берётся из /api/filters (platforms[]), тайтлы — из
// /api/discover?platform=<slug> с бесконечной прокруткой.

const KIND_LABELS_P = {
  movie: 'Фильм', series: 'Сериал', mini_series: 'Мини-сериал',
  tv_show: 'ТВ-шоу', anime: 'Аниме', cartoon: 'Мультфильм', short: 'Короткометражка',
}

// Брендовые цвета популярных платформ; для остальных — детерминированный оттенок из названия.
const PLATFORM_COLORS = {
  netflix: '#e50914', amazon_prime: '#00a8e1', apple_tv: '#9aa0a6', disney: '#1f6feb',
  hbo_max: '#a45deb', kinopoisk: '#ff5500', okko: '#7c4dff', ivi: '#ff5b5b',
  wink: '#b14bff', start: '#ff3c5f', premier: '#1ec98b', kion: '#7b61ff',
  hulu: '#1ce783', paramount: '#0064ff', peacock: '#fa6400', showtime: '#d4382e',
  starz: '#1ec0c0', warner_bros: '#0073e6', universal: '#1b3fae', youtube_premium: '#ff0000',
  megogo_distribution: '#ff7a00', kinopoisk_hd: '#ff5500',
}

function _pfColor(slug, name) {
  if (PLATFORM_COLORS[slug]) return PLATFORM_COLORS[slug]
  let h = 0
  const s = String(name || slug || '')
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return `hsl(${h % 360} 68% 56%)`
}

function _pfMonogram(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

function platformPage() {
  return {
    loading: true,
    loadError: '',
    platform: null,         // { slug, name, count, color, monogram }
    movies: [],
    bgPoster: localStorage.getItem('nz_bg_poster') || '',
    _slug: '',
    _offset: 0,
    _hasMore: false,
    _loadingMore: false,
    _seenIds: new Set(),
    _scrollObserver: null,
    _prefetched: new Set(),

    async init() {
      this._slug = this._readSlug()
      if (!this._slug) { this.loading = false; this.loadError = 'Платформа не указана'; return }
      try {
        const meta = await this._loadMeta(this._slug)
        if (!meta) { this.loading = false; this.loadError = 'Платформа не найдена'; return }
        const color = _pfColor(meta.slug, meta.name)
        this.platform = { ...meta, color, monogram: _pfMonogram(meta.name) }
        document.title = `${meta.name} — NaZeleniy`
        await this._loadFirst()
      } catch (e) {
        console.error(e)
        this.loadError = 'Не удалось загрузить платформу'
      } finally {
        this.loading = false
      }
      if (this._hasMore) setTimeout(() => this._setupScroll(), 0)
    },

    _readSlug() {
      const m = location.pathname.match(/\/platform\/([^/?#]+)/)
      if (m) return decodeURIComponent(m[1])
      const p = new URLSearchParams(location.search)
      return p.get('slug') || p.get('platform') || ''
    },

    // Метаданные платформы из /api/filters (кешируем в sessionStorage)
    async _loadMeta(slug) {
      let list = null
      try {
        const cached = sessionStorage.getItem('nz_platforms')
        if (cached) list = JSON.parse(cached)
      } catch {}
      if (!list) {
        const r = await fetch(`${API_BASE}/api/filters`)
        if (!r.ok) throw new Error('filters ' + r.status)
        const d = await r.json()
        list = d.platforms || []
        try { sessionStorage.setItem('nz_platforms', JSON.stringify(list)) } catch {}
      }
      return list.find(p => p.slug === slug) || null
    },

    async _loadFirst() {
      const d = await this._fetchPage(0)
      this.movies = this._dedup((d.items || []).map(normalizeStub))
      this._offset = 24
      this._hasMore = !!d.has_more
      if (this.movies.length) this._setBg(this.movies[0])
    },

    _fetchPage(offset) {
      const q = `platform=${encodeURIComponent(this._slug)}&sort=popularity&order=desc&required=kp_id&limit=24&offset=${offset}`
      return fetch(`${API_BASE}/api/discover?${q}`).then(r => {
        if (!r.ok) throw new Error('discover ' + r.status)
        return r.json()
      })
    },

    async _loadMore() {
      if (this._loadingMore || !this._hasMore) return
      this._loadingMore = true
      try {
        const d = await this._fetchPage(this._offset)
        this._offset += 24
        this._hasMore = !!d.has_more
        const next = this._dedup((d.items || []).map(normalizeStub))
        if (next.length) { this.prefetchPosters(next); this.movies.push(...next) }
      } catch {
        // транзиентная ошибка — повторим при следующем скролле
      } finally {
        this._loadingMore = false
        if (!this._hasMore) this._cleanupScroll()
        else requestAnimationFrame(() => this._checkFill())
      }
    },

    _checkFill() {
      if (this._loadingMore || !this._hasMore) return
      const s = document.getElementById('scroll-sentinel')
      if (s && s.getBoundingClientRect().top <= window.innerHeight + 800) this._loadMore()
    },

    _dedup(items) {
      const out = []
      for (const m of items) {
        const id = m.kinopoiskId || m.filmId
        if (id == null) { out.push(m); continue }
        if (this._seenIds.has(id)) continue
        this._seenIds.add(id)
        out.push(m)
      }
      return out
    },

    _setupScroll() {
      this._cleanupScroll()
      if (typeof IntersectionObserver === 'undefined') return
      const sentinel = document.getElementById('scroll-sentinel')
      if (!sentinel) return
      this._scrollObserver = new IntersectionObserver(entries => {
        if (entries[0].isIntersecting && !this._loadingMore && this._hasMore) this._loadMore()
      }, { rootMargin: '800px' })
      this._scrollObserver.observe(sentinel)
      requestAnimationFrame(() => this._checkFill())
    },

    _cleanupScroll() {
      if (this._scrollObserver) { this._scrollObserver.disconnect(); this._scrollObserver = null }
    },

    back() {
      if (history.length > 1) history.back()
      else location.href = '/'
    },

    // ── Геттеры представления ────────────────────────────
    get heroVars() {
      return this.platform ? `--pf: ${this.platform.color}` : ''
    },
    get logoUrl() {
      if (!this.platform || !this.platform.poster_url) return ''
      return `${API_BASE}/proxy/poster?url=${encodeURIComponent(this.platform.poster_url)}`
    },
    get logoStyle() {
      if (!this.platform) return ''
      const c = this.platform.color
      return `background: linear-gradient(150deg, ${c}, color-mix(in srgb, ${c} 65%, #000))`
    },

    plural(n, forms) {
      const n10 = n % 10, n100 = n % 100
      if (n10 === 1 && n100 !== 11) return forms[0]
      if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return forms[1]
      return forms[2]
    },

    // ── Карточка фильма ──────────────────────────────────
    posterFor(m) { return posterUrl(m.posterUrlPreview || m.posterUrl) },
    ratingBg(r) {
      if (r >= 7.0) return '#27ae60'
      if (r < 5.0)  return '#e74c3c'
      return '#7f8c8d'
    },
    // Лучшая доступная оценка: КП → IMDb → TMDb. Пропускаем округляющиеся до 0.0.
    cardRating(m) {
      for (const v of [m.ratingKinopoisk, m.ratingImdb, m.ratingTmdb]) {
        const n = +v || 0
        if (n >= 0.05) return n
      }
      return 0
    },
    movieType(m) { return KIND_LABELS_P[m.kind] || '' },
    origTitle(m) {
      const orig = m.nameOriginal || m.nameEn || ''
      return orig && orig !== (m.nameRu || '') ? orig : ''
    },

    prefetchPosters(movies) {
      for (let i = 0; i < Math.min(movies.length, 20); i++) {
        const src = this.posterFor(movies[i])
        if (src) { const img = new Image(); img.src = src }
      }
    },

    _setBg(m) {
      const url = posterUrl(m.posterUrlPreview || m.posterUrl)
      if (!url || url.includes('placeholder')) return
      this.bgPoster = url
      try { localStorage.setItem('nz_bg_poster', url) } catch {}
    },

    onCardEnter(m) {
      this._setBg(m)
      const id = m.kinopoiskId || m.filmId
      if (!id || this._prefetched.has(id)) return
      this._prefetched.add(id)
      if (location.hostname.endsWith('github.io')) return
      const link = document.createElement('link')
      link.rel = 'prefetch'
      link.href = '/movie/' + id
      document.head.appendChild(link)
    },
  }
}
