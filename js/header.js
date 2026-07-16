function renderHeader(activePage) {
  _injectHeadMeta()
  _injectAppleChrome()
  _renderSidebar(activePage)
  if (activePage !== 'settings') _renderSearch(activePage)
  _initAuthBtn()
  _initTVDetect()
  _initSpatialNav()
  _initBgParallax()
}

// Canonical (дедуп github.io ↔ aucklanda.online), PWA-манифест и apple-touch-icon.
// Инжектим из одной точки, чтобы не дублировать в <head> каждой страницы.
function _injectHeadMeta() {
  if (window._headMetaInit) return
  window._headMetaInit = true
  const head = document.head
  // Канонический домен — всегда aucklanda.online, на каком бы хосте ни открыли.
  if (!head.querySelector('link[rel="canonical"]')) {
    const link = document.createElement('link')
    link.rel = 'canonical'
    link.href = 'https://aucklanda.online' + location.pathname
    head.appendChild(link)
  }
  if (!head.querySelector('link[rel="manifest"]')) {
    const m = document.createElement('link')
    m.rel = 'manifest'
    m.href = '/site.webmanifest'
    head.appendChild(m)
  }
  if (!head.querySelector('link[rel="apple-touch-icon"]')) {
    const a = document.createElement('link')
    a.rel = 'apple-touch-icon'
    a.href = '/img/icons/1024x1024.png'
    head.appendChild(a)
  }
}

// Apple-рейл + Phosphor-иконки рейла (self-hosted в apple-chrome.css, без CDN)
function _injectAppleChrome() {
  if (window._appleChromeInit) return
  window._appleChromeInit = true
  const css = document.createElement('link')
  css.rel = 'stylesheet'
  css.href = 'css/apple-chrome.css'
  document.head.appendChild(css)
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
  const links = [
    { href: '/',            icon: 'house',        label: 'Главная',    page: 'index'       },
    { href: '/top',         icon: 'fire',         label: 'Популярное', page: 'top'         },
    { href: '/collections', icon: 'squares-four', label: 'Подборки',   page: 'collections' },
    { href: '/me',          icon: 'user',         label: 'Профиль',    page: 'me'          },
    { href: '/reacts',   icon: 'twitch-logo', label: 'Реакции',    page: 'reacts'   },
    { href: '/settings', icon: 'gear',        label: 'Настройки',  page: 'settings' },
    { href: '/faq',      icon: 'question',    label: 'FAQ',        page: 'faq'      },
  ]

  const linksHtml = links.map(l => {
    const active = l.page === activePage
    const weight = active ? 'ph-fill' : 'ph'
    return `
    <a href="${l.href}" class="nav-link${active ? ' active' : ''}" title="${l.label}">
      <i class="${weight} ph-${l.icon}"></i>
      <span class="nav-text">${l.label}</span>
    </a>`
  }).join('')

  document.getElementById('app-sidebar').outerHTML = `
    <aside class="side-panel">
      <a href="/" class="rail-mark" title="NaZeleniy"><img src="img/logo/logo_na.svg" alt="NaZeleniy"/></a>
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

  // Триггер «Фильтры» + раскрывающаяся панель Discover — только на /top
  const filterTrigger = isTop ? `
          <button class="as-trigger" :class="{ open: filterOpen }" @click="toggleFilters()" type="button">
            <i class="fas fa-sliders lead"></i> Фильтры
            <span class="as-count" x-show="filterCount > 0" x-text="filterCount" x-cloak></span>
            <i class="fas fa-chevron-down chev"></i>
          </button>` : ''

  const filterPanel = isTop ? `
        <div class="as-panel" :class="{ open: filterOpen }">
          <div class="as-panel__inner">
            <div class="as-grid">

              <div class="as-group" style="grid-column: span 8">
                <span class="as-group__l"><i class="ph ph-film-strip"></i> Тип</span>
                <div class="as-seg accent">
                  <template x-for="k in filtersMeta.kinds" :key="k.value">
                    <button type="button" :class="{ on: filters.kind === k.value }"
                            @click="filters.kind = (filters.kind === k.value ? '' : k.value)" x-text="k.label_ru"></button>
                  </template>
                </div>
              </div>

              <div class="as-group" style="grid-column: span 4">
                <span class="as-group__l"><i class="ph ph-globe-hemisphere-west"></i> Регион</span>
                <div class="as-seg accent">
                  <template x-for="r in filtersMeta.regions" :key="r.slug">
                    <button type="button" :class="{ on: filters.region === r.slug }"
                            @click="filters.region = (filters.region === r.slug ? '' : r.slug)" x-text="r.name_ru"></button>
                  </template>
                </div>
              </div>

              <div class="as-group" style="grid-column: span 3">
                <span class="as-group__l"><i class="ph ph-sort-ascending"></i> Сортировка</span>
                <div class="as-sortrow">
                  <select class="as-select" x-model="filters.sort">
                    <option value="popularity">По популярности</option>
                    <option value="rating_kp">По рейтингу КП</option>
                    <option value="rating_imdb">По рейтингу IMDb</option>
                    <option value="awards_won">По наградам</option>
                    <option value="oscars_won">По «Оскарам»</option>
                    <option value="release_date">По дате выхода</option>
                  </select>
                  <button type="button" class="as-iconbtn" :class="{ on: filters.order === 'asc' }"
                          @click="filters.order = (filters.order === 'desc' ? 'asc' : 'desc')"
                          :title="filters.order === 'desc' ? 'По убыванию' : 'По возрастанию'">
                    <i class="ph" :class="filters.order === 'desc' ? 'ph-sort-descending' : 'ph-sort-ascending'"></i>
                  </button>
                </div>
              </div>

              <div class="as-group" style="grid-column: span 3">
                <span class="as-group__l"><i class="ph ph-calendar-blank"></i> Год</span>
                <div class="as-yr">
                  <input class="as-input" type="number" inputmode="numeric" placeholder="от" x-model="filters.yearFrom" min="1900" :max="filtersMeta.yearMax">
                  <span class="dash">—</span>
                  <input class="as-input" type="number" inputmode="numeric" placeholder="до" x-model="filters.yearTo" min="1900" :max="filtersMeta.yearMax">
                </div>
              </div>

              <div class="as-group" style="grid-column: span 6">
                <span class="as-group__l"><i class="ph ph-star"></i> Рейтинг от</span>
                <div class="as-rate">
                  <div class="as-slider">
                    <div class="as-slider__track"></div>
                    <div class="as-slider__fill" :style="\`width:\${filters.ratingMin * 10}%\`"></div>
                    <input type="range" min="0" max="10" step="1" x-model.number="filters.ratingMin">
                  </div>
                  <span class="as-rate__val" :class="{ zero: !filters.ratingMin }" x-text="filters.ratingMin || '—'"></span>
                </div>
              </div>

              <div class="as-group grow" style="grid-column: 1 / -1">
                <span class="as-group__l"><i class="ph ph-tag"></i> Жанры</span>
                <div class="as-chips">
                  <template x-for="g in filtersMeta.genres" :key="g.slug">
                    <button type="button" class="as-chip" :class="{ on: filters.genres.includes(g.slug) }"
                            @click="toggleGenre(g.slug)" x-text="g.name_ru"></button>
                  </template>
                </div>
              </div>

            </div>
            <div class="as-foot">
              <button type="button" class="as-reset" @click="resetFilters()"><i class="ph ph-arrow-counter-clockwise"></i> Сбросить</button>
              <button type="button" class="as-apply" @click="applyFilters()"><i class="ph ph-check"></i> Применить</button>
            </div>
          </div>
        </div>

        <div class="as-active" x-show="appliedTags.length" x-cloak>
          <template x-for="tag in appliedTags" :key="tag.key">
            <span class="tag"><b x-text="tag.label"></b><button type="button" @click="removeTag(tag)"><i class="ph ph-x"></i></button></span>
          </template>
          <button type="button" class="clear-all" @click="clearAllFilters()">Очистить всё</button>
        </div>` : ''

  el.outerHTML = `
    <section class="search-section">
      <div class="search-container">

        <div class="search-types">
          ${isTop
            ? `<a href="/" class="type-btn"><i class="ph ph-magnifying-glass"></i> По названию</a>`
            : `<button class="type-btn" :class="{ active: searchType === 'name' }" @click="onSearch()"><i class="ph ph-magnifying-glass"></i> По названию</button>`
          }
          <a href="/top" class="type-btn" :class="{ active: searchType === 'top' }">
            <i class="ph ph-fire"></i> Популярное
          </a>
          <button class="type-btn random-btn" @click="fetchRandom()">
            <i class="ph ph-shuffle"></i> Случайный
          </button>${filterTrigger}
        </div>
        ${filterPanel}

        <div class="search-input-wrapper" @click.outside="closeSuggestions()">
          <input
            type="text"
            class="search-input"
            :class="{ 'has-suggestions': showSuggestions && suggestions.length > 0 }"
            :placeholder="animatedPlaceholder"
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
            <i class="ph ph-magnifying-glass"></i>
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
                  <span class="suggestion-title" x-text="movie.nameRu || movie.nameEn || movie.nameOriginal || 'Без названия'"></span>
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
