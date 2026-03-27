// Alpine.js component for the main page.
// Depends on API_BASE defined in api.js.
function app() {
  return {
    // ── State ──────────────────────────────────────────────
    query:       '',
    searchType:  'top',
    movies:      [],
    loading:     true,
    totalPages:  1,
    currentPage: 1,

    // suggestions
    suggestions:        [],
    showSuggestions:    false,
    suggestionsLoading: false,
    highlightedIndex:   -1,
    _suggestAbort:      null,

    // ── Init ───────────────────────────────────────────────
    init() {
      this.fetchTop()
    },

    // ── Helpers ────────────────────────────────────────────
    movieType(movie) {
      switch (movie.type) {
        case 'TV_SERIES':
        case 'MINI_SERIES': return 'Сериал'
        case 'TV_SHOW':     return 'Шоу'
        case 'FILM':        return 'Фильм'
        default:            return movie.type ? 'Фильм' : ''
      }
    },

    // ── Suggestions ────────────────────────────────────────
    async fetchSuggestions() {
      const q = this.query.trim()
      if (!q) {
        this.suggestions    = []
        this.showSuggestions = false
        return
      }

      if (this._suggestAbort) this._suggestAbort.abort()
      this._suggestAbort      = new AbortController()
      this.suggestionsLoading = true
      this.highlightedIndex   = -1

      try {
        const r = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(q)}&page=1`, {
          signal: this._suggestAbort.signal,
        })
        if (!r.ok) throw new Error('status ' + r.status)
        const data = await r.json()
        this.suggestions    = (data.movies || []).slice(0, 7)
        this.showSuggestions = this.suggestions.length > 0
      } catch (e) {
        if (e.name !== 'AbortError') console.error('suggestions:', e)
      } finally {
        this.suggestionsLoading = false
      }
    },

    closeSuggestions() {
      this.showSuggestions  = false
      this.highlightedIndex = -1
    },

    selectSuggestion(movie) {
      this.query = movie.nameRu || movie.nameEn || ''
      this.closeSuggestions()
      this.onSearch()
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

    // ── Search ─────────────────────────────────────────────
    onSearch() {
      if (!this.query.trim()) return this.fetchTop()
      this.searchType  = 'name'
      this.currentPage = 1
      this.search()
    },

    async search() {
      this.loading = true
      try {
        const r = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(this.query.trim())}&page=${this.currentPage}`)
        if (!r.ok) throw new Error('API error ' + r.status)
        const data  = await r.json()
        this.movies     = data.movies || []
        this.totalPages = data.totalPages || 1
      } catch (e) {
        console.error('search:', e)
        this.movies = []
      } finally {
        this.loading = false
      }
    },

    async fetchTop() {
      this.searchType      = 'top'
      this.currentPage     = 1
      this.query           = ''
      this.suggestions     = []
      this.showSuggestions = false
      this.loading         = true
      try {
        const r = await fetch(`${API_BASE}/api/top?page=1`)
        if (!r.ok) throw new Error('API error ' + r.status)
        const data  = await r.json()
        this.movies     = Array.isArray(data) ? data : []
        this.totalPages = 1
      } catch (e) {
        console.error('fetchTop:', e)
        this.movies = []
      } finally {
        this.loading = false
      }
    },

    async fetchRandom() {
      this.searchType = 'random'
      this.loading    = true
      this.closeSuggestions()
      try {
        const page = Math.floor(Math.random() * 5) + 1
        const r    = await fetch(`${API_BASE}/api/top?page=` + page)
        if (!r.ok) throw new Error('API error ' + r.status)
        const data = await r.json()
        const arr  = Array.isArray(data) ? data : []
        this.movies     = arr.length ? [arr[Math.floor(Math.random() * arr.length)]] : []
        this.totalPages = 1
      } catch (e) {
        console.error('fetchRandom:', e)
        this.movies = []
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
