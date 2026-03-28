function app() {
  return {
    query: '',
    searchType: 'top',
    movies: [],
    loading: true,
    totalPages: 1,
    currentPage: 1,
    bgPoster: '',
    _topPage: 1,
    _topDone: false,
    _topLoading: false,

    suggestions: [],
    showSuggestions: false,
    suggestionsLoading: false,
    highlightedIndex: -1,
    _suggestAbort: null,

    init() {
      this.searchType = 'name'
      this.loading = false
    },

    prefetch(movie) {
      const id = movie.kinopoiskId || movie.filmId
      if (!id) return
      const href = 'movie.html?id=' + id
      if (!document.head.querySelector(`link[rel="prefetch"][href="${href}"]`)) {
        document.head.insertAdjacentHTML('beforeend', `<link rel="prefetch" href="${href}">`)
      }
    },

    onCardEnter(movie) {
      this.bgPoster = posterUrl(movie.posterUrlPreview || movie.posterUrl)
      this.prefetch(movie)
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
      if (this.query.trim()) {
        this.loading = true
      }
      await this.fetchSuggestions()
      if (this.query.trim()) {
        this.searchType = 'name'
        this.currentPage = 1
        await this.search()
      } else {
        this.movies = []
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
      this.loading = true
      try {
        const r = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(this.query.trim())}&page=${this.currentPage}`)
        if (!r.ok) throw new Error('API error ' + r.status)
        const data = await r.json()
        this.movies = data.movies || []
        this.totalPages = data.totalPages || 1
      } catch (e) {
        console.error(e)
        this.movies = []
      } finally {
        this.loading = false
      }
    },

    async fetchTop() {
      this.searchType = 'top'
      this.currentPage = 1
      this.totalPages = 1
      this.query = ''
      this.suggestions = []
      this.showSuggestions = false
      this._topPage = 1
      this._topDone = false
      this.loading = true
      try {
        const r = await fetch(`${API_BASE}/api/top?page=1`)
        if (!r.ok) throw new Error('API error ' + r.status)
        const data = await r.json()
        this.movies = Array.isArray(data) ? data : []
      } catch (e) {
        console.error(e)
        this.movies = []
      } finally {
        this.loading = false
      }
      this.$nextTick(() => this.initTopScroll())
    },

    initTopScroll() {
      if (this._scrollObserver) this._scrollObserver.disconnect()
      const sentinel = document.getElementById('scroll-sentinel')
      if (!sentinel) return
      this._scrollObserver = new IntersectionObserver(async entries => {
        if (!entries[0].isIntersecting || this._topLoading || this._topDone) return
        this._topLoading = true
        this._topPage++
        try {
          const r = await fetch(`${API_BASE}/api/top?page=${this._topPage}`)
          if (!r.ok) throw new Error()
          const data = await r.json()
          const next = Array.isArray(data) ? data : []
          if (next.length === 0) {
            this._topDone = true
          } else {
            this.movies = [...this.movies, ...next]
          }
        } catch {
          this._topDone = true
        } finally {
          this._topLoading = false
        }
      }, { rootMargin: '200px' })
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

    async prevPage() {
      if (this.currentPage > 1) {
        this.currentPage--
        await this.search()
      }
    },

    async nextPage() {
      if (this.currentPage < this.totalPages) {
        this.currentPage++
        await this.search()
      }
    },
  }
}
