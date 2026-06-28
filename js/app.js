
function app() {
  return {
    query: '',
    searchType: 'top',
    movies: [],
    searched: false,
    loading: true,
    loadError: '',
    bgPoster: localStorage.getItem('nz_bg_poster') || '',
    _topPage: 0,
    _topDone: false,
    _topLoading: false,
    _searchPage: 1,
    _searchHasMore: false,
    _searchLoading: false,
    _prefetched: new Set(),
    _seenIds: new Set(),

    // ── Анимация плейсхолдера строки поиска (печатающийся текст) ──
    animatedPlaceholder: 'Поиск фильмов и сериалов…',
    _phTimer: null,
    _phWords: ['Матрица', 'Интерстеллар', 'Начало', 'Зелёная миля', 'Побег из Шоушенка',
               'Бойцовский клуб', 'Форрест Гамп', 'Тёмный рыцарь', 'Гладиатор', 'Властелин колец'],

    _startPlaceholderAnim() {
      if (this._phTimer) return
      const prefix = ''
      let wi = 0, ci = 0, deleting = false
      const tick = () => {
        const word = this._phWords[wi]
        if (!deleting) {
          ci++
          this.animatedPlaceholder = prefix + word.slice(0, ci)
          if (ci >= word.length) { deleting = true; this._phTimer = setTimeout(tick, 1500); return }
        } else {
          ci--
          this.animatedPlaceholder = prefix + word.slice(0, ci)
          if (ci <= 0) { deleting = false; wi = (wi + 1) % this._phWords.length; this._phTimer = setTimeout(tick, 450); return }
        }
        this._phTimer = setTimeout(tick, deleting ? 45 : 95)
      }
      this._phTimer = setTimeout(tick, 700)
    },

    // ── Фильтры (Discover) ──────────────────────────────────
    filterOpen: false,
    filtersMeta: { genres: [], kinds: [], regions: [], yearMax: 2031 },
    filters: { kind: '', genres: [], yearFrom: '', yearTo: '', ratingMin: 0, region: '', sort: 'popularity', order: 'desc' },
    appliedFilters: null,            // снимок применённых фильтров (для тегов и пагинации)
    _filtersMetaLoaded: false,
    _discoverOffset: 0,
    _discoverDone: false,
    _discoverLoading: false,

    get filterCount() {
      const f = this.filters
      let n = f.genres.length
      if (f.kind) n++
      if (f.yearFrom) n++
      if (f.yearTo) n++
      if (f.ratingMin) n++
      if (f.region) n++
      return n
    },

    get appliedTags() {
      const a = this.appliedFilters
      if (!a) return []
      const tags = []
      if (a.kind) {
        const k = this.filtersMeta.kinds.find(x => x.value === a.kind)
        tags.push({ key: 'kind', kind: 'kind', label: k ? k.label_ru : a.kind })
      }
      a.genres.forEach(slug => {
        const g = this.filtersMeta.genres.find(x => x.slug === slug)
        tags.push({ key: 'g_' + slug, kind: 'genre', slug, label: g ? g.name_ru : slug })
      })
      if (a.yearFrom || a.yearTo) tags.push({ key: 'year', kind: 'year', label: (a.yearFrom || '…') + '–' + (a.yearTo || '…') })
      if (a.ratingMin) tags.push({ key: 'rating', kind: 'rating', label: '★ ' + a.ratingMin + '+' })
      if (a.region) {
        const rg = this.filtersMeta.regions.find(x => x.slug === a.region)
        tags.push({ key: 'region', kind: 'region', label: rg ? rg.name_ru : a.region })
      }
      return tags
    },

    suggestions: [],
    showSuggestions: false,
    suggestionsLoading: false,
    highlightedIndex: -1,
    _suggestAbort: null,

    history: [],

    _dedup(movies) {
      return movies.filter(m => {
        const id = m.kinopoiskId || m.filmId
        if (!id || this._seenIds.has(id)) return false
        this._seenIds.add(id)
        return true
      })
    },

    _loadHistory() {
      this.history = (typeof historyGet === 'function' ? historyGet() : [])
        .map(m => ({ ...m, _isHistory: true }))
    },

    _setBgPoster(url) {
      this.bgPoster = url
      if (url) localStorage.setItem('nz_bg_poster', url)
    },

    init() {
      this.searchType = 'name'
      this.loading = false
      this._loadHistory()
      if (this.history.length > 0) {
        const first = this.history[0]
        this._setBgPoster(posterUrl(first.posterUrlPreview || first.posterUrl))
      }
      this._startPlaceholderAnim()
    },

    clearHistory() {
      historyClear()
      this.history = []
    },

    removeFromHistory(id) {
      historyRemove(id)
      this._loadHistory()
    },

    prefetch(movie) {
      // На GitHub Pages /movie/{id} отдаёт 404.html как SPA-shell — GitHub Pages не умеет
      // отвечать 200 на эти пути. Chrome логирует SW-внутренний запрос к серверу (404)
      // в консоль вне зависимости от того, что SW вернул клиенту. SW кеширует shell при
      // первой реальной навигации, поэтому prefetch здесь ничего не даёт.
      if (location.hostname.endsWith('github.io')) return
      const id = movie.kinopoiskId || movie.filmId
      if (!id) return
      const href = '/movie/' + id
      if (this._prefetched.has(href)) return
      this._prefetched.add(href)
      fetch(href, { credentials: 'omit' }).catch(() => {})
    },

    onCardEnter(movie) {
      if (Settings.get().bgPosterHover) {
        this._setBgPoster(posterUrl(movie.posterUrlPreview || movie.posterUrl))
      }
      this.prefetch(movie)
    },

    origTitle(movie) {
      const title = movie.nameRu || movie.nameEn || movie.nameOriginal || ''
      const orig = movie.nameEn || movie.nameOriginal || ''
      return (orig && orig !== title) ? orig : ''
    },

    // Канонический URL постера Кинопоиска по id. КП в списках (top/премьеры) часто
    // отдаёт no-poster.png, хотя постер существует по этому пути (детальная его показывает).
    _kpPoster(movie, size) {
      const id = movie.kinopoiskId || movie.filmId
      return id ? `https://kinopoiskapiunofficial.tech/images/posters/${size}/${id}.jpg` : ''
    },

    // Лучший URL постера для карточки: реальный из API, либо реконструкция по id,
    // если список вернул no-poster.png (или поле пустое).
    posterFor(movie) {
      const url = movie.posterUrlPreview || movie.posterUrl || ''
      if (!url || url.includes('no-poster')) return posterUrl(this._kpPoster(movie, 'kp_small'))
      return posterUrl(url)
    },

    posterInit(el) {
      // постер мог уже загрузиться из кеша (prefetchPosters / повторный показ) ещё до
      // навешивания @load — тогда событие load не придёт и класс .loaded не добавится.
      // Проверяем complete вручную, иначе картинка останется opacity:0 (невидимой).
      this.$nextTick(() => {
        if (el.complete && el.naturalWidth > 0) el.classList.add('loaded')
      })
    },

    posterError(el, movie) {
      el.classList.add('loaded')
      // превью (kp_small) могло не загрузиться — один раз пробуем полный постер по
      // каноническому пути (работает и когда список отдал no-poster.png), иначе заглушка
      const full = posterUrl(this._kpPoster(movie, 'kp'))
      if (!el.dataset.posterRetried && full !== PLACEHOLDER && el.src !== full) {
        el.dataset.posterRetried = '1'
        el.src = full
      } else {
        el.src = PLACEHOLDER
      }
    },

    ratingBg(r) {
      if (r >= 7.0) return '#27ae60'
      if (r < 5.0)  return '#e74c3c'
      return '#7f8c8d'
    },

    // Лучшая доступная оценка для бейджа карточки: КП → IMDb → TMDb. Пропускаем
    // оценки, округляющиеся до 0.0 (<0.05) — иначе бейдж показывал бы «0.0». 0 = нет оценки.
    cardRating(m) {
      for (const v of [m.ratingKinopoisk, m.ratingImdb, m.ratingTmdb]) {
        const n = +v || 0
        if (n >= 0.05) return n
      }
      return 0
    },

    movieType(movie) {
      switch (movie.type) {
        case 'TV_SERIES':
        case 'MINI_SERIES': return 'Сериал'
        case 'TV_SHOW': return 'Шоу'
        case 'FILM': return 'Фильм'
        default: return movie.type ? 'Фильм' : ''
      }
    },

    async onInput() {
      await this.fetchSuggestions()
      if (!this.query.trim()) {
        this.searched = false
        this._searchHasMore = false
        // Чистим только результаты поиска по названию. Сетку «Популярное»/discover
        // НЕ затираем — иначе очистка поля поиска ломает грид (и observer его перезагружает).
        if (this.searchType === 'name') this.movies = []
      }
    },

    async fetchSuggestions() {
      const q = this.query.trim()
      if (!q) {
        this.suggestions = []
        this.showSuggestions = false
        return
      }
      // После применённого поиска (Enter) дебаунс-инпут от последнего символа может
      // сработать уже ПОСЛЕ commitSearch и заново открыть дропдаун. Для только что
      // применённого запроса не переоткрываем подсказки.
      if (q === this._committedQuery) {
        this.suggestions = []
        this.showSuggestions = false
        return
      }

      if (this._suggestAbort) this._suggestAbort.abort()
      this._suggestAbort = new AbortController()
      this.suggestionsLoading = true
      this.highlightedIndex = -1

      try {
        // Тот же эндпоинт, что и сетка (/api/search), чтобы дропдаун был превью
        // результатов сетки — порядок и состав совпадают. /api/suggest давал
        // другое ранжирование → дропдаун и сетка расходились.
        const r = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(q)}&page=1`, {
          signal: this._suggestAbort.signal,
        })
        if (!r.ok) throw new Error('status ' + r.status)
        const data = await r.json()
        this.suggestions = (data.items || []).slice(0, 7).map(normalizeStub)
        this.showSuggestions = this.suggestions.length > 0
      } catch (e) {
        if (e.name !== 'AbortError') console.error(e)
      } finally {
        this.suggestionsLoading = false
      }
    },

    closeSuggestions() {
      this.showSuggestions = false
      this.highlightedIndex = -1
    },

    selectSuggestion(movie) {
      window.location.href = '/movie/' + (movie.kinopoiskId || movie.filmId)
    },

    highlightNext() {
      if (this.showSuggestions)
        this.highlightedIndex = Math.min(this.highlightedIndex + 1, this.suggestions.length - 1)
    },

    highlightPrev() {
      if (this.showSuggestions)
        this.highlightedIndex = Math.max(this.highlightedIndex - 1, -1)
    },

    commitSearch() {
      const picked = this.suggestions[this.highlightedIndex]
      if (this.highlightedIndex >= 0 && picked) {
        this.selectSuggestion(picked)
      } else {
        this.closeSuggestions()
        this.onSearch()
      }
    },

    onSearch() {
      if (!this.query.trim()) return this.fetchTop()
      this.searchType = 'name'
      this.search()
    },

    _scrollCleanup() {
      if (this._scrollObserver) { this._scrollObserver.disconnect(); this._scrollObserver = null }
      if (this._scrollHandler) { window.removeEventListener('scroll', this._scrollHandler); this._scrollHandler = null }
    },

    async search() {
      if (this.loading) return
      this._committedQuery = this.query.trim()  // подавляем переоткрытие подсказок для этого запроса
      this._scrollCleanup()
      this.searched = true
      this.loading = true
      this._searchPage = 1
      try {
        const q = encodeURIComponent(this.query.trim())
        const r1 = await fetch(`${API_BASE}/api/search?q=${q}&page=1`)
        if (!r1.ok) throw new Error('upstream ' + r1.status)
        const d1 = await r1.json()
        this._searchHasMore = !!d1.has_more
        this.movies = (d1.items || []).map(normalizeStub)
      } catch (e) {
        console.error(e)
        this.movies = []
        this._searchHasMore = false
      } finally {
        this.loading = false
      }
      this.prefetchPosters(this.movies)
      setTimeout(() => this.initSearchScroll(), 0)
    },

    initSearchScroll() {
      this._scrollCleanup()
      if (!this._searchHasMore) return
      const check = () => {
        if (this._searchLoading || !this._searchHasMore) return
        if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 800) {
          this._loadMoreSearch()
        }
      }
      this._scrollHandler = check
      window.addEventListener('scroll', this._scrollHandler, { passive: true })
    },

    async _loadMoreSearch() {
      this._searchLoading = true
      this._searchPage++
      try {
        const r = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(this.query.trim())}&page=${this._searchPage}`)
        if (!r.ok) throw new Error()
        const data = await r.json()
        this._searchHasMore = !!data.has_more
        const next = (data.items || []).map(normalizeStub)
        this.prefetchPosters(next)
        this.movies.push(...next)
      } catch {
        this._searchHasMore = false
      } finally {
        this._searchLoading = false
        if (!this._searchHasMore) this._scrollCleanup()
      }
    },

    prefetchPosters(movies) {
      const limit = 20
      for (let i = 0; i < Math.min(movies.length, limit); i++) {
        const src = this.posterFor(movies[i])
        if (src) {
          const img = new Image()
          img.src = src
        }
      }
    },

    async fetchTop() {
      if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
      // Снять активный observer/scroll-handler СРАЗУ, до await. Иначе стейл-триггер
      // от предыдущего режима (discover) может сработать во время загрузки — пока
      // грид скрыт (loading), sentinel в зоне 800px — и вызвать гонку дозагрузки,
      // которая ломает _seenIds/_discoverOffset.
      this._scrollCleanup()
      this.searchType = 'top'
      this.query = ''
      this.suggestions = []
      this.showSuggestions = false
      this._topPage = 0
      this._topDone = false
      this._seenIds = new Set()
      this.loading = true
      const ctrl = new AbortController()
      const _timer = setTimeout(() => ctrl.abort(), 10000)
      try {
        const [r1, r2] = await Promise.all([
          fetch(`${API_BASE}/api/top?page=1`, { signal: ctrl.signal }),
          fetch(`${API_BASE}/api/top?page=2`, { signal: ctrl.signal }),
        ])
        clearTimeout(_timer)
        if (!r1.ok) throw new Error('upstream ' + r1.status)
        const d1 = await r1.json()
        let d2 = {}
        try { if (r2.ok) d2 = await r2.json() } catch {}
        this.movies = this._dedup([
          ...(d1.items || []),
          ...(d2.items || []),
        ].map(normalizeStub))
        if (d2.has_more === false) this._topDone = true
        this._topPage = 2
      } catch (e) {
        clearTimeout(_timer)
        console.error(e)
        this.movies = []
        this.loadError = e.name === 'AbortError'
          ? 'Не удалось загрузить — проверьте соединение'
          : 'Ошибка загрузки: ' + (e.message || e)
      } finally {
        this.loading = false
      }
      if (this.movies.length > 0) {
        const first = this.movies[0]
        this._setBgPoster(posterUrl(first.posterUrlPreview || first.posterUrl))
      }
      this.prefetchPosters(this.movies)
      setTimeout(() => this.initTopScroll(), 0)
    },

    initTopScroll() {
      this._scrollCleanup()
      const discover = this.searchType === 'discover'
      if (discover ? this._discoverDone : this._topDone) return
      if (typeof IntersectionObserver === 'undefined') return
      const sentinel = document.getElementById('scroll-sentinel')
      if (!sentinel) return
      this._scrollObserver = new IntersectionObserver(entries => {
        if (!entries[0].isIntersecting) return
        if (this.searchType === 'discover') {
          if (!this._discoverLoading && !this._discoverDone) this._loadMoreDiscover()
        } else if (!this._topLoading && !this._topDone) {
          this._loadMoreTop()
        }
      }, { rootMargin: '800px' })
      this._scrollObserver.observe(sentinel)
      // Подстраховка: IntersectionObserver иногда не срабатывает на скролл
      // (стейл-состояние при смене top↔discover, гонка с лэйаутом Alpine) — и
      // пагинация «застывает» до обновления страницы. Пассивный scroll-листенер
      // дублирует триггер и гарантированно дозагружает у нижней границы.
      const onScroll = () => {
        const disc = this.searchType === 'discover'
        if (disc ? (this._discoverLoading || this._discoverDone) : (this._topLoading || this._topDone)) return
        if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 800) {
          if (disc) this._loadMoreDiscover()
          else this._loadMoreTop()
        }
      }
      this._scrollHandler = onScroll
      window.addEventListener('scroll', this._scrollHandler, { passive: true })
      // Детерминированная первичная дозагрузка: IntersectionObserver срабатывает
      // только на СМЕНУ видимости sentinel. Если после рендера он сразу в зоне
      // 800px (контент короче вьюпорта / постеры ещё не подняли высоту) — события
      // может не быть, и пагинация «застывает». Проверяем позицию вручную.
      requestAnimationFrame(() => this._checkFill())
    },

    // Догружает, пока sentinel в пределах 800px от низа вьюпорта (заполняет экран).
    // Вызывается после рендера и после каждой догрузки — чинит «застывание»
    // observer'а, когда sentinel остаётся видимым между подгрузками.
    _checkFill() {
      const discover = this.searchType === 'discover'
      if (discover ? this._discoverDone : this._topDone) return
      if (discover ? this._discoverLoading : this._topLoading) return
      const s = document.getElementById('scroll-sentinel')
      if (!s) return
      if (s.getBoundingClientRect().top <= window.innerHeight + 800) {
        if (discover) this._loadMoreDiscover()
        else this._loadMoreTop()
      }
    },

    async _loadMoreTop() {
      if (this._topLoading || this._topDone) return
      this._topLoading = true
      const nextPage = this._topPage + 1
      const ctrl = new AbortController()
      const _timer = setTimeout(() => ctrl.abort(), 10000)
      try {
        const [r1, r2] = await Promise.all([
          fetch(`${API_BASE}/api/top?page=${nextPage}`, { signal: ctrl.signal }),
          fetch(`${API_BASE}/api/top?page=${nextPage + 1}`, { signal: ctrl.signal }),
        ])
        clearTimeout(_timer)
        this._topPage = nextPage + 1
        const d1 = r1.ok ? await r1.json() : {}
        const d2 = r2.ok ? await r2.json() : {}
        const next = this._dedup([...(d1.items || []), ...(d2.items || [])].map(normalizeStub))
        if (next.length === 0 || d2.has_more === false) this._topDone = true
        if (next.length > 0) {
          this.prefetchPosters(next)
          this.movies.push(...next)
        }
      } catch {
        clearTimeout(_timer)
        // Транзиентная ошибка (таймаут/сеть) — НЕ помечаем done, дадим повторить.
      } finally {
        this._topLoading = false
        if (this._topDone) this._scrollCleanup()
        else requestAnimationFrame(() => this._checkFill())
      }
    },

    // ── Фильтры ─────────────────────────────────────────────
    toggleFilters() {
      this.filterOpen = !this.filterOpen
      if (this.filterOpen) this.loadFilterMeta()
    },

    async loadFilterMeta() {
      if (this._filtersMetaLoaded) return
      this._filtersMetaLoaded = true
      try {
        const r = await fetch(`${API_BASE}/api/filters`)
        if (!r.ok) { this._filtersMetaLoaded = false; return }
        const d = await r.json()
        this.filtersMeta = {
          genres: (d.genres || []).slice(0, 24),
          kinds: (d.kinds || []).filter(k => k.value !== 'tv_show'),
          regions: (d.regions || []),
          yearMax: (d.year_range && d.year_range.max) || 2031,
        }
      } catch { this._filtersMetaLoaded = false }
    },

    toggleGenre(slug) {
      const i = this.filters.genres.indexOf(slug)
      if (i >= 0) this.filters.genres.splice(i, 1)
      else this.filters.genres.push(slug)
    },

    resetFilters() {
      this.filters = { kind: '', genres: [], yearFrom: '', yearTo: '', ratingMin: 0, region: '', sort: 'popularity', order: 'desc' }
    },

    clearAllFilters() {
      this.resetFilters()
      this.appliedFilters = null
      this.fetchTop()
    },

    removeTag(tag) {
      if (!this.appliedFilters) return
      if (tag.kind === 'kind') this.appliedFilters.kind = ''
      else if (tag.kind === 'genre') this.appliedFilters.genres = this.appliedFilters.genres.filter(s => s !== tag.slug)
      else if (tag.kind === 'year') { this.appliedFilters.yearFrom = ''; this.appliedFilters.yearTo = '' }
      else if (tag.kind === 'rating') this.appliedFilters.ratingMin = 0
      else if (tag.kind === 'region') this.appliedFilters.region = ''
      this.filters = JSON.parse(JSON.stringify(this.appliedFilters))
      if (this.filterCount === 0) this.clearAllFilters()
      else this.applyFilters()
    },

    _buildDiscoverQuery(offset) {
      const f = this.appliedFilters || this.filters
      const p = new URLSearchParams()
      if (f.kind) p.set('kind', f.kind)
      if (f.genres.length) p.set('genre.all', f.genres.join(','))
      if (f.yearFrom) p.set('year.gte', f.yearFrom)
      if (f.yearTo) p.set('year.lte', f.yearTo)
      if (f.ratingMin) p.set('rating_kp.gte', f.ratingMin)
      if (f.region) p.set('region', f.region)
      p.set('sort', f.sort || 'popularity')
      p.set('order', f.order || 'desc')
      p.set('required', 'kp_id')
      p.set('limit', '24')
      p.set('offset', offset)
      return p.toString()
    },

    async applyFilters() {
      if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
      // КРИТИЧНО: снять стейл-observer/handler от top-режима ДО await. На холодном
      // (медленном) первом применении фильтра грид скрывается (loading=true), sentinel
      // попадает в зону 800px, и ещё живой top-observer срабатывает с searchType==='discover'
      // → вызывает _loadMoreDiscover() параллельно с этим fetch. Две гонящиеся загрузки
      // портят _seenIds/_discoverOffset, итог — «скроллится, но не догружается».
      this._scrollCleanup()
      this.appliedFilters = JSON.parse(JSON.stringify(this.filters))
      this.filterOpen = false
      this.searchType = 'discover'
      this.query = ''
      this.closeSuggestions()
      this._seenIds = new Set()
      this._discoverOffset = 0
      this._discoverDone = false
      // Держим _discoverLoading=true на всё время загрузки: re-entry guard в
      // _loadMoreDiscover() заблокирует любой стрэй-триггер (observer/handler/checkFill),
      // даже если он как-то сработает до setTimeout(initTopScroll). Сбрасываем перед
      // установкой свежего observer.
      this._discoverLoading = true
      this.loading = true
      this.loadError = ''
      try {
        const [r1, r2] = await Promise.all([
          fetch(`${API_BASE}/api/discover?` + this._buildDiscoverQuery(0)),
          fetch(`${API_BASE}/api/discover?` + this._buildDiscoverQuery(24)),
        ])
        if (!r1.ok) throw new Error('discover ' + r1.status)
        const d1 = await r1.json()
        let d2 = {}
        try { if (r2.ok) d2 = await r2.json() } catch {}
        this.movies = this._dedup([...(d1.items || []), ...(d2.items || [])].map(normalizeStub))
        this._discoverOffset = 48
        if (d2.has_more === false || (d1.items || []).length === 0) this._discoverDone = true
        if (!this.movies.length) this.loadError = 'Ничего не найдено по выбранным фильтрам'
      } catch (e) {
        this.movies = []
        this.loadError = 'Ошибка фильтрации: ' + (e.message || e)
      } finally {
        this.loading = false
        this._discoverLoading = false
      }
      if (this.movies.length) this._setBgPoster(posterUrl(this.movies[0].posterUrlPreview || this.movies[0].posterUrl))
      this.prefetchPosters(this.movies)
      setTimeout(() => this.initTopScroll(), 0)
    },

    async _loadMoreDiscover() {
      if (this._discoverLoading || this._discoverDone) return
      this._discoverLoading = true
      const ctrl = new AbortController()
      const _timer = setTimeout(() => ctrl.abort(), 10000)
      try {
        const [r1, r2] = await Promise.all([
          fetch(`${API_BASE}/api/discover?` + this._buildDiscoverQuery(this._discoverOffset), { signal: ctrl.signal }),
          fetch(`${API_BASE}/api/discover?` + this._buildDiscoverQuery(this._discoverOffset + 24), { signal: ctrl.signal }),
        ])
        clearTimeout(_timer)
        const d1 = r1.ok ? await r1.json() : {}
        const d2 = r2.ok ? await r2.json() : {}
        this._discoverOffset += 48
        const next = this._dedup([...(d1.items || []), ...(d2.items || [])].map(normalizeStub))
        if (next.length === 0 || d2.has_more === false) this._discoverDone = true
        if (next.length > 0) {
          this.prefetchPosters(next)
          this.movies.push(...next)
        }
      } catch {
        clearTimeout(_timer)
        // Транзиентная ошибка (таймаут/сеть) — НЕ помечаем done, чтобы скролл
        // мог повторить попытку, когда upstream снова станет доступен.
      } finally {
        this._discoverLoading = false
        if (this._discoverDone) this._scrollCleanup()
        else requestAnimationFrame(() => this._checkFill())
      }
    },

    async fetchRandom() {
      this.loading = true
      this.closeSuggestions()
      try {
        const page = Math.floor(Math.random() * 5) + 1
        const r = await fetch(`${API_BASE}/api/top?page=` + page)
        if (!r.ok) throw new Error('API error ' + r.status)
        const data = await r.json()
        const arr = (data.items || [])
        if (arr.length) {
          const movie = arr[Math.floor(Math.random() * arr.length)]
          window.location.href = '/movie/' + (movie.kp_id || movie.kinopoiskId || movie.filmId)
        }
      } catch (e) {
        console.error(e)
      } finally {
        this.loading = false
      }
    },

  }
}
