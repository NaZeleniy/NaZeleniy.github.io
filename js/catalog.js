// Страница фасета каталога (/tag/:value и /company/:value). Alpine-компонент
// catalogPage(). Оформление — как детальный вид подборки (/collections): шапка с
// названием фасета + грид с бесконечной прокруткой. Тайтлы — из /api/discover
// (tag → tag=, company → companies=).

const KIND_LABELS_CAT = {
  movie: 'Фильм', series: 'Сериал', mini_series: 'Мини-сериал',
  tv_show: 'ТВ-шоу', anime: 'Аниме', cartoon: 'Мультфильм', short: 'Короткометражка',
}

function catalogPage() {
  return {
    loading: true,
    loadError: '',
    facet: '',              // 'tag' | 'company'
    value: '',              // само значение (текст тега / название компании)
    kicker: '',             // подпись над названием
    movies: [],
    bgPoster: localStorage.getItem('nz_bg_poster') || '',
    _offset: 0,
    _hasMore: false,
    _loadingMore: false,
    _seenIds: new Set(),
    _scrollObserver: null,
    _prefetched: new Set(),
    _inited: false,

    async init() {
      // Alpine 3 сам зовёт init(), а в HTML ещё есть x-init="init()" → init() шёл
      // ДВАЖДЫ. Два параллельных _loadFirst делили _seenIds: второй _dedup видел уже
      // «увиденные» id → movies=[] на миг → мелькала «Ничего не найдено». Гвард чинит.
      // См. [[gotcha-alpine-double-init]] (тот же баг был в app.js).
      if (this._inited) return
      this._inited = true
      const f = this._readFacet()
      if (!f) { this.loading = false; this.loadError = 'Не указано значение'; return }
      this.facet = f.type
      this.value = f.value
      this.kicker = f.type === 'company' ? 'Производство' : 'По тегу'
      document.title = `${f.value} — NaZeleniy`
      try {
        await this._loadFirst()
      } catch (e) {
        console.error(e)
        this.loadError = 'Не удалось загрузить'
      } finally {
        this.loading = false
      }
      if (this._hasMore) setTimeout(() => this._setupScroll(), 0)
    },

    // facet+value из чистого пути /tag/{v} | /company/{v} или из ?tag=/?company=
    _readFacet() {
      const m = location.pathname.match(/^\/(tag|company)\/(.+?)\/?$/)
      if (m) return { type: m[1], value: decodeURIComponent(m[2]) }
      const p = new URLSearchParams(location.search)
      if (p.get('tag')) return { type: 'tag', value: p.get('tag') }
      if (p.get('company')) return { type: 'company', value: p.get('company') }
      return null
    },

    _fetchPage(offset) {
      const param = this.facet === 'company' ? 'companies' : 'tag'
      const q = `${param}=${encodeURIComponent(this.value)}&sort=popularity&order=desc&required=kp_id&limit=24&offset=${offset}`
      return fetch(`${API_BASE}/api/discover?${q}`).then(r => {
        if (!r.ok) throw new Error('discover ' + r.status)
        return r.json()
      })
    },

    async _loadFirst() {
      const d = await this._fetchPage(0)
      this.movies = this._dedup((d.items || []).map(normalizeStub))
      this._offset = 24
      this._hasMore = !!d.has_more
      if (this.movies.length) this._setBg(this.movies[0])
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
        // транзиентная ошибка — повторим при следующем скролле, done не ставим
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

    // Дедуп карточек по kp_id (discover может отдать дубли)
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
    movieType(m) { return KIND_LABELS_CAT[m.kind] || '' },
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
