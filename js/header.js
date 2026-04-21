function renderHeader(activePage) {
  _renderSidebar(activePage)
  if (activePage !== 'settings') _renderSearch(activePage)
  _initAuthBtn()
  _initTVDetect()
  _initSpatialNav()
  _initBgParallax()
}

function _initBgParallax() {
  if (window._bgParallaxInit) return
  window._bgParallaxInit = true
  window.addEventListener('scroll', () => {
    if (document.documentElement.dataset.bgParallax !== '1') return
    const el = document.querySelector('.bg-poster')
    if (el) el.style.backgroundPositionY = `calc(50% + ${window.scrollY * 0.06}px)`
  }, { passive: true })
}

function _initAuthBtn() {
  if (document.getElementById('auth-btn')) return // уже есть в HTML
  const div = document.createElement('div')
  div.id = 'auth-btn'
  document.body.appendChild(div)

  const ver = (document.querySelector('script[src*="header.js"]') || {}).src || ''
  const v = (ver.match(/[?&]v=\d+/) || [''])[0]

  const _load = src => { const s = document.createElement('script'); s.src = src; document.body.appendChild(s) }
  // auth.js сам загружает auth-modal.js если нужно — не грузим здесь чтобы избежать двойной загрузки
  _load('js/auth.js' + v)
}

let _isTVMode = false

function _initTVDetect() {
  document.addEventListener('keydown', e => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      if (!_isTVMode) {
        _isTVMode = true
        document.body.classList.add('tv-mode')
        if (typeof Settings !== 'undefined') Settings.apply(Settings.get())
      }
    }
  })

  document.addEventListener('mousemove', () => {
    if (_isTVMode) {
      _isTVMode = false
      document.body.classList.remove('tv-mode')
      if (typeof Settings !== 'undefined') Settings.apply(Settings.get())
    }
  })
}

function _renderSidebar(activePage) {
  const _TWITCH_PATH = 'M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z'

  const links = [
    { href: '/',           icon: 'fa-home',            label: 'Главная',    page: 'index'     },
    { href: '/top',        icon: 'fa-fire',            label: 'Популярное', page: 'top'       },
    { href: '/me',         icon: 'fa-user',            label: 'Профиль',    page: 'me'        },
    { href: '/reacts',     svgPath: _TWITCH_PATH,      label: 'reacts',     page: 'streamers' },
    { href: '/settings',   icon: 'fa-cog',             label: 'Настройки',  page: 'settings'  },
    { href: '/faq',        icon: 'fa-circle-question', label: 'FAQ',        page: 'faq'       },
  ]

  const linksHtml = links.map(l => `
    <a href="${l.href}" class="nav-link${l.page === activePage ? ' active' : ''}" title="${l.label}">
      ${l.svgPath
        ? `<svg class="nav-svg-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${l.svgPath}"/></svg>`
        : `<i class="fas ${l.icon}"></i>`
      }
      <span class="nav-text">${l.label}</span>
    </a>`).join('')

  document.getElementById('app-sidebar').outerHTML = `
    <aside class="side-panel" x-data="{ open: false }" :class="{ open }">
      <button class="toggle-btn" @click="open = !open">
        <i class="fas" :class="open ? 'fa-chevron-left' : 'fa-chevron-right'"></i>
      </button>
      <nav class="nav-links">${linksHtml}</nav>
    </aside>`

  if (!document.querySelector('.bg-poster')) {
    const saved = localStorage.getItem('nz_bg_poster')
    if (saved) {
      const div = document.createElement('div')
      div.className = 'bg-poster visible'
      div.style.backgroundImage = `url(${saved})`
      document.body.insertBefore(div, document.body.firstChild)
    }
  }
}

function _initSpatialNav() {
  if (window._spatialNavInit) return
  window._spatialNavInit = true

  const script = document.createElement('script')
  script.src = 'js/spatial-navigation.js'
  script.onerror = () => { window._spatialNavInit = false }
  script.onload = () => {
    SpatialNavigation.init()

    SpatialNavigation.add({
      id: 'sidebar',
      selector: '.side-panel .nav-link, .side-panel .toggle-btn, #auth-btn .auth-btn',
      restrict: 'self-only',
      leaveFor: { right: '@content' },
    })

    SpatialNavigation.add({
      id: 'content',
      selector: [
        '.movie-card',
        '.type-btn',
        '.search-input',
        '.search-icon-btn',
        '.player-option',
        '.player-select-trigger',
        '.player-summary',
        '.watch-party-btn',
        'details summary',
      ].join(', '),
      enterTo: 'last-focused',
      leaveFor: { left: '@sidebar' },
      straightOnly: true,
      straightOverlapThreshold: 0.5, // фоллбэк: если перекрытие >50% — считается "прямым"
    })

    document.addEventListener('sn:focused', e => {
      e.target.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })

    // hover = focus: только в TV-режиме (пульт + стрелки)
    // Guard: один раз на элемент, пока мышь не уйдёт на другой
    let _hoverTarget = null
    document.addEventListener('mouseover', e => {
      if (!_isTVMode) return
      const card = e.target.closest('.movie-card, .nav-link, .type-btn, .player-option')
      if (card && card !== _hoverTarget) {
        _hoverTarget = card
        card.focus({ preventScroll: true })
      }
    })
    document.addEventListener('mouseout', e => {
      if (!e.currentTarget.contains(e.relatedTarget)) _hoverTarget = null
    })

    SpatialNavigation.focus('content') || SpatialNavigation.focus('sidebar')

    // Enter/OK на карточках и кнопках
    document.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const el = document.activeElement
        if (
          el &&
          !['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) &&
          !el.isContentEditable
        ) {
          el.click()
        }
      }

      // Back: только Backspace (Escape оставляем браузеру/Alpine — не ломает десктоп)
      if (e.key === 'Backspace') {
        const el = document.activeElement
        if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(el?.tagName) && !el?.isContentEditable) {
          history.back()
        }
      }
    })
  }
  document.head.appendChild(script)
}

function _renderSearch(activePage) {
  const el = document.getElementById('app-search')
  if (!el) return
  const isTop = activePage === 'top'

  el.outerHTML = `
    <section class="search-section">
      <div class="search-container">

        <div class="search-types">
          ${isTop
            ? `<a href="/" class="type-btn"><i class="fas fa-search"></i> По названию</a>`
            : `<button class="type-btn" :class="{ active: searchType === 'name' }" @click="onSearch()"><i class="fas fa-search"></i> По названию</button>`
          }
          <a href="/top" class="type-btn" :class="{ active: searchType === 'top' }">
            <i class="fas fa-fire"></i> Популярное
          </a>
          <button class="type-btn random-btn" @click="fetchRandom()">
            <i class="fas fa-dice"></i> Случайный
          </button>
        </div>

        <div class="search-input-wrapper" @click.outside="closeSuggestions()">
          <input
            type="text"
            class="search-input"
            :class="{ 'has-suggestions': showSuggestions && suggestions.length > 0 }"
            placeholder="Введите название фильма..."
            x-model="query"
            @keydown.enter.prevent="commitSearch()"
            @keydown.escape="closeSuggestions()"
            @keydown.arrow-down.prevent="highlightNext()"
            @keydown.arrow-up.prevent="highlightPrev()"
            @input.debounce.350ms="onInput()"
            @focus="if (suggestions.length) showSuggestions = true"
            autocomplete="off"
            spellcheck="false"
          />
          <span class="search-spinner" x-show="suggestionsLoading" x-cloak>
            <i class="fas fa-circle-notch fa-spin"></i>
          </span>
          <button class="search-icon-btn" x-show="!suggestionsLoading" @click="commitSearch()" aria-label="Поиск">
            <i class="fas fa-search"></i>
          </button>

          <div class="suggestions-dropdown" x-show="showSuggestions && suggestions.length > 0" x-cloak>
            <template x-for="(movie, i) in suggestions" :key="movie.kinopoiskId || movie.filmId || i">
              <a href="#" class="suggestion-item"
                 :class="{ highlighted: i === highlightedIndex }"
                 @click.prevent="selectSuggestion(movie)"
                 @mouseenter="highlightedIndex = i"
                 @mouseleave="highlightedIndex = -1">
                <div class="suggestion-poster">
                  <img :src="posterUrl(movie.posterUrlPreview || movie.posterUrl)" :alt="movie.nameRu || movie.nameEn" loading="lazy"/>
                </div>
                <div class="suggestion-info">
                  <span class="suggestion-title" x-text="movie.nameRu || movie.nameEn || 'Без названия'"></span>
                  <span class="suggestion-meta">
                    <span x-text="movie.year || ''"></span>
                    <template x-if="movie.genres && movie.genres.length > 0">
                      <span x-text="' · ' + (movie.genres[0] ? movie.genres[0].genre : '')"></span>
                    </template>
                  </span>
                </div>
                <i class="fas fa-arrow-up-left suggestion-arrow"></i>
              </a>
            </template>
          </div>
        </div>

      </div>
    </section>`
}
