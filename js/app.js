
function app() {
  return {
    query: '',
    searchType: 'top',
    movies: [],
    searched: false,
    loading: true,
    totalPages: 1,
    currentPage: 1,
    bgPoster: localStorage.getItem('nz_bg_poster') || '',
    _topPage: 1,
    _topDone: false,
    _topLoading: false,
    _searchLoading: false,
    _prefetched: new Set(),

    suggestions: [],
    showSuggestions: false,
    suggestionsLoading: false,
    highlightedIndex: -1,
    _suggestAbort: null,

    history: [],

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
      const id = movie.kinopoiskId || movie.filmId
      if (!id) return
      const href = 'movie.html?id=' + id
      if (this._prefetched.has(href)) return
      this._prefetched.add(href)
      document.head.insertAdjacentHTML('beforeend', `<link rel="prefetch" href="${href}">`)
    },

    onCardEnter(movie) {
      if (Settings.get().bgPosterHover) {
        this._setBgPoster(posterUrl(movie.posterUrlPreview || movie.posterUrl))
      }
      this.prefetch(movie)
    },

    origTitle(movie) {
      const orig = movie.nameEn || movie.nameOriginal || ''
      return (orig && orig !== movie.nameRu) ? orig : ''
    },

    ratingBg(r) {
      if (r >= 7.0) return '#27ae60'
      if (r < 5.0)  return '#e74c3c'
      return '#7f8c8d'
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
        this.movies = []
        this.searched = false
        this.totalPages = 1
        this.currentPage = 1
      }
    },

    async fetchSuggestions() {
      const q = this.query.trim()
      if (!q) {
        this.suggestions = []
        this.showSuggestions = false
        return
      }

      if (this._suggestAbort) this._suggestAbort.abort()
      this._suggestAbort = new AbortController()
      this.suggestionsLoading = true
      this.highlightedIndex = -1

      try {
        const r = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(q)}&page=1`, {
          signal: this._suggestAbort.signal,
        })
        if (!r.ok) throw new Error('status ' + r.status)
        const data = await r.json()
        this.suggestions = (data.movies || []).slice(0, 7)
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
      window.location.href = 'movie.html?id=' + (movie.kinopoiskId || movie.filmId)
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
      this.currentPage = 1
      this.search()
    },

    async search() {
      if (this._scrollObserver) { this._scrollObserver.disconnect(); this._scrollObserver = null }
      this.searched = true
      this.loading = true
      try {
        const q = encodeURIComponent(this.query.trim())
        const [r1, r2] = await Promise.all([
          fetch(`${API_BASE}/api/search?q=${q}&page=1`),
          fetch(`${API_BASE}/api/search?q=${q}&page=2`),
        ])
        if (!r1.ok) throw new Error('upstream ' + r1.status)
        const d1 = await r1.json()
        this.totalPages = d1.totalPages || 1
        const movies1 = d1.movies || []
        let movies2 = []
        if (this.totalPages > 1) {
          try { if (r2.ok) movies2 = (await r2.json()).movies || [] } catch {}
        }
        this.movies = [...movies1, ...movies2]
        this.currentPage = Math.min(2, this.totalPages)
      } catch (e) {
        console.error(e)
        this.movies = []
      } finally {
        this.loading = false
      }
      this.prefetchPosters(this.movies)
      setTimeout(() => this.initSearchScroll(), 0)
    },

    initSearchScroll() {
      if (this.currentPage >= this.totalPages) return
      const sentinel = document.getElementById('scroll-sentinel')
      if (!sentinel) return
      this._scrollObserver = new IntersectionObserver(async entries => {
        if (!entries[0].isIntersecting || this._searchLoading || this.currentPage >= this.totalPages) return
        this._searchLoading = true
        this.currentPage++
        try {
          const r = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(this.query.trim())}&page=${this.currentPage}`)
          if (!r.ok) throw new Error()
          const data = await r.json()
          const next = data.movies || []
          this.prefetchPosters(next)
          this.movies.push(...next)
        } catch {
          this.currentPage = this.totalPages
        } finally {
          this._searchLoading = false
        }
        if (this.currentPage >= this.totalPages) {
          this._scrollObserver.disconnect()
          this._scrollObserver = null
        }
      }, { rootMargin: '2000px' })
      this._scrollObserver.observe(sentinel)
    },

    prefetchPosters(movies) {
      for (const movie of movies) {
        const url = movie.posterUrlPreview || movie.posterUrl
        if (url) {
          const img = new Image()
          img.src = posterUrl(url)
        }
      }
    },

    async fetchTop() {
      if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
      this.searchType = 'top'
      this.currentPage = 1
      this.totalPages = 1
      this.query = ''
      this.suggestions = []
      this.showSuggestions = false
      this._topPage = 2
      this._topDone = false
      this.loading = true
      try {
        const [r1, r2, r3, r4] = await Promise.all([
          fetch(`${API_BASE}/api/top?page=1`),
          fetch(`${API_BASE}/api/top?page=2`),
          fetch(`${API_BASE}/api/top?page=3`),
          fetch(`${API_BASE}/api/top?page=4`),
        ])
        if (!r1.ok) throw new Error('upstream ' + r1.status)
        const d1 = await r1.json()
        let d2 = [], d3 = [], d4 = []
        try { if (r2.ok) d2 = await r2.json() } catch {}
        try { if (r3.ok) d3 = await r3.json() } catch {}
        try { if (r4.ok) d4 = await r4.json() } catch {}
        this.movies = [
          ...(Array.isArray(d1) ? d1 : []),
          ...(Array.isArray(d2) ? d2 : []),
          ...(Array.isArray(d3) ? d3 : []),
          ...(Array.isArray(d4) ? d4 : []),
        ]
        this._topPage = 4
      } catch (e) {
        console.error(e)
        this.movies = []
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
      if (this._scrollObserver) this._scrollObserver.disconnect()
      const sentinel = document.getElementById('scroll-sentinel')
      if (!sentinel) return
      this._scrollObserver = new IntersectionObserver(async entries => {
        if (!entries[0].isIntersecting || this._topLoading || this._topDone) return
        this._topLoading = true
        this._scrollObserver.unobserve(sentinel)
        const nextPage = this._topPage + 1
        try {
          const [r1, r2] = await Promise.all([
            fetch(`${API_BASE}/api/top?page=${nextPage}`),
            fetch(`${API_BASE}/api/top?page=${nextPage + 1}`),
          ])
          this._topPage = nextPage + 1
          const d1 = r1.ok ? await r1.json() : []
          const d2 = r2.ok ? await r2.json() : []
          const next = [...(Array.isArray(d1) ? d1 : []), ...(Array.isArray(d2) ? d2 : [])]
          if (next.length === 0) {
            this._topDone = true
          } else {
            this.prefetchPosters(next)
            this.movies.push(...next)
          }
        } catch {
          this._topDone = true
        } finally {
          this._topLoading = false
          if (!this._topDone) this._scrollObserver.observe(sentinel)
        }
      }, { rootMargin: '2000px' })
      this._scrollObserver.observe(sentinel)
    },

    async fetchRandom() {
      this.loading = true
      this.closeSuggestions()
      try {
        const page = Math.floor(Math.random() * 5) + 1
        const r = await fetch(`${API_BASE}/api/top?page=` + page)
        if (!r.ok) throw new Error('API error ' + r.status)
        const data = await r.json()
        const arr = Array.isArray(data) ? data : []
        if (arr.length) {
          const movie = arr[Math.floor(Math.random() * arr.length)]
          window.location.href = 'movie.html?id=' + (movie.kinopoiskId || movie.filmId)
        }
      } catch (e) {
        console.error(e)
      } finally {
        this.loading = false
      }
    },

  }
}
