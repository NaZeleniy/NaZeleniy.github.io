function renderHeader(activePage) {
  _renderSidebar(activePage)
  if (activePage !== 'settings') _renderSearch(activePage)
}

function _renderSidebar(activePage) {
  const links = [
    { href: '/',             icon: 'fa-home', label: 'Главная',    page: 'index'    },
    { href: 'top.html',      icon: 'fa-fire', label: 'Популярное', page: 'top'      },
    { href: 'settings.html', icon: 'fa-cog',  label: 'Настройки',  page: 'settings' },
    { href: 'faq.html',      icon: 'fa-circle-question', label: 'FAQ',        page: 'faq'      },
  ]

  const linksHtml = links.map(l => `
    <a href="${l.href}" class="nav-link${l.page === activePage ? ' active' : ''}" title="${l.label}">
      <i class="fas ${l.icon}"></i>
      <span class="nav-text">${l.label}</span>
    </a>`).join('')

  document.getElementById('app-sidebar').outerHTML = `
    <aside class="side-panel" x-data="{ open: false }" :class="{ open }">
      <button class="toggle-btn" @click="open = !open">
        <i class="fas" :class="open ? 'fa-chevron-left' : 'fa-chevron-right'"></i>
      </button>
      <nav class="nav-links">${linksHtml}</nav>
    </aside>`
}

function _renderSearch(activePage) {
  const isTop = activePage === 'top'

  document.getElementById('app-search').outerHTML = `
    <section class="search-section">
      <div class="search-container">

        <div class="search-types">
          ${isTop
            ? `<a href="/" class="type-btn"><i class="fas fa-search"></i> По названию</a>`
            : `<button class="type-btn" :class="{ active: searchType === 'name' }" @click="onSearch()"><i class="fas fa-search"></i> По названию</button>`
          }
          <a href="top.html" class="type-btn" :class="{ active: searchType === 'top' }">
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
