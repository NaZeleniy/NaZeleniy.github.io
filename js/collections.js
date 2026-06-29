// Страница подборок (/collections). Alpine-компонент collections().
// Список: GET /api/collections. Детали: GET /api/collections/:slug.

const KIND_LABELS_C = {
  movie: 'Фильм', series: 'Сериал', mini_series: 'Мини-сериал',
  tv_show: 'ТВ-шоу', anime: 'Аниме', cartoon: 'Мультфильм', short: 'Короткометражка',
}

function collections() {
  return {
    view: 'index',          // 'index' | 'detail'
    loading: true,
    loadError: '',
    list: [],               // подборки
    active: null,           // открытая подборка
    detailLoading: false,
    loadingMore: false,
    movies: [],
    bgPoster: localStorage.getItem('nz_bg_poster') || '',
    _offset: 0,
    _hasMore: false,
    _seenIds: new Set(),
    _scrollObserver: null,
    _prefetched: new Set(),

    async fetchCollections() {
      // Серверный SSR-блок детальной подборки (для краулеров/без-JS) — убираем
      // при гидрации, чтобы Alpine не дублировал карточки.
      this._removeSSR()
      window.addEventListener('popstate', () => this._syncFromUrl())
      // Deep-link /collections/{slug}: сразу показываем детальный вид, без мелькания индекса.
      if (this._slugFromUrl()) this.view = 'detail'
      try {
        const r = await fetch(`${API_BASE}/api/collections`)
        if (!r.ok) throw new Error('upstream ' + r.status)
        const d = await r.json()
        this.list = (d.items || []).map(c => ({ ...c, _covers: [] }))
      } catch (e) {
        console.error(e)
        this.loadError = 'Не удалось загрузить подборки'
      } finally {
        this.loading = false
      }
      // обложка-монтаж: тянем по 3 постера на подборку (best-effort, параллельно)
      this.list.forEach(c => this._loadCovers(c))
      // открыть подборку из URL (deep-link / переход назад-вперёд)
      this._openFromUrl()
    },

    _removeSSR() {
      document.querySelectorAll('[data-ssr-cleanup]').forEach(el => el.remove())
    },

    // slug из чистого пути /collections/{slug} или из ?slug=/?collection=
    _slugFromUrl() {
      const m = location.pathname.match(/^\/collections\/([^/]+)\/?$/)
      if (m) return decodeURIComponent(m[1])
      const q = new URLSearchParams(location.search)
      return q.get('slug') || q.get('collection') || ''
    },

    _openFromUrl() {
      const slug = this._slugFromUrl()
      if (!slug) return
      const c = (this.list || []).find(x => x.slug === slug)
      if (c) this.open(c, { fromUrl: true })
      else this._backToIndex() // неизвестный slug — показываем индекс
    },

    // Синхронизация при кнопках назад/вперёд браузера
    _syncFromUrl() {
      const slug = this._slugFromUrl()
      if (slug) {
        if (this.view === 'detail' && this.active && this.active.slug === slug) return
        const c = (this.list || []).find(x => x.slug === slug)
        if (c) this.open(c, { fromUrl: true })
      } else if (this.view !== 'index') {
        this._backToIndex()
      }
    },

    async _loadCovers(c) {
      try {
        const r = await fetch(`${API_BASE}/api/collections/${encodeURIComponent(c.slug)}?limit=3&offset=0`)
        if (!r.ok) return
        const d = await r.json()
        const posters = (d.items || [])
          .map(m => m.poster_kp || m.poster_tmdb || m.poster_imdb)
          .filter(Boolean)
          .slice(0, 3)
          .map(p => posterUrl(_previewPoster(p)))
        if (posters.length) c._covers = posters
      } catch {}
    },

    covers(c) {
      if (c._covers && c._covers.length) return c._covers
      return c.poster_url ? [API_BASE + '/proxy/poster?url=' + encodeURIComponent(c.poster_url)] : []
    },

    async open(c, opts = {}) {
      this._removeSSR()
      this._cleanupScroll()
      this.active = c
      this.view = 'detail'
      // Чистый URL подборки (кроме случая, когда мы и так пришли по этому URL)
      if (!opts.fromUrl) {
        try { history.pushState({ collection: c.slug }, '', '/collections/' + encodeURIComponent(c.slug)) } catch {}
      }
      this.movies = []
      this._offset = 0
      this._hasMore = false
      this._seenIds = new Set()
      this.detailLoading = true
      window.scrollTo(0, 0)
      try {
        const r = await fetch(`${API_BASE}/api/collections/${encodeURIComponent(c.slug)}?limit=50&offset=0`)
        if (!r.ok) throw new Error('upstream ' + r.status)
        const d = await r.json()
        this.movies = this._dedup((d.items || []).map(normalizeStub))
        this._offset = 50
        this._hasMore = !!d.has_more
        if (this.movies.length) this._setBg(this.movies[0])
      } catch (e) {
        console.error(e)
        this.movies = []
      } finally {
        this.detailLoading = false
      }
      if (this._hasMore) setTimeout(() => this._setupScroll(), 0)
    },

    async _loadMore() {
      if (this.loadingMore || !this._hasMore) return
      this.loadingMore = true
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 12000)
      try {
        const r = await fetch(`${API_BASE}/api/collections/${encodeURIComponent(this.active.slug)}?limit=50&offset=${this._offset}`, { signal: ctrl.signal })
        clearTimeout(timer)
        if (!r.ok) throw new Error('upstream ' + r.status)
        const d = await r.json()
        this._offset += 50
        this._hasMore = !!d.has_more
        const next = this._dedup((d.items || []).map(normalizeStub))
        if (next.length) { this.prefetchPosters(next); this.movies.push(...next) }
      } catch {
        clearTimeout(timer)
        // транзиентная ошибка — не помечаем done, дадим повторить при следующем скролле
      } finally {
        this.loadingMore = false
        if (!this._hasMore) this._cleanupScroll()
        else requestAnimationFrame(() => this._checkFill())
      }
    },

    // Догрузка до заполнения экрана: IntersectionObserver срабатывает только на
    // смену видимости sentinel — если он остаётся в зоне 800px, события нет.
    _checkFill() {
      if (this.loadingMore || !this._hasMore) return
      const s = document.getElementById('scroll-sentinel')
      if (s && s.getBoundingClientRect().top <= window.innerHeight + 800) this._loadMore()
    },

    // Дедуп карточек по kp_id (KP-подборки отдают дубли)
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

    prefetchPosters(movies) {
      for (let i = 0; i < Math.min(movies.length, 20); i++) {
        const src = this.posterFor(movies[i])
        if (src) { const img = new Image(); img.src = src }
      }
    },

    _setupScroll() {
      this._cleanupScroll()
      if (typeof IntersectionObserver === 'undefined') return
      const sentinel = document.getElementById('scroll-sentinel')
      if (!sentinel) return
      this._scrollObserver = new IntersectionObserver(entries => {
        if (entries[0].isIntersecting && !this.loadingMore && this._hasMore) this._loadMore()
      }, { rootMargin: '800px' })
      this._scrollObserver.observe(sentinel)
      requestAnimationFrame(() => this._checkFill())
    },

    _cleanupScroll() {
      if (this._scrollObserver) { this._scrollObserver.disconnect(); this._scrollObserver = null }
    },

    back() {
      this._backToIndex()
      try { history.pushState(null, '', '/collections') } catch {}
    },

    _backToIndex() {
      this._cleanupScroll()
      this.view = 'index'
      this.active = null
      this.movies = []
      this._hasMore = false
      window.scrollTo(0, 0)
    },

    // ── Карточка фильма ──────────────────────────────────
    posterFor(m) {
      return posterUrl(m.posterUrlPreview || m.posterUrl)
    },
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
    movieType(m) {
      return KIND_LABELS_C[m.kind] || ''
    },
    origTitle(m) {
      const orig = m.nameOriginal || m.nameEn || ''
      return orig && orig !== (m.nameRu || '') ? orig : ''
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
