// Страница персоны (/person/:id или ?id=). Alpine-компонент personPage().
// Данные: GET /api/person/:id (карточка) + GET /api/person/:id/filmography.

// Поддержка обоих форматов URL: /person/123 (чистый) и ?id=123 (обратная совместимость).
// Чистый URL восстанавливается синхронным инлайн-скриптом в <head> person.html
// (до header.js, чтобы canonical считался от /person/{id}).
const personId = (() => {
  const fromPath = location.pathname.match(/\/person\/(\d+)/)
  return fromPath ? fromPath[1] : new URLSearchParams(location.search).get('id')
})()

// Роли/профессии Kinodata → русские подписи.
const ROLE_LABELS = {
  actor: 'Актёр', director: 'Режиссёр', writer: 'Сценарист', producer: 'Продюсер',
  composer: 'Композитор', operator: 'Оператор', editor: 'Монтажёр',
  design: 'Художник', designer: 'Художник', voice: 'Озвучка',
  himself: 'В роли себя', narrator: 'Рассказчик',
}

const KIND_LABELS = {
  movie: 'Фильм', series: 'Сериал', mini_series: 'Мини-сериал',
  tv_show: 'ТВ-шоу', anime: 'Аниме', cartoon: 'Мультфильм', short: 'Короткометражка',
}

function _yearsWord(n) {
  const a = Math.abs(n) % 100, b = n % 10
  if (a > 10 && a < 20) return 'лет'
  if (b > 1 && b < 5) return 'года'
  if (b === 1) return 'год'
  return 'лет'
}

function personPage() {
  return {
    loading: true,
    loadError: '',
    person: null,
    bgPhoto: '',
    bioOpen: false,
    activeRole: 'all',
    roles: [],            // [{role, count}] — серверные тоталы для пилюль
    _totalCount: 0,       // всего ролей-кредитов (fallback для «Все»)
    _allDistinct: 0,      // уникальных тайтлов в «Все» (после дедупа)
    _cache: {},           // roleKey -> { raw:[], loaded, loading }
    loadingFilmo: true,   // спиннер сетки при загрузке/смене роли
    _prefetched: new Set(),

    async init() {
      if (this._inited) return
      this._inited = true
      if (!personId) { this.loading = false; this.loadError = 'Персона не указана'; return }
      // фильмографию «Все» грузим параллельно с карточкой персоны
      this._ensureRole('all')
      try {
        const r = await fetch(`${API_BASE}/api/person/${personId}`)
        if (r.ok) { const d = await r.json(); this.person = d.person || d || null }
        if (!this.person) { this.loadError = 'Персона не найдена'; return }
        document.title = this.displayName + ' — NaZeleniy'
      } catch (e) {
        console.error(e); this.loadError = 'Ошибка загрузки'
      } finally {
        this.loading = false
      }
    },

    // Лениво грузит ВСЕ страницы фильмографии для роли (role='all' → без фильтра).
    // Кнопки ролей дёргают серверный ?role=, а не фильтруют уже загруженное:
    // иначе роли, которых не было в подгруженных страницах «Все», были бы пустыми.
    // Бэкенд капает страницу на 50 → листаем по offset до has_more=false.
    async _ensureRole(role) {
      const cur = this._cache[role]
      if (cur && (cur.loaded || cur.loading)) return
      this._cache[role] = { raw: [], loaded: false, loading: true }
      if (this.activeRole === role) this.loadingFilmo = true
      const roleParam = role === 'all' ? '' : '&role=' + encodeURIComponent(role)
      const LIMIT = 50, MAX_PAGES = 40
      const fetchPage = async (offset) => {
        try {
          const r = await fetch(`${API_BASE}/api/person/${personId}/filmography?sort=year&limit=${LIMIT}&offset=${offset}${roleParam}`)
          if (!r.ok) return null
          return await r.json()
        } catch { return null }
      }
      // Первую страницу ждём отдельно — из неё берём count/roles и можем
      // распараллелить остаток, а не листать has_more водопадом.
      const first = await fetchPage(0)
      if (first) {
        this._cache[role].raw.push(...(first.items || []))
        if (role === 'all') {
          this.roles = (first.roles || []).filter(x => x.count > 0)
          this._totalCount = first.count || 0
        }
        if (this.activeRole === role) this.loadingFilmo = false   // первая страница пришла
        // count — верхняя граница; лишние страницы вернут пусто, это безвредно.
        const total = first.count || 0
        const pages = Math.min(Math.ceil(total / LIMIT), MAX_PAGES)
        if (first.has_more && pages > 1) {
          const rest = []
          for (let p = 1; p < pages; p++) rest.push(fetchPage(p * LIMIT))
          const results = await Promise.all(rest)
          // Сохраняем порядок страниц (sort=year), пропуская пустые/упавшие.
          for (const f of results) {
            if (f && f.items) this._cache[role].raw.push(...f.items)
          }
        }
      }
      this._cache[role].loaded = true
      this._cache[role].loading = false
      if (this.activeRole === role) this.loadingFilmo = false
      if (role === 'all') {
        const distinct = this._dedupeAll(this._cache.all.raw)
        this._allDistinct = distinct.length
        // Серверные count по ролям бывают завышены (отдаёт count=93, а реально
        // присылает 84 уникальных тайтла) — из-за чего «Всего» оказывался меньше
        // отдельной роли. Пересчитываем счётчики пилюль из фактически загруженных
        // уникальных тайтлов: тогда «Всего» ≥ любой роли, и числа совпадают с сеткой.
        const roleCount = {}
        distinct.forEach(m => (m._roleKeys || [m.role]).forEach(rk => {
          if (rk) roleCount[rk] = (roleCount[rk] || 0) + 1
        }))
        this.roles = this.roles
          .map(r => ({ ...r, count: roleCount[r.role] || 0 }))
          .filter(r => r.count > 0)
        this._setBgFromCredits(this._cache.all.raw)
      }
    },

    selectRole(role) {
      if (this.activeRole === role) return
      this.activeRole = role
      this.loadingFilmo = !(this._cache[role] && this._cache[role].raw.length)
      this._ensureRole(role)
    },

    // Дедуп «Все» по тайтлу: один тайтл — одна карточка, роли объединяются.
    _dedupeAll(raw) {
      const byId = new Map()
      raw.forEach((m, idx) => {
        const id = m.kp_id || ('x' + idx)
        const ex = byId.get(id)
        if (!ex) byId.set(id, { ...m, _roleKeys: [m.role] })
        else if (!ex._roleKeys.includes(m.role)) ex._roleKeys.push(m.role)
      })
      return [...byId.values()]
    },

    // Фон — постер самого рейтингового фильма из фильмографии (не фото актёра).
    _setBgFromCredits(raw) {
      const withPoster = (raw || []).filter(c => c.poster_kp || c.poster_tmdb || c.poster_imdb)
      if (!withPoster.length) return
      const best = withPoster.reduce((a, b) => (Number(b.rating_kp) || 0) > (Number(a.rating_kp) || 0) ? b : a)
      const r = best.poster_kp || best.poster_tmdb || best.poster_imdb
      if (r) this.bgPhoto = posterUrl(r)
    },

    // ── Имя / профессии ──────────────────────────────────
    get displayName() {
      const p = this.person || {}
      return p.name_ru || p.name_en || p.name_original || 'Без имени'
    },
    get secondaryName() {
      const p = this.person || {}
      const latin = p.name_en || p.name_original || ''
      return latin && latin !== this.displayName ? latin : ''
    },
    get professionLabels() {
      return (this.person?.professions || []).map(this.roleLabel).filter(Boolean)
    },

    // ── Мета ─────────────────────────────────────────────
    get birthLine() {
      const p = this.person || {}
      if (!p.birth_year) return ''
      const end = p.death_year || new Date().getFullYear()
      const age = end - p.birth_year
      return age > 0 ? `${p.birth_year} · ${age} ${_yearsWord(age)}` : String(p.birth_year)
    },
    get genderLabel() {
      const g = this.person?.gender
      return g === 'male' ? 'Мужской' : g === 'female' ? 'Женский' : ''
    },
    get bioLong() {
      return (this.person?.biography || '').length > 320
    },

    // ── Фильмография ─────────────────────────────────────
    get totalCredits() {
      return this._allDistinct || this._totalCount || 0
    },
    get visibleCredits() {
      const c = this._cache[this.activeRole]
      if (!c || !c.raw.length) return []
      const list = this.activeRole === 'all' ? this._dedupeAll(c.raw) : c.raw
      return list.map((m, i) => ({
        ...m,
        movieId: m.kp_id,
        _key: (m.kp_id || 'x') + '-' + (m._roleKeys ? 'all' : (m.role || '')) + '-' + i,
      }))
    },
    roleLabel(role) {
      return ROLE_LABELS[role] || (role ? role.charAt(0).toUpperCase() + role.slice(1) : '')
    },

    // ── Карточка фильма ──────────────────────────────────
    posterFor(m) {
      const raw = m.poster_kp || m.poster_tmdb || m.poster_imdb || ''
      return posterUrl(_previewPoster(raw))
    },
    cardTitle(m) {
      return m.title_ru || m.title_en || m.title_original || 'Без названия'
    },
    cardRole(m) {
      // «Все» — перечисляем роли через запятую; конкретная роль — персонаж/должность
      if (m._roleKeys) return m._roleKeys.map(r => this.roleLabel(r)).filter(Boolean).join(', ')
      return m.character_ru || m.character_en || m.job || ''
    },
    ratingOf(m) {
      // КП → IMDb → TMDb; пропускаем оценки, округляющиеся до 0.0 (<0.05)
      for (const v of [m.rating_kp, m.rating_imdb, m.rating_tmdb]) {
        const n = Number(v) || 0
        if (n >= 0.05) return { value: n }
      }
      return { value: 0 }
    },
    ratingBg(r) {
      if (r >= 7.0) return '#27ae60'
      if (r < 5.0)  return '#e74c3c'
      return '#7f8c8d'
    },
    typeLabel(kind) {
      return KIND_LABELS[kind] || ''
    },

    onCardEnter(m) {
      const id = m.movieId
      if (!id || this._prefetched.has(id)) return
      this._prefetched.add(id)
      if (location.hostname.endsWith('github.io')) return
      const link = document.createElement('link')
      link.rel = 'prefetch'
      link.href = '/movie/' + id
      document.head.appendChild(link)
    },

    goBack() {
      if (history.length > 1) history.back()
      else location.href = '/'
    },
  }
}
