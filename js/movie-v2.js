/* ═══════════════════════════════════════════════════════════════════════════
   movie-v2.js — новый вкладочный дизайн страницы фильма (Kinodata 1.2).
   Самогейтится: при включённом «Старый дизайн» (nz_settings.movieClassic)
   ничего не делает — работает классический movie.js.
   Данные берутся ТОЛЬКО из своего backend-прокси (/api/v2/*), ключ на сервере.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── гейт: только новый дизайн ────────────────────────────────────────────
  var classic = false;
  try { classic = !!(window.Settings && window.Settings.get().movieClassic); } catch (e) {}
  if (classic) return;

  var id = (typeof movieId !== 'undefined' && movieId)
    || (location.pathname.match(/\/movie\/(\d+)/) || [])[1]
    || new URLSearchParams(location.search).get('id');
  if (!id) return;

  var API = (typeof API_BASE !== 'undefined') ? API_BASE : '';
  var CREDS = (typeof _CREDS !== 'undefined') ? _CREDS : 'omit';

  // Постер с карточки, с которой пришли (sessionStorage['moviePreview']) — он на
  // CDN Кинопоиска (прямой, точно рабочий) и уже прогрет в кеше браузера. Держим
  // как надёжный fallback, чтобы постер тайтла НИКОГДА не был пустым (карточка
  // могла отдать tmdb-постер, который заблокирован/не прошёл через прокси).
  var STUB_POSTER = (function () {
    try {
      var s = JSON.parse(sessionStorage.getItem('moviePreview') || 'null');
      if (s && String(s.kinopoiskId || s.filmId) === String(id)) return s.posterUrlPreview || s.posterUrl || '';
    } catch (e) {}
    return '';
  })();

  // язык интерфейса пользователя (для выбора языка постера/логотипа)
  function userLang() {
    try { return (window.Settings && window.Settings.get().lang) || localStorage.getItem('nz_lang') || 'ru'; }
    catch (e) { return 'ru'; }
  }
  // приоритет по языку: выбранный → без языка → прочие
  function langRankFor(lang) { return function (l) { return l === lang ? 0 : (!l ? 1 : 2); }; }

  // ── утилиты ───────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  var $ = function (s, r) { return (r || document).querySelector(s); };
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function nf(n) { return Number(n || 0).toLocaleString('ru-RU'); }
  function clsRating(v) { return v >= 7 ? 'high' : (v < 5 ? 'low' : ''); }
  // tmdb отдаёт оригиналы (1–3 МБ) — для сетки/эскизов это перебор: скачивание +
  // webp-конвертация большого файла на прокси = 2–6 с на холодную (сервер 2 vCPU).
  // Просим у tmdb нужный размер (w300/w500/w780) — источник в 10–30× меньше,
  // конвертация мгновенна, диск/трафик прокси меньше. Только image.tmdb.org
  // (у него есть /t/p/<size>/); прочие CDN (КП/kinorium) не трогаем. Оригинал
  // остаётся на клик — ссылки в тайлах ведут на исходный url.
  function tmdbSize(u, size) {
    return (u && u.indexOf('image.tmdb.org') !== -1)
      ? u.replace(/\/t\/p\/(?:original|w\d+)\//, '/t/p/' + size + '/')
      : u;
  }
  function money(n) { return n ? '$' + Number(n).toLocaleString('ru-RU') : '—'; }
  function durSec(s) { if (!s) return ''; var m = Math.floor(s / 60); return m + ':' + String(s % 60).padStart(2, '0'); }
  function poster(u) { return u || '/img/placeholder.svg'; }
  // Прогон картинки через бэкенд-прокси: обходит региональные блокировки CDN
  // (image.tmdb.org недоступен в РФ) и отдаёт кешированный webp.
  // ВНИМАНИЕ: прокси помогает ТОЛЬКО если САМ сервер достаёт до CDN. Локальный
  // dev-бэкенд в РФ до tmdb не дотянется → таймауты, поэтому в dev прокси ВЫКЛЮЧЕН
  // (прямые URL, быстро; probe покажет доступные регионально). В проде (VPS видит
  // tmdb) прокси ВКЛючён → покажет ВСЕ постеры. Ручной оверрайд: nz_settings.mediaProxy.
  // Разрешён ли прокси в этом окружении (нужно ли ВООБЩЕ пытаться). Прокси помогает,
  // только если сервер достаёт до CDN: локальный dev-бэкенд в РФ до tmdb не дотянется.
  var MEDIA_PROXY = (function () {
    try {
      var s = window.Settings && window.Settings.get();
      if (s && typeof s.mediaProxy === 'boolean') return s.mediaProxy; // явный оверрайд
      var h = location.hostname;
      if (h === 'localhost' || h === '127.0.0.1') return false;
      if (/^(10|127)\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false; // LAN-dev по IP
      return true; // прод (aucklanda.online / github.io)
    } catch (e) { return false; }
  })();
  // Режим по ХОСТУ: 'direct' (грузится напрямую — прокси НЕ нужен), 'proxy' (напрямую
  // заблокирован, но сервер достаёт → через прокси), 'drop' (недоступен никак). Так
  // мы НЕ гоняем через бэкенд то, что и так грузится (kinorium/yandex) — экономия.
  var _hostMode = {};
  // Пред-засев хостов, которые в РФ грузятся НАПРЯМУЮ (не заблокированы). Без него на
  // проде (MEDIA_PROXY=true) непроверенный хост идёт через прокси — и критичный
  // hero-постер/фон на ПЕРВОЙ отрисовке зря гонятся через бэкенд (round-trip + webp-
  // конвертация именно для самой заметной картинки, + лишняя нагрузка на прокси).
  // Постеры Кинопоиска/Яндекса и kinorium в РФ доступны напрямую → грузим сразу.
  // image.tmdb.org сюда НЕ входит (заблокирован в РФ → остаётся на прокси); youtube-
  // превью тоже не сеем — их решает probe. onerror на <img> подстрахует, если хост
  // у конкретного пользователя всё же недоступен.
  ['avatars.mds.yandex.net', 'st.kp.yandex.net', 'images.kinorium.com', 'images-s.kinorium.com', 'ru-images.kinorium.com']
    .forEach(function (h) { _hostMode[h] = 'direct'; });
  function proxied(u) { return API + '/proxy/poster?url=' + encodeURIComponent(u); }
  function murl(u) {
    if (!u) return u;
    if (/\.mp4($|\?)/i.test(u) || u.indexOf('data:') === 0 || u.indexOf('/proxy/poster') !== -1) return u;
    var mode = _hostMode[hostOf(u)];
    if (mode === 'proxy') return proxied(u);         // известный заблокированный хост → прокси
    if (mode === 'direct') return u;                 // известный доступный → напрямую (0 нагрузки)
    return MEDIA_PROXY ? proxied(u) : u;             // хост ещё не проверен → по глоб. политике
  }

  function api(path) {
    var ctrl = new AbortController();
    var to = setTimeout(function () { ctrl.abort(); }, 20000);
    return fetch(API + path, { credentials: CREDS, signal: ctrl.signal })
      .then(function (r) { if (!r.ok) throw new Error('http-' + r.status); return r.json(); })
      .finally(function () { clearTimeout(to); });
  }

  // ── SVG-иконки ─────────────────────────────────────────────────────────────
  var IC = {
    play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
    plus: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14" stroke-linecap="round"/></svg>',
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    dot: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="3"/></svg>'
  };

  // ── favicon источника (для оценок и сайтов): DDG → Google → буква ──────────
  function favIco(host, letter, cls) {
    return '<span class="' + (cls || 'rating-fav') + '" data-l="' + esc(letter) + '">' +
      '<img src="https://icons.duckduckgo.com/ip3/' + esc(host) + '.ico" alt="" loading="lazy" data-h="' + esc(host) + '" ' +
      'onerror="if(this.dataset.g){this.parentNode.classList.add(\'noico\');this.remove()}else{this.dataset.g=1;this.src=\'https://www.google.com/s2/favicons?domain=\'+this.dataset.h+\'&sz=64\'}"></span>';
  }

  // ═══ ЗАГРУЗКА ═══════════════════════════════════════════════════════════════
  var CARD = null;
  var host = $('#movieContent');
  if (host) host.innerHTML = '<div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i></div>';

  api('/api/v2/movie/' + id)
    .then(function (card) { CARD = card; render(card); })
    .catch(function (e) {
      if (host) host.innerHTML = '<div class="movie-retry-bar">Не удалось загрузить фильм. ' +
        '<button onclick="location.reload()">Повторить</button></div>';
      console.warn('[nz v2] load fail', e);
    });

  // Блок плеера — идентичен классическому (id-шники ждёт loadPlayers из movie.js).
  function playerSectionHtml() {
    return '<details class="player-section">' +
      '<summary class="player-summary"><i class="fas fa-play-circle"></i>' +
      '<span>Смотреть онлайн</span><i class="fas fa-chevron-down player-chevron"></i></summary>' +
      '<div class="player-select-wrap" id="playerSelectWrap"><div class="player-select-inner">' +
      '<button class="player-select-trigger" onclick="togglePlayerDropdown()">' +
      '<span id="playerSelectedName">Загрузка...</span>' +
      '<i class="fas fa-chevron-down" id="playerDropdownChevron"></i></button>' +
      '<div class="player-dropdown" id="playerDropdown"></div></div>' +
      '<div id="watchPartySlot"></div>' +
      '<button class="player-fs-btn" id="playerFsBtn" type="button" title="Кинорежим" aria-label="Кинорежим">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>' +
      '</button></div>' +
      '<div class="player-wrapper">' +
      '<iframe id="player-frame" title="Видеоплеер" frameborder="0" allow="autoplay; fullscreen; encrypted-media; picture-in-picture"></iframe>' +
      '<div class="player-loading"><i class="fas fa-circle-notch fa-spin"></i></div>' +
      '<div class="player-error"><i class="fas fa-exclamation-circle"></i><span>Плеер не доступен, попробуйте другой</span></div>' +
      '</div></details>';
  }

  // ═══ РЕНДЕР ═════════════════════════════════════════════════════════════════
  function render(c) {
    var title = (c.title && (c.title.title_ru || c.title.title)) || 'Без названия';
    var titleEn = c.title && c.title.title_en;
    var rel = c.release || {}, cls = c.classification || {}, med = c.media || {}, syn = c.synopsis || {};
    var tagline = syn.tagline_ru || syn.tagline || '';
    var overview = syn.overview_ru || syn.overview || syn.short_overview_ru || '';
    var countries = (c.countries || []).map(function (x) { return x.name_ru || x.name_en; }).filter(Boolean);
    var genres = (c.genres || []).map(function (x) { return x.name_ru || x.name_en; }).filter(Boolean);
    var counts = c.counts || {};

    document.title = title + (rel.year ? ' (' + rel.year + ')' : '') + ' — NaZeleniy';

    // фон — размытый ПОСТЕР (как в классике: «Постер фильма размытым фоном»),
    // fallback на backdrop. Сохраняем в localStorage, чтобы фон жил при навигации.
    var bgUrl = murl(tmdbSize(med.poster_kp || med.poster_url || med.poster_tmdb || med.backdrop_url, 'w780')) || STUB_POSTER;
    var bg = $('#bg-poster');
    if (bg && bgUrl) {
      bg.style.backgroundImage = 'url("' + bgUrl + '")';
      bg.classList.add('visible');
      try { localStorage.setItem('nz_bg_poster', bgUrl); } catch (e) {}
    }

    // История просмотров (главная читает localStorage['nz_history']). Классика писала
    // через movie.js, но в новом дизайне он не работает → пишем здесь. Постер берём
    // КП/прямой (poster_kp → постер с карточки → tmdb): на главной постеры идут БЕЗ
    // прокси, а tmdb в РФ заблокирован — иначе карточка истории была бы пустой.
    try {
      if (typeof historyAdd === 'function') {
        var histPoster = med.poster_kp || STUB_POSTER || med.poster_url || '';
        var kpR = (c.ratings && c.ratings.sources && c.ratings.sources.kp) ? c.ratings.sources.kp.value : undefined;
        historyAdd({
          kinopoiskId: id,
          nameRu: c.title && c.title.title_ru,
          nameEn: titleEn,
          nameOriginal: c.title && c.title.title,
          year: rel.year,
          type: (cls && (cls.kind || cls.type)) || '',
          ratingKinopoisk: kpR,
          posterUrlPreview: histPoster,
          posterUrl: histPoster,
        });
      }
    } catch (e) {}

    // ── оценки ──
    var SRC_NAME = { kp: 'Кинопоиск', imdb: 'IMDb', tmdb: 'TMDB', kinorium: 'Kinorium', letterboxd: 'Letterboxd', rt: 'Rotten Tomatoes', metacritic: 'Metacritic', critics: 'Критики' };
    var SRC_HOST = { kp: 'kinopoisk.ru', imdb: 'imdb.com', tmdb: 'themoviedb.org', kinorium: 'ru.kinorium.com', letterboxd: 'letterboxd.com', rt: 'rottentomatoes.com', metacritic: 'metacritic.com' };
    var SRC_LET = { kp: 'К', imdb: 'I', tmdb: 'T', kinorium: 'Kn', letterboxd: 'L', rt: 'R', metacritic: 'M' };
    var ORDER = ['kp', 'imdb', 'tmdb', 'kinorium', 'letterboxd', 'rt', 'metacritic'];
    var sources = (c.ratings && c.ratings.sources) || {};
    // У части источников (rt/metacritic/letterboxd) в ratings.sources НЕТ url, но их
    // ссылки лежат в watch/sites (kind=rating) — подхватываем по совпадению хоста.
    var watchUrl = {};
    (c.watch || []).forEach(function (s) { if (s && s.host && s.url && !watchUrl[s.host]) watchUrl[s.host] = s.url; });
    var ratingsHtml = ORDER.filter(function (k) { return sources[k]; }).map(function (k) {
      var s = sources[k];
      var val = s.scale === 100 ? (s.value + '%') : s.value;
      var norm = s.scale === 100 ? s.value / 10 : s.value;
      var url = s.url || watchUrl[SRC_HOST[k]] || null;
      var t = s.votes ? nf(s.votes) + ' оценок · ' + SRC_NAME[k] : SRC_NAME[k];
      var inner = favIco(SRC_HOST[k], SRC_LET[k]) + '<span class="rating-value ' + clsRating(norm) + '">' + val + '</span>';
      return '<div class="rating-container">' + (url
        ? '<a class="rating-link" href="' + esc(url) + '" target="_blank" rel="noopener" title="' + esc(t) + '">' + inner + '</a>'
        : '<span class="rating-link" title="' + esc(t) + '">' + inner + '</span>') + '</div>';
    }).join('');

    // ── логотип или заголовок ──
    var headHtml = med.logo
      ? '<img class="nz-logo" style=\"display:block;margin:0 auto;max-width:min(460px,72%);max-height:118px;object-fit:contain\" src="' + esc(med.logo) + '" alt="' + esc(title) + '">'
      : '<h1 class="content-title">' + esc(title) + '</h1>';

    host.innerHTML =
      '<div class="content-header">' + headHtml + '</div>' +
      '<div class="ratings-links">' + ratingsHtml + '</div>' +
      '<div class="movie-layout">' +
        '<div class="movie-layout-poster"><div class="nz-poster-rotator" id="nzRot"></div>' +
          '<button class="nz-fav-btn" id="nzFav" type="button">' + IC.plus + ' Буду смотреть</button>' +
          '<div class="nz-stars" id="nzStars"></div>' +
        '</div>' +
        '<div class="movie-layout-main">' +
          // .nzt-head = fit-content по таб-бару: плеер (width:100%) выравнивается по
          // ширине и левому краю с вкладками. Панели — отдельно, на всю ширину колонки.
          '<div class="nzt-head">' + playerSectionHtml() +
            '<div class="nzt-bar" id="nztBar"><span class="nzt-pill" id="nztPill"></span></div>' +
          '</div>' +
          '<div class="nzt-panels" id="nztPanels"></div>' +
        '</div>' +
      '</div>';

    // Плеер — переиспользуем логику классического movie.js (loadPlayers/selectPlayer —
    // глобальные функции; DOM .player-section тот же). В dev без playerRegistry покажет «Нет плееров».
    try { if (typeof loadPlayers === 'function') loadPlayers(null, id); } catch (e) { console.warn('[nz v2] players', e); }

    // постер (сразу главный, затем ротатор из /media)
    var rot = $('#nzRot');
    // Стартовый постер: прямой КП (poster_kp) → постер с карточки (прямой, прогрет) →
    // poster_url (может быть tmdb через прокси) → плейсхолдер. При ошибке загрузки
    // сначала пробуем постер с карточки (data-fb), только потом плейсхолдер — чтобы
    // тайтл не оставался с пустым постером, если tmdb/прокси не отдал картинку.
    var initialPoster = (med.poster_kp ? murl(med.poster_kp) : '') || STUB_POSTER || (med.poster_url ? murl(tmdbSize(med.poster_url, 'w780')) : '') || '/img/placeholder.svg';
    var fb = (STUB_POSTER && STUB_POSTER !== initialPoster) ? STUB_POSTER : '';
    rot.innerHTML = '<div class="rot-frame on"><img src="' + esc(initialPoster) + '" data-fb="' + esc(fb) + '" alt="' + esc(title) +
      '" onerror="if(this.dataset.fb){this.src=this.dataset.fb;this.dataset.fb=\'\'}else{this.onerror=null;this.src=\'/img/placeholder.svg\'}"></div>';

    // ── вкладки ──
    var TABS = [
      { id: 'overview', label: 'Обзор' },
      { id: 'actors', label: 'Актёры', n: counts.cast },
      { id: 'episodes', label: 'Серии', n: (c.type && c.type.is_series) ? (counts.episodes || 0) : 0 },
      { id: 'photos', label: 'Фото', n: counts.images },
      { id: 'videos', label: 'Видео', n: counts.videos },
      { id: 'awards', label: 'Награды', n: (c.awards && c.awards.total_wins) || 0 },
      { id: 'quotes', label: 'Цитаты', n: counts.quotes },
      { id: 'facts', label: 'Факты', n: counts.facts },
      { id: 'parental', label: 'Что внутри', n: (c.parental || []).length },
      { id: 'faq', label: 'Вопросы', n: counts.faq },
      { id: 'similar', label: 'Связи', n: counts.relations },
      { id: 'sites', label: 'Сайты', n: (c.watch || []).length }
    ].filter(function (t) { return t.n === undefined || t.n > 0; });

    var bar = $('#nztBar'), ink = $('#nztPill'), panels = $('#nztPanels');
    bar.setAttribute('role', 'tablist'); bar.setAttribute('aria-label', 'Разделы фильма');
    TABS.forEach(function (t, i) {
      var b = el('button', 'nzt-tab' + (i === 0 ? ' on' : ''), t.label + (t.n ? '<span class="n">' + t.n + '</span>' : ''));
      b.id = 'nzt-tab-' + t.id; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
      b.setAttribute('aria-controls', 'np-' + t.id); b.tabIndex = i === 0 ? 0 : -1;
      b.onclick = function () { select(i); };
      bar.appendChild(b);
      var p = el('section', 'nzt-panel' + (i === 0 ? ' on' : '')); p.id = 'np-' + t.id;
      p.setAttribute('role', 'tabpanel'); p.setAttribute('aria-labelledby', 'nzt-tab-' + t.id); p.tabIndex = 0;
      panels.appendChild(p);
    });
    var tabBtns = [].slice.call(bar.querySelectorAll('.nzt-tab'));
    var loaded = {};
    bar.addEventListener('keydown', function (e) {
      var cur = tabBtns.findIndex(function (b) { return b.classList.contains('on'); });
      var ni = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') ni = (cur + 1) % tabBtns.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') ni = (cur - 1 + tabBtns.length) % tabBtns.length;
      else if (e.key === 'Home') ni = 0; else if (e.key === 'End') ni = tabBtns.length - 1;
      if (ni != null) { e.preventDefault(); select(ni); tabBtns[ni].focus(); }
    });
    // Пилюля следует за активной вкладкой по X и Y (таб-бар переносится на строки).
    function moveInk(b) {
      ink.style.width = b.offsetWidth + 'px';
      ink.style.height = b.offsetHeight + 'px';
      ink.style.transform = 'translate(' + b.offsetLeft + 'px,' + b.offsetTop + 'px)';
    }
    function select(i, fromHistory) {
      // клик по уже активной вкладке — ничего не делаем (и не плодим записи в history)
      if (!fromHistory && tabBtns[i] && tabBtns[i].classList.contains('on')) return;
      tabBtns.forEach(function (b, j) { var on = i === j; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; });
      var ps = panels.querySelectorAll('.nzt-panel');
      ps.forEach(function (p, j) { p.classList.toggle('on', i === j); });
      moveInk(tabBtns[i]);
      // Держим активную вкладку в зоне видимости, прокручивая САМ бар по горизонтали
      // (не scrollIntoView — тот дёргал бы страницу вертикально). Срабатывает, только
      // если бар всё же не влез в одну строку (крайне узкие случаи).
      try { var ab = tabBtns[i]; bar.scrollLeft = ab.offsetLeft - (bar.clientWidth - ab.offsetWidth) / 2; } catch (e) {}
      var tabId = TABS[i].id;
      if (!loaded[tabId]) { loaded[tabId] = true; fillTab(tabId, ps[i]); }
      requestAnimationFrame(refreshActivePaginate);
      _nzV2Tab = i;
      // Вкладки НЕ пишем в history — иначе «Назад» пришлось бы жать по разу на каждую
      // смену вкладки, чтобы уйти со страницы. В историю попадает только кинорежим (модалка).
    }
    window.__nzSelect = select;
    // Один общий обработчик Назад/Вперёд: закрывает кинорежим (это единственное
    // in-page состояние в истории). Вкладки не трогаем — «Назад» без кинорежима
    // сразу уводит на предыдущую страницу (один клик).
    if (!window.__nzV2Pop) {
      window.__nzV2Pop = true;
      window.addEventListener('popstate', function (e) {
        var st = e.state || {};
        if (_cineIsOpen() && !st.cine) _cineClose();
        else if (!_cineIsOpen() && st.cine) _cineOpen();
      });
    }

    // первая вкладка (Обзор) — сразу
    loaded['overview'] = true;
    fillOverview($('#np-overview'), c, { title: title, titleEn: titleEn, rel: rel, cls: cls, countries: countries, genres: genres, tagline: tagline, overview: overview });
    requestAnimationFrame(function () { requestAnimationFrame(function () { moveInk(tabBtns[0]); }); });
    window.addEventListener('resize', function () { var i = tabBtns.findIndex(function (b) { return b.classList.contains('on'); }); if (i >= 0) moveInk(tabBtns[i]); refreshActivePaginate(); });

    // логотип, ротатор постеров, избранное — фоном
    initLogo(title);
    initRotator(rot, med, title);
    initFav();
    initStars();
    var _fsBtn = $('#playerFsBtn');
    if (_fsBtn) _fsBtn.addEventListener('click', togglePlayerFs);

    // ── диспетчер наполнения вкладок ──
    function fillTab(tabId, panel) {
      if (tabId === 'awards') return fillAwards(panel, c.awards || {});
      if (tabId === 'parental') return fillParental(panel, c.parental || []);
      if (tabId === 'sites') return fillSites(panel, c.watch || []);
      if (tabId === 'photos') return lazyMedia(panel, 'image');
      if (tabId === 'videos') return lazyMedia(panel, 'video');
      if (tabId === 'actors') return lazyCast(panel);
      if (tabId === 'quotes') return lazyTexts(panel, 'quote');
      if (tabId === 'facts') return lazyTexts(panel, 'fact');
      if (tabId === 'faq') return lazyTexts(panel, 'faq');
      if (tabId === 'similar') return lazyRelations(panel);
      if (tabId === 'episodes') return lazyEpisodes(panel);
    }
  }

  // ═══ ОБЗОР ══════════════════════════════════════════════════════════════════
  function fillOverview(panel, c, m) {
    var F = c.finance || {};
    var premiere = pickPremiere(c.release);
    var tags = groupTags(c.tags || []);
    var st = (c.media && c.media.soundtrack) || null;
    var companyGroups = groupCompanies(c.companies || []);

    var html = '';
    if (m.tagline) html += '<p class="nz-tagline">«' + esc(m.tagline) + '»</p>';
    html += '<ul class="info-list">';
    if (m.titleEn) html += '<li><strong>Оригинал:</strong> ' + esc(m.titleEn) + '</li>';
    if (m.rel.year) html += '<li><strong>Год:</strong> ' + m.rel.year + (m.rel.runtime ? ' · ' + m.rel.runtime + ' мин' : '') + '</li>';
    if (m.countries.length) html += '<li><strong>Страны:</strong> ' + esc(m.countries.join(', ')) + '</li>';
    if (m.genres.length) html += '<li><strong>Жанры:</strong> ' + esc(m.genres.join(', ')) + '</li>';
    if (F.budget) html += '<li><strong>Бюджет:</strong> ' + money(F.budget) + '</li>';
    if (F.box_office || F.revenue) html += '<li><strong>Сборы в мире:</strong> ' + money(F.box_office || F.revenue) + '</li>';
    if (premiere) html += '<li><strong>Премьера в РФ:</strong> ' + esc(premiere) + '</li>';
    html += '</ul>';
    if (m.overview) html += '<p class="content-description-text">' + esc(m.overview) + '</p>';
    if (m.cls.age_limit != null || m.cls.mpaa) {
      html += '<div class="rating-boxes">';
      if (m.cls.age_limit != null) html += '<span class="rating-box age">' + m.cls.age_limit + '+</span>';
      if (m.cls.mpaa) html += '<span class="rating-box nz-mpaa">' + esc(m.cls.mpaa) + '</span>';
      html += '</div>';
    }
    tags.forEach(function (g) {
      html += '<p class="nz-subhead">' + esc(g.label) + '</p><div class="nz-chips">' +
        g.items.map(function (t) { return '<a class="nz-chip nz-chip--link" href="/tag/' + encodeURIComponent(t) + '">' + esc(t) + '</a>'; }).join('') + '</div>';
    });
    if (st && st.url) html += '<p class="nz-subhead">Саундтрек</p><a class="nz-soundtrack" href="' + esc(st.url) +
      '" target="_blank" rel="noopener"><span class="ic">♪</span><span><b>' + esc(st.name || 'Слушать') + '</b><span>Слушать альбом</span></span></a>';
    companyGroups.forEach(function (g) {
      html += '<p class="nz-subhead">' + esc(g.label) + '</p><div class="nz-chips">' +
        g.items.map(function (x) { return '<a class="nz-chip nz-chip--link" href="/company/' + encodeURIComponent(x) + '">' + esc(x) + '</a>'; }).join('') + '</div>';
    });
    panel.innerHTML = html;
  }
  function pickPremiere(rel) {
    if (!rel || !rel.releases) return '';
    var ru = rel.releases.find(function (r) { return r.region === 'ru'; });
    var d = ru && (ru.dates || []).find(function (x) { return x.type === 'premiere'; });
    if (!d) return '';
    try { return new Date(d.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }); }
    catch (e) { return d.date; }
  }
  function groupTags(tags) {
    var order = [], map = {};
    tags.forEach(function (t) { var l = t.kind_label || t.kind; if (!map[l]) { map[l] = []; order.push(l); } map[l].push(t.tag); });
    return order.map(function (l) { return { label: l, items: map[l] }; });
  }
  // Компании: русские подписи для kind (API отдаёт kind без kind_label) + порядок групп.
  var COMPANY_KIND = {
    production: 'Производство', special_effects: 'Спецэффекты', post_production: 'Пост-продакшн',
    distributor: 'Дистрибьютор', distributor_theatrical: 'Кинопрокат', distributor_online: 'Цифровая дистрибуция',
    distributor_tv: 'ТВ-дистрибуция', distributor_dvd: 'DVD / Blu-ray'
  };
  var COMPANY_ORDER = ['production', 'special_effects', 'post_production', 'distributor', 'distributor_theatrical', 'distributor_online', 'distributor_tv', 'distributor_dvd'];
  function groupCompanies(comps) {
    var map = {}, order = [];
    comps.forEach(function (x) {
      if (!x || !x.name) return;
      var k = x.kind || 'production';
      if (!map[k]) { map[k] = { label: x.kind_label || COMPANY_KIND[k] || k, items: [] }; order.push(k); }
      map[k].items.push(x.name);
    });
    order.sort(function (a, b) {
      var ia = COMPANY_ORDER.indexOf(a), ib = COMPANY_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return order.map(function (k) { return map[k]; });
  }

  // ═══ НАГРАДЫ ════════════════════════════════════════════════════════════════
  function fillAwards(panel, A) {
    var cer = A.ceremonies || [];
    if (!cer.length) { panel.innerHTML = '<p class="nz-empty">Нет данных о наградах.</p>'; return; }
    var head = '<div class="nz-aw-top">' +
      tot(A.total_wins, 'побед') + tot(A.total_nominations, 'номинаций') +
      (A.oscars_won ? tot(A.oscars_won, '«Оскара»') : '') + '</div>';
    function tot(v, l) { return '<div class="nz-aw-total"><b>' + (v || 0) + '</b><span>' + l + '</span></div>'; }
    panel.innerHTML = head + cer.map(function (cc) {
      var summary = [cc.wins ? cc.wins + ' побед' : '', cc.nominations ? cc.nominations + ' номинаций' : ''].filter(Boolean).join(' · ');
      var icon = cc.icon ? 'https://api.kinodata.space' + cc.icon : '';
      return '<div class="nz-cer"><div class="nz-cer-h">' +
        (icon ? '<img class="nz-cer-ico" src="' + esc(icon) + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">' : '') +
        '<div class="nz-cer-t"><b>' + esc(cc.ceremony) + '</b><span>' + esc(summary + (cc.years ? ' · ' + cc.years.join(', ') : '')) + '</span></div></div>' +
        '<div class="nz-cer-list">' + (cc.items || []).map(function (a) {
          return '<div class="nz-aw ' + (a.won ? 'won' : 'nom') + '"><span class="m">' + (a.won ? IC.ok : IC.dot) + '</span><span>' + esc(a.category) + '</span></div>';
        }).join('') + '</div></div>';
    }).join('');
  }

  // ═══ ЧТО ВНУТРИ ═════════════════════════════════════════════════════════════
  function fillParental(panel, list) {
    if (!list.length) { panel.innerHTML = '<p class="nz-empty">Нет данных.</p>'; return; }
    panel.innerHTML = '<div class="nz-pg-list">' + list.map(function (p) {
      return '<div class="nz-pg ' + esc(p.severity) + '"><span class="cat">' + esc(p.category_label || p.category) + '</span>' +
        '<span class="mtr"><i></i><i></i><i></i></span><span class="lvl">' + esc(p.severity_ru || p.severity_label || '') + '</span></div>';
    }).join('') + '</div>';
  }

  // ═══ САЙТЫ ══════════════════════════════════════════════════════════════════
  function fillSites(panel, watch) {
    if (!watch.length) { panel.innerHTML = '<p class="nz-empty">Нет ссылок.</p>'; return; }
    var order = [], map = {};
    watch.forEach(function (w) { var l = w.kind_label || 'Ссылки'; if (!map[l]) { map[l] = []; order.push(l); } map[l].push(w); });
    var streamKinds = { 'Онлайн-кинотеатр': 1, 'Магазин': 1 };
    panel.innerHTML = order.map(function (l) {
      return '<div class="nz-sg"><span class="lbl">' + esc(l) + ' <em>' + map[l].length + '</em></span><div class="nz-links">' +
        map[l].map(function (s) {
          var stream = streamKinds[l];
          return '<a class="nz-lnk ' + (stream ? 'stream' : '') + '" href="' + esc(s.url) + '" target="_blank" rel="noopener">' +
            favIco(s.host, (s.host || '?')[0].toUpperCase(), 'ic') +
            '<span><b>' + esc(s.host) + '</b><span>' + (stream ? 'Открыть' : 'Перейти') + '</span></span></a>';
        }).join('') + '</div></div>';
    }).join('');
  }

  // ═══ ФОТО / ВИДЕО (ленивая /media) ══════════════════════════════════════════
  function lazyMedia(panel, cls) {
    panel.innerHTML = spinner();
    // ВАЖНО: без group=type. При group=type API отдаёт максимум 50 элементов НА
    // КАЖДУЮ группу (has_more:true), а построчная пагинация раскрывает только уже
    // загруженные тайлы — из-за чего «Фото/Видео» упирались в 50 и дальше не грузились.
    // Плоский ответ отдаёт все элементы (до limit), mediaGroups группирует их сам.
    var limit = cls === 'image' ? 1000 : 400;
    api('/api/v2/media/' + id + '?class=' + cls + '&limit=' + limit)
      .then(function (d) {
        if (cls !== 'image') return renderVideos(panel, d);
        // Сперва определяем режим каждого ИСТОЧНИКА (direct/proxy/drop) — по хосту,
        // не по картинке. Затем выкидываем недоступные ('drop') и рисуем; murl сам
        // возьмёт прямой URL или прокси по режиму хоста.
        var urls = [];
        // Пробим уменьшенные url (тот же хост) — иначе проба сэмплит tmdb-оригинал
        // через прокси на холодную (2–6 с) и блокирует отрисовку. Режим кешируется
        // по ХОСТУ, размер не важен — рендер оригиналов/эскизов применит тот же режим.
        mediaGroups(d).forEach(function (g) { (g.items || []).forEach(function (it) { if (it.url && !String(it.url).endsWith('.mp4')) urls.push(tmdbSize(it.url, 'w500')); }); });
        return resolveHostModes(urls).then(function (modes) { renderPhotos(panel, d, modes); });
      })
      .catch(function () { errBox(panel, function () { lazyMedia(panel, cls); }); });
  }
  function mediaGroups(d) {
    var top = d.items || [];
    if (top.length && top[0] && top[0].items) return top.map(function (g) { return { type: g.type, label: g.label || g.type, items: g.items }; });
    // плоский — сгруппировать по type
    var order = [], map = {};
    top.forEach(function (i) { if (!map[i.type]) { map[i.type] = []; order.push(i.type); } map[i.type].push(i); });
    return order.map(function (t) { return { type: t, label: t, items: map[t] }; });
  }
  var IMG_LABEL = { poster: 'Постеры', backdrop: 'Кадры и фоны', cover: 'Обложки', logo: 'Логотипы', promo: 'Промо и концепт-арт', backstage: 'Со съёмок', poster_gif: 'Живые постеры', still: 'Кадры' };
  var IMG_ORDER = ['poster', 'backdrop', 'still', 'cover', 'logo', 'promo', 'backstage', 'poster_gif'];
  var VID_LABEL = { trailer: 'Трейлеры', teaser: 'Тизеры', clip: 'Фрагменты', overview: 'Обзоры', behind_scenes: 'Со съёмок', blooper: 'Киноляпы', tvspot: 'ТВ-ролики', interview: 'Интервью', music_video: 'Клипы', other: 'Другое' };
  var VID_ORDER = ['trailer', 'teaser', 'clip', 'overview', 'behind_scenes', 'blooper', 'tvspot', 'interview', 'music_video', 'other'];

  // URL реально указывает на картинку (не видео-эмбед вроде vkvideo/youtube/*.php)?
  function isImageUrl(u) { return !!u && !/\/video_ext|youtube\.com|youtu\.be|vkvideo|rutube|\.php(\?|$)|\.m3u8/i.test(u); }
  function renderPhotos(panel, d, modes) {
    modes = modes || {};
    var groups = mediaGroups(d)
      // только настоящие типы изображений (в API под class=image иногда прилетает
      // type=other с URL видео — его в «Фото» не показываем)
      .filter(function (g) { return IMG_ORDER.indexOf(g.type) >= 0; })
      .map(function (g) {
        var items = g.items.filter(function (i) {
          if (g.type === 'poster_gif') return true;
          if (!isImageUrl(i.url)) return false;
          return modes[hostOf(i.url)] !== 'drop'; // отсекаем хосты, недоступные и напрямую, и через прокси
        });
        return { type: g.type, label: g.label, items: items };
      })
      .filter(function (g) { return g.items.length; })
      .sort(function (a, b) { return IMG_ORDER.indexOf(a.type) - IMG_ORDER.indexOf(b.type); });
    if (!groups.length) { panel.innerHTML = '<p class="nz-empty">Нет изображений.</p>'; return; }
    var total = groups.reduce(function (s, g) { return s + g.items.length; }, 0);
    var rank = function (l) { return l === 'ru' ? 0 : l === 'en' ? 1 : l ? 2 : 3; };
    var chips = '<button class="nz-lchip on" data-t="">Все <em>' + total + '</em></button>' +
      groups.map(function (g) { return '<button class="nz-lchip" data-t="' + g.type + '">' + esc(IMG_LABEL[g.type] || g.type) + ' <em>' + g.items.length + '</em></button>'; }).join('');
    // Пустые гриды — тайлы дорисовываются страницами (mountPaged), а не все сразу:
    // при 700+ фото массовый DOM ленивых <img> вызывал реф­лоу и «телепорт» плиток.
    panel.innerHTML = '<div class="nz-lbar">' + chips + '</div>' + groups.map(function (g) {
      var isPoster = (g.type === 'poster' || g.type === 'cover' || g.type === 'logo');
      return '<div class="nz-sg" data-type="' + g.type + '"><h3 class="nz-sg-h">' + esc(IMG_LABEL[g.type] || g.type) + ' <em>' + g.items.length + '</em></h3>' +
        '<div class="nz-photos' + (isPoster ? ' posters' : '') + '"></div></div>';
    }).join('');
    var sgs = panel.querySelectorAll('.nz-sg');
    groups.forEach(function (g, gi) {
      var isPoster = (g.type === 'poster' || g.type === 'cover' || g.type === 'logo');
      var items = g.items.slice().sort(function (a, b) { return rank(a.language) - rank(b.language); });
      mountPaged(sgs[gi].querySelector('.nz-photos'), items, photoTile, isPoster ? 24 : 12);
    });
    wireChips(panel);
  }
  function videoTile(v) {
    return '<a class="nz-vid" href="' + esc(v.url) + '" target="_blank" rel="noopener">' +
      '<img loading="lazy" src="' + esc(murl(tmdbSize(v.preview_url || v.thumbnail_url || '', 'w500'))) + '" alt="" onerror="this.style.opacity=0.15">' +
      '<div class="pl"><span>' + IC.play + '</span></div>' +
      (v.runtime_sec ? '<div class="mt"><span class="d">' + durSec(v.runtime_sec) + '</span></div>' : '') + '</a>';
  }
  function photoTile(it) {
    var badge = it.language ? '<span class="nz-photo-lang">' + esc(String(it.language).toUpperCase()) + '</span>' : '';
    var dl = ' data-lang="' + esc(it.language || '') + '"';
    if (String(it.url).endsWith('.mp4'))
      return '<div class="nz-photo"' + dl + '>' + badge + '<video src="' + esc(it.url) + '" autoplay muted loop playsinline></video></div>';
    return '<a class="nz-photo"' + dl + ' href="' + esc(it.url) + '" target="_blank" rel="noopener">' + badge +
      '<img loading="lazy" src="' + esc(murl(tmdbSize(it.url, 'w500'))) + '" alt="" onerror="this.onerror=null;this.style.opacity=0"></a>';
  }
  function renderVideos(panel, d) {
    var groups = mediaGroups(d).sort(function (a, b) { return VID_ORDER.indexOf(a.type) - VID_ORDER.indexOf(b.type); });
    if (!groups.length) { panel.innerHTML = '<p class="nz-empty">Нет видео.</p>'; return; }
    var total = groups.reduce(function (s, g) { return s + g.items.length; }, 0);
    var chips = '<button class="nz-lchip on" data-t="">Все <em>' + total + '</em></button>' +
      groups.map(function (g) { return '<button class="nz-lchip" data-t="' + g.type + '">' + esc(VID_LABEL[g.type] || g.type) + ' <em>' + g.items.length + '</em></button>'; }).join('');
    panel.innerHTML = '<div class="nz-lbar">' + chips + '</div>' + groups.map(function (g) {
      return '<div class="nz-sg" data-type="' + g.type + '"><h3 class="nz-sg-h">' + esc(VID_LABEL[g.type] || g.type) + ' <em>' + g.items.length + '</em></h3>' +
        '<div class="nz-vids"></div></div>';
    }).join('');
    var sgs = panel.querySelectorAll('.nz-sg');
    groups.forEach(function (g, gi) { mountPaged(sgs[gi].querySelector('.nz-vids'), g.items, videoTile, 12); });
    wireChips(panel);
  }

  // ═══ АКТЁРЫ (ленивая /cast) ══════════════════════════════════════════════════
  function lazyCast(panel) {
    panel.innerHTML = spinner();
    api('/api/v2/cast/' + id + '?limit=300')
      .then(function (d) { renderCast(panel, d); })
      .catch(function () { errBox(panel, function () { lazyCast(panel); }); });
  }
  // Русские названия ролей — фолбэк, если API не прислал group.label.
  var ROLE_RU = {
    director: 'Режиссёры', actor: 'Актёры', writer: 'Сценаристы', producer: 'Продюсеры',
    cinematographer: 'Операторы', composer: 'Композиторы', sound: 'Звукорежиссёры',
    art: 'Художники', editor: 'Монтажёры', voice_director: 'Режиссёры дубляжа',
    voice: 'Дубляж', translator: 'Переводчики', designer: 'Художники', operator: 'Операторы'
  };
  function castRecs(d) {
    var out = [], roleRu = {};
    (d.items || []).forEach(function (g) {
      if (g && g.items) { roleRu[g.role] = g.label || g.role_ru || g.role_label || ROLE_RU[g.role] || g.role; g.items.forEach(function (x) { out.push(x); }); }
      else out.push(g);
    });
    return { recs: out, roleRu: roleRu };
  }
  function renderCast(panel, d) {
    var pack = castRecs(d), recs = pack.recs, roleRu = pack.roleRu;
    if (!recs.length) { panel.innerHTML = '<p class="nz-empty">Нет данных о составе.</p>'; return; }
    function ph(p) { return p.photo_url || p.photo_url_kp || p.photo_url_tmdb || p.photo_url_kinorium; }
    function kino(r) { return r.person && r.person.kinorium_id != null ? String(r.person.kinorium_id) : ''; }
    // id для ссылки на /person/{kp_id} (страница персоны принимает kp id)
    function pid(p) { return p && p.kp_id != null && p.kp_id !== '' ? String(p.kp_id) : ''; }
    // дубляж → актёр
    var voiceByKino = {}, voiceByChar = {};
    recs.forEach(function (r) {
      if (r.role !== 'voice') return;
      var nm = r.person && r.person.name_ru; var db = r.dubs || {};
      if (db.kinorium_id) voiceByKino[String(db.kinorium_id)] = nm;
      var ch = r.character && (r.character.ru || r.character_ru); if (ch) voiceByChar[ch] = nm;
    });
    var actors = recs.filter(function (r) { return r.role === 'actor'; }).map(function (r) {
      var ch = r.character || {}; var chru = ch.ru || r.character_ru || '';
      return { char: chru, cphoto: ch.photo_url, actor: r.person && r.person.name_ru, aphoto: ph(r.person || {}), id: pid(r.person), voice: voiceByKino[kino(r)] || voiceByChar[chru] };
    });
    var CREW = ['director', 'writer', 'producer', 'cinematographer', 'composer', 'art', 'editor'];
    var crew = CREW.map(function (role) {
      var items = recs.filter(function (r) { return r.role === role; }).slice(0, 8)
        .map(function (r) { return { n: r.person && r.person.name_ru, p: ph(r.person || {}), id: pid(r.person) }; });
      return items.length ? { role_ru: roleRu[role] || ROLE_RU[role] || role, items: items } : null;
    }).filter(Boolean);

    function ini(n) { return (n || '?').split(' ').map(function (w) { return w[0]; }).slice(0, 2).join(''); }
    // Кликабельная карточка → /person/{kp_id}; без id — статичный блок (не мёртвая ссылка).
    function personCard(id, inner) {
      return id ? '<a class="nz-actor" href="/person/' + encodeURIComponent(id) + '">' + inner + '</a>'
                : '<div class="nz-actor nz-actor--static">' + inner + '</div>';
    }
    function actorCard(a) {
      var img = a.cphoto || a.aphoto;
      var inner = '<div class="av" data-l="' + esc(ini(a.char || a.actor)) + '">' +
        (img ? '<img loading="lazy" src="' + esc(murl(tmdbSize(img, 'w300'))) + '" alt="" onerror="this.remove()">' : '') + '</div>' +
        (a.char ? '<div class="nm">' + esc(a.char) + '</div><div class="rl">' + esc(a.actor) + '</div>' : '<div class="nm">' + esc(a.actor) + '</div>') +
        (a.voice ? '<div class="dub"><span>дубляж</span> ' + esc(a.voice) + '</div>' : '');
      return personCard(a.id, inner);
    }
    function crewCard(p) {
      var inner = '<div class="av" data-l="' + esc(ini(p.n)) + '">' +
        (p.p ? '<img loading="lazy" src="' + esc(murl(tmdbSize(p.p, 'w300'))) + '" alt="" onerror="this.remove()">' : '') + '</div><div class="nm">' + esc(p.n) + '</div>';
      return personCard(p.id, inner);
    }
    panel.innerHTML =
      (actors.length ? '<div class="nz-section-title">Актёры</div><div class="nz-cast">' + actors.map(actorCard).join('') + '</div>' : '') +
      crew.map(function (g) { return '<div class="nz-section-title">' + esc(g.role_ru) + '</div><div class="nz-cast">' + g.items.map(crewCard).join('') + '</div>'; }).join('');
  }

  // ═══ СЕРИИ (ленивая /episodes: сводка по сезонам → серии сезона) ════════════
  function lazyEpisodes(panel) {
    panel.innerHTML = spinner();
    api('/api/v2/episodes/' + id + '?group=season&limit=100').then(function (d) {
      var seasons = (d.items || []).filter(function (s) { return s.season != null; });
      if (!seasons.length) { panel.innerHTML = '<p class="nz-empty">Нет данных о сериях.</p>'; return; }
      var chips = seasons.map(function (s, i) {
        var label = s.season === 0 ? 'Спецвыпуски' : 'Сезон ' + s.season;
        return '<button class="nz-lchip' + (i === 0 ? ' on' : '') + '" data-s="' + s.season + '">' + label + ' <em>' + (s.episodes || '') + '</em></button>';
      }).join('');
      panel.innerHTML = '<div class="nz-lbar">' + chips + '</div><div class="nz-eplist" id="nzEpList"></div>';
      var list = panel.querySelector('#nzEpList');
      function load(season) {
        list.innerHTML = spinner();
        api('/api/v2/episodes/' + id + '?season=' + season + '&limit=300').then(function (e) {
          var eps = e.items || [];
          list.innerHTML = eps.length ? eps.map(epRow).join('') : '<p class="nz-empty">Нет серий.</p>';
        }).catch(function () { errBox(list, function () { load(season); }); });
      }
      panel.querySelectorAll('.nz-lchip').forEach(function (b) {
        b.onclick = function () {
          panel.querySelectorAll('.nz-lchip').forEach(function (x) { x.classList.toggle('on', x === b); });
          load(b.dataset.s);
        };
      });
      load(seasons[0].season);
    }).catch(function () { errBox(panel, function () { lazyEpisodes(panel); }); });
  }
  function epRow(ep) {
    var r = ep.rating_imdb || ep.rating_kr;
    var date = '';
    if (ep.air_date) { try { date = new Date(ep.air_date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { date = ep.air_date; } }
    var name = ep.name_ru || ep.name_en || ('Серия ' + ep.episode);
    return '<div class="nz-ep"><span class="num">' + ep.episode + '</span>' +
      '<div class="mid"><div class="t">' + esc(name) + '</div>' + (date ? '<div class="d">' + esc(date) + '</div>' : '') + '</div>' +
      (r != null ? '<span class="r ' + clsRating(r) + '">★ ' + r + '</span>' : '') + '</div>';
  }

  // ═══ ТЕКСТЫ: Цитаты / Факты / Вопросы (ленивая /texts) ══════════════════════
  function lazyTexts(panel, kind) {
    panel.innerHTML = spinner();
    api('/api/v2/texts/' + id + '?kind=' + kind + '&limit=200')
      .then(function (d) {
        var raw = d.items || [];
        // API 1.2 отдаёт ПЛОСКИЙ список записей (у каждой своё поле kind), а не группы
        // {kind, items[]}. Раньше код искал группу → .items был пуст → вкладки пустые.
        // Поддерживаем оба формата: если элементы — группы (есть .items), разворачиваем.
        var items = (raw.length && raw[0] && Array.isArray(raw[0].items))
          ? ((raw.find(function (g) { return g.kind === kind; }) || { items: [] }).items || [])
          : raw;
        if (kind === 'quote') renderQuotes(panel, items);
        else if (kind === 'faq') renderFaq(panel, items);
        else renderFacts(panel, items);
      })
      .catch(function () { errBox(panel, function () { lazyTexts(panel, kind); }); });
  }
  function renderQuotes(panel, items) {
    if (!items.length) { panel.innerHTML = '<p class="nz-empty">Нет цитат.</p>'; return; }
    panel.innerHTML = '<div class="nz-quotes">' + items.map(function (q) {
      return '<figure class="nz-quote"><span class="mk">“</span><blockquote>' + esc(q.text) + '</blockquote>' +
        (q.original ? '<div class="o">' + esc(q.original) + '</div>' : '') +
        (q.author ? '<figcaption class="b"><b>' + esc(q.author) + '</b>' + (q.author_role ? ' · ' + esc(q.author_role) : '') + '</figcaption>' : '') + '</figure>';
    }).join('') + '</div>';
  }
  function renderFaq(panel, items) {
    if (!items.length) { panel.innerHTML = '<p class="nz-empty">Нет вопросов.</p>'; return; }
    panel.innerHTML = '<div class="nz-faq">' + items.map(function (f) {
      return '<details class="nz-qa"><summary>' + IC.plus.replace('<svg', '<svg class="ic"') + '<span>' + esc(f.question) + '</span></summary><div class="bd">' + esc(f.answer) + '</div></details>';
    }).join('') + '</div>';
  }
  function renderFacts(panel, items) {
    if (!items.length) { panel.innerHTML = '<p class="nz-empty">Нет фактов.</p>'; return; }
    var groups = [['fact', 'Интересные факты'], ['blooper', 'Ляпы и ошибки']];
    panel.innerHTML = groups.map(function (g) {
      var list = items.filter(function (f) { return (f.fact_kind || 'fact') === g[0]; });
      if (!list.length) return '';
      return '<div class="nz-sg"><span class="lbl">' + g[1] + ' <em>' + list.length + '</em></span><div class="nz-facts-list">' +
        list.map(function (f) {
          var body = f.is_spoiler
            ? '<p class="nz-spoiler" onclick="this.classList.remove(\'nz-spoiler\')" title="Спойлер — нажмите">' + esc(f.text) + '</p>'
            : '<p>' + esc(f.text) + '</p>';
          return '<div class="nz-factrow"><span class="fi">' + (g[0] === 'fact' ? '💡' : '🎬') + '</span>' + body + '</div>';
        }).join('') + '</div></div>';
    }).join('');
  }

  // ═══ СВЯЗИ (ленивая /relations) ═════════════════════════════════════════════
  var REL_LABEL = { related: 'Франшиза', similar: 'Похожие', reference: 'Отсылки к', referenced_in: 'Упоминается в' };
  var REL_ORDER = ['related', 'similar', 'reference', 'referenced_in'];
  function lazyRelations(panel) {
    panel.innerHTML = spinner();
    Promise.all(REL_ORDER.map(function (rel) {
      return api('/api/v2/relations/' + id + '?relation=' + rel + '&limit=60')
        .then(function (d) { return { rel: rel, items: d.items || [] }; })
        .catch(function () { return { rel: rel, items: [] }; });
    })).then(function (groups) {
      groups = groups.filter(function (g) { return g.items.length; });
      if (!groups.length) { panel.innerHTML = '<p class="nz-empty">Нет связей.</p>'; return; }
      var total = groups.reduce(function (s, g) { return s + g.items.length; }, 0);
      var chips = '<button class="nz-lchip on" data-t="">Все <em>' + total + '</em></button>' +
        groups.map(function (g) { return '<button class="nz-lchip" data-t="' + g.rel + '">' + esc(REL_LABEL[g.rel] || g.rel) + ' <em>' + g.items.length + '</em></button>'; }).join('');
      panel.innerHTML = '<div class="nz-lbar">' + chips + '</div>' + groups.map(function (g) {
        return '<div class="nz-sg" data-type="' + g.rel + '"><h3 class="nz-sg-h">' + esc(REL_LABEL[g.rel] || g.rel) + ' <em>' + g.items.length + '</em></h3>' +
          '<div class="similars-list">' + g.items.map(relCard).join('') + '</div></div>';
      }).join('');
      wireChips(panel); PAGINATE[panel.id] = 3; applyPaginate(panel, 3);
    });
  }
  function relCard(m) {
    var t = m.title_ru || m.title || m.title_en || '';
    var r = m.rating_kp || m.rating_imdb || m.rating_tmdb;
    var meta = [m.year || null, r != null ? '★ ' + r : null].filter(Boolean).join(' · ');
    var p = m.poster_url || m.poster_kp || m.poster_tmdb;
    var href = m.kp_id ? '/movie/' + m.kp_id : '#';
    return '<a class="similar-card" href="' + esc(href) + '"><div class="similar-poster-wrap">' +
      '<img loading="lazy" src="' + esc(p ? murl(tmdbSize(p, 'w500')) : poster(p)) + '" alt="' + esc(t) + '" onerror="this.onerror=null;this.src=\'/img/placeholder.svg\'"></div>' +
      '<div class="similar-info"><div class="similar-title">' + esc(t) + '</div><div class="similar-meta">' + esc(meta) + '</div></div></a>';
  }

  // ═══ ЛОГОТИП (из /media, если есть) ═════════════════════════════════════════
  function initLogo(title) {
    api('/api/v2/media/' + id + '?class=image&type=logo&limit=40').then(function (d) {
      var top = d.items || [];
      var flat = (top.length && top[0] && top[0].items) ? top[0].items : top;
      if (!flat.length) return;
      var lang = userLang(), lr = langRankFor(lang);
      // только лого на языке пользователя; если таких нет — без языка / другой язык
      var matching = flat.filter(function (x) { return x.language === lang; });
      var pool = matching.length ? matching : flat.slice();
      // внутри пула: сперва нужный язык/нейтральный, затем PNG (обычно прозрачный)
      pool.sort(function (a, b) {
        var d = lr(a.language) - lr(b.language); if (d) return d;
        return (/\.png/i.test(a.url) ? 0 : 1) - (/\.png/i.test(b.url) ? 0 : 1);
      });
      var url = pool[0] && pool[0].url; if (!url) return;
      var purl = murl(url);
      var head = $('.content-header'); if (!head) return;
      var img = new Image();
      img.onload = function () { head.innerHTML = '<img class="nz-logo" style=\"display:block;margin:0 auto;max-width:min(460px,72%);max-height:118px;object-fit:contain\" src="' + esc(purl) + '" alt="' + esc(title) + '">'; };
      img.src = purl;
    }).catch(function () {});
  }

  // ═══ РОТАТОР ПОСТЕРОВ ═══════════════════════════════════════════════════════
  function initRotator(rot, med, title) {
    Promise.all([
      api('/api/v2/media/' + id + '?class=image&type=poster&limit=40').catch(function () { return null; }),
      // Живые постеры (poster_gif — короткие .mp4). Берём ВСЕГДА и на ЛЮБОМ языке
      // (у них language обычно null) — отдельным запросом, без языковой фильтрации.
      api('/api/v2/media/' + id + '?class=image&type=poster_gif&limit=20').catch(function () { return null; })
    ]).then(function (res) {
      var d = res[0] || {}, dg = res[1] || {};
      var top = d.items || [];
      var flat = (top.length && top[0] && top[0].items) ? top[0].items : top;
      var lang = userLang();
      var imgs = flat.filter(function (i) { return i.url && !i.url.endsWith('.mp4'); });
      // статичные постеры: на языке пользователя; если таких нет — без языка / другой язык
      var matching = imgs.filter(function (i) { return i.language === lang; });
      var rank = langRankFor(lang);
      var chosen = matching.length ? matching
        : imgs.slice().sort(function (a, b) { return rank(a.language) - rank(b.language); });
      var items = chosen.slice(0, 12).map(function (i) { return i.url; });
      // живые постеры — впереди (показываем первыми), любой язык, без дублей
      var gtop = dg.items || [];
      var gflat = (gtop.length && gtop[0] && gtop[0].items) ? gtop[0].items : gtop;
      var gifs = gflat.filter(function (i) { return i.url; }).map(function (i) { return i.url; });
      if (med.poster_gif) gifs.unshift(med.poster_gif);
      var seen = {};
      gifs = gifs.filter(function (u) { if (seen[u]) return false; seen[u] = 1; return true; });
      items = gifs.concat(items);
      if (!items.length) return;
      // Постер для «размытой подложки» под живым постером: у роликов разные
      // пропорции — вписываем видео целиком (contain), а пустоты вместо чёрных
      // полей заполняем размытым постером (прямой КП). Для ровных 2:3 подложки
      // не видно. Решает «то мелко с чёрными полями, то текст обрезан».
      var blur = med.poster_kp || STUB_POSTER || (med.poster_url ? murl(tmdbSize(med.poster_url, 'w300')) : '') || '';
      rot.innerHTML = items.map(function (u, i) {
        return u.endsWith('.mp4')
          ? '<div class="rot-frame gif' + (i === 0 ? ' on' : '') + '">' +
              (blur ? '<div class="rot-blurbg" style="background-image:url(\'' + esc(blur) + '\')"></div>' : '') +
              '<video src="' + esc(u) + '" autoplay muted playsinline onerror="this.closest(\'.rot-frame\').remove()"></video></div>'
          : '<div class="rot-frame' + (i === 0 ? ' on' : '') + '"><img src="' + esc(murl(tmdbSize(u, 'w780'))) + '" alt="' + esc(title) + '" loading="' + (i < 2 ? 'eager' : 'lazy') + '" onerror="this.closest(\'.rot-frame\').remove()"></div>';
      }).join('');
      // «Умно»: меряем реальные пропорции ролика. Близко к 2:3 → cover (заполняет
      // рамку, по умолчанию). Сильно другие (>10%) → .fit = contain + размытый фон
      // (видно целиком, без чёрных полос и без обрезки вшитого текста).
      var TARGET = 2 / 3;
      [].slice.call(rot.querySelectorAll('.rot-frame.gif video')).forEach(function (v) {
        var apply = function () {
          var r = (v.videoWidth && v.videoHeight) ? v.videoWidth / v.videoHeight : 0;
          if (!r) return;
          var fr = v.closest('.rot-frame');
          if (fr) fr.classList.toggle('fit', Math.abs(r - TARGET) / TARGET > 0.10);
        };
        if (v.videoWidth) apply(); else v.addEventListener('loadedmetadata', apply, { once: true });
      });
      var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      var els = [].slice.call(rot.children);
      if (els.length < 2 || reduce) { var v = rot.querySelector('video'); if (v) v.loop = true; return; }
      var i = 0, GIF_LOOPS = 4, IMG_MS = 6000, tm = null;
      function sched() {
        var isGif = els[i].classList.contains('gif');
        if (isGif) { var v = els[i].querySelector('video'), n = 0; v.loop = false; try { v.currentTime = 0; } catch (e) {} v.play().catch(function () {});
          v.onended = function () { if (++n >= GIF_LOOPS) { v.onended = null; adv(); } else { try { v.currentTime = 0; } catch (e) {} v.play().catch(function () {}); } };
        } else tm = setTimeout(adv, IMG_MS);
      }
      function adv() { clearTimeout(tm); els[i].classList.remove('on'); i = (i + 1) % els.length; els[i].classList.add('on'); sched(); }
      sched();
    }).catch(function () {});
  }

  // ═══ ИЗБРАННОЕ («Буду смотреть») ════════════════════════════════════════════
  function initFav() {
    var btn = $('#nzFav'); if (!btn) return;
    var authed = !!(window._nzUser || (function () { try { return sessionStorage.getItem('nz_me') || localStorage.getItem('nz_me'); } catch (e) { return null; } })());
    var hdr = (typeof _bearerHeader === 'function') ? _bearerHeader() : {};
    var inFlight = false, fav = false;
    function paint() { btn.classList.toggle('on', fav); btn.innerHTML = (fav ? IC.ok : IC.plus) + (fav ? ' В списке' : ' Буду смотреть'); }
    if (authed) {
      fetch(API + '/api/favorites/' + id, { credentials: CREDS, headers: hdr })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { if (d) { fav = !!d.favorited; paint(); } })
        .catch(function () {});
    }
    btn.onclick = function () {
      if (!authed) { if (window.openAuthModal) openAuthModal(function () { location.reload(); }); return; }
      if (inFlight) return; inFlight = true;
      fetch(API + '/api/favorites/' + id, { method: fav ? 'DELETE' : 'POST', credentials: CREDS, headers: hdr })
        .then(function (r) { if (r.ok) { fav = !fav; paint(); } })
        .finally(function () { inFlight = false; });
    };
    paint();
  }

  // «Кинорежим»: виджет плеера центрируется и увеличивается поверх затемнённого
  // фона (НЕ на весь монитор — с полями). Открытие кладёт запись в history, поэтому
  // «Назад» (кнопка/браузер/Esc/клик по фону) СНАЧАЛА закрывает кинорежим, а не уходит
  // со страницы. Само закрытие идёт через history.back() → popstate → _cineClose.
  var _nzV2Tab = 0; // индекс активной вкладки (для записи в history вместе с кинорежимом)
  function _cineIsOpen() { var s = document.querySelector('.player-section'); return !!(s && s.classList.contains('nz-player-expanded')); }
  function _playerEscClose(e) { if (e.key === 'Escape' && _cineIsOpen()) history.back(); }
  function _cineOpen() {
    var sec = document.querySelector('.player-section'); if (!sec) return;
    sec.classList.add('nz-player-expanded');
    var bd = document.getElementById('nzPlayerBackdrop');
    if (!bd) { bd = el('div', 'nz-player-backdrop'); bd.id = 'nzPlayerBackdrop'; document.body.appendChild(bd); bd.addEventListener('click', function () { if (_cineIsOpen()) history.back(); }); }
    requestAnimationFrame(function () { bd.classList.add('on'); });
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', _playerEscClose);
  }
  function _cineClose() {
    var sec = document.querySelector('.player-section'); if (sec) sec.classList.remove('nz-player-expanded');
    var bd = document.getElementById('nzPlayerBackdrop'); if (bd) bd.classList.remove('on');
    document.body.style.overflow = '';
    document.removeEventListener('keydown', _playerEscClose);
  }
  function togglePlayerFs() {
    if (_cineIsOpen()) { history.back(); return; }             // закрытие — через историю
    _cineOpen();
    try { history.pushState({ nzv2: true, tab: _nzV2Tab, cine: true }, ''); } catch (e) {}
  }

  // ═══ ОЦЕНКА (10 звёзд, шаг 0.1) ═════════════════════════════════════════════
  // Наведение заполняет звёзды до курсора (десятые внутри звезды), клик сохраняет.
  // SVG со звёздами масштабируется под ширину колонки постера (не ломается на узких).
  function initStars() {
    var host = $('#nzStars'); if (!host) return;
    // Округлая «эппловская» звезда (Ionicons star), система координат 512 на ячейку.
    var STAR_D = 'M394 480a16 16 0 01-9.39-3L256 383.76 127.39 477a16 16 0 01-24.55-18.08L153 310.35 23 221.2a16 16 0 019-29.2h160.38l48.4-148.95a16 16 0 0130.44 0l48.4 149H480a16 16 0 019.05 29.2L359 310.35l50.13 148.53A16 16 0 01394 480z';
    var CELL = 512, W = CELL * 10;
    var uses = '';
    for (var i = 0; i < 10; i++) uses += '<use href="#nzStar" x="' + (i * CELL) + '"/>';
    host.innerHTML =
      '<svg class="nz-stars-svg" viewBox="0 0 ' + W + ' ' + CELL + '" role="slider" aria-label="Ваша оценка" aria-valuemin="1" aria-valuemax="10" tabindex="0">' +
        '<defs><path id="nzStar" d="' + STAR_D + '"/>' +
        '<clipPath id="nzStarClip">' + uses + '</clipPath></defs>' +
        '<rect class="nz-stars-bg" x="0" y="0" width="' + W + '" height="' + CELL + '" clip-path="url(#nzStarClip)"/>' +
        '<rect class="nz-stars-fg" id="nzStarsFg" x="0" y="0" width="0" height="' + CELL + '" clip-path="url(#nzStarClip)"/>' +
      '</svg><div class="nz-stars-val" id="nzStarsVal">Оцените фильм</div>';
    var svg = host.querySelector('.nz-stars-svg'), fg = $('#nzStarsFg'), lbl = $('#nzStarsVal');
    var saved = null, avg = 0, votes = 0, busy = false;
    function fmt(v) { return (Math.round(v * 10) / 10).toFixed(1); }
    function paint(v) { fg.setAttribute('width', Math.max(0, Math.min(10, v || 0)) * CELL); }
    function label() {
      if (saved != null) lbl.textContent = 'Ваша оценка: ' + fmt(saved);
      else if (votes > 0 && avg) lbl.textContent = 'NaZeleniy ' + fmt(avg) + ' · ' + nf(votes);
      else lbl.textContent = 'Оцените фильм';
    }
    function valAt(clientX) { var r = svg.getBoundingClientRect(); var f = (clientX - r.left) / r.width; return Math.max(1, Math.min(10, Math.round(f * 100) / 10)); }
    svg.addEventListener('mousemove', function (e) { var v = valAt(e.clientX); paint(v); lbl.textContent = fmt(v); });
    svg.addEventListener('mouseleave', function () { paint(saved || 0); label(); });
    svg.addEventListener('click', function (e) { save(valAt(e.clientX)); });
    svg.addEventListener('keydown', function (e) {
      var base = saved || 0, nv = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') nv = Math.min(10, Math.round((base + 0.1) * 10) / 10);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') nv = Math.max(1, Math.round((base - 0.1) * 10) / 10);
      else if (e.key === 'Enter' && base) return save(base);
      if (nv != null) { e.preventDefault(); paint(nv); lbl.textContent = fmt(nv); }
    });
    function authed() { try { return !!(window._nzUser || sessionStorage.getItem('nz_me') || localStorage.getItem('nz_me')); } catch (e) { return !!window._nzUser; } }
    function save(v) {
      if (busy) return;
      if (!authed()) { if (window.openAuthModal) openAuthModal(function () { save(v); }); return; }
      busy = true; var prev = saved; saved = v; paint(v); label();
      var hdr = Object.assign({ 'Content-Type': 'application/json' }, (typeof _bearerHeader === 'function') ? _bearerHeader() : {});
      fetch(API + '/api/ratings/' + id, { method: 'POST', headers: hdr, credentials: CREDS, body: JSON.stringify({ rating: v }) })
        .then(function (r) { if (r.status === 401) { saved = prev; paint(saved || 0); label(); if (window.openAuthModal) openAuthModal(); throw 0; } if (!r.ok) throw 0; })
        .then(function () { load(); })
        .catch(function () { saved = prev; paint(saved || 0); label(); })
        .finally(function () { busy = false; });
    }
    function load() {
      api('/api/ratings/' + id).then(function (d) {
        avg = d.ratingNazeleniy || 0; votes = d.ratingNazeleniyVoteCount || 0;
        if (d.userRating != null) saved = d.userRating;
        svg.setAttribute('aria-valuenow', saved != null ? saved : '');
        paint(saved || 0); label();
      }).catch(function () {});
    }
    load();
  }

  // ═══ УМНАЯ ПАГИНАЦИЯ (полные ряды под ширину) ═══════════════════════════════
  // Предзагрузка картинки: резолвит true, если реально загрузилась. Региональные
  // блокировки/404 отдают ошибку сети → onerror → false (тайл не покажем). Таймаут,
  // чтобы зависший запрос не держал скелетон вечно.
  function probeImg(url, timeoutMs) {
    return new Promise(function (res) {
      if (!url) { res(true); return; }
      var done = false, im = new Image();
      var t = setTimeout(function () { if (!done) { done = true; im.onload = im.onerror = null; res(false); } }, timeoutMs || 9000);
      im.onload = function () { if (!done) { done = true; clearTimeout(t); res(im.naturalWidth > 0); } };
      im.onerror = function () { if (!done) { done = true; clearTimeout(t); res(false); } };
      im.src = url;
    });
  }

  // Достижимость ИСТОЧНИКОВ: регион-блок работает на уровне домена (image.tmdb.org
  // недоступен в РФ), поэтому вместо пробы каждой картинки проверяем по 1-3 образца
  // НА ХОСТ и отсеиваем сразу ВСЕ картинки забаненных хостов. Кешируем на страницу.
  function hostOf(u) { try { return new URL(u, location.href).hostname; } catch (e) { return ''; } }
  // Берём N образцов, РАВНОМЕРНО размазанных по списку (а не первые N — среди них
  // могут случайно оказаться битые/404, из-за чего живой хост ошибочно забанится).
  function pickSamples(urls, n) {
    if (urls.length <= n) return urls.slice();
    var out = [], stepp = urls.length / n;
    for (var i = 0; i < n; i++) out.push(urls[Math.floor(i * stepp)]);
    return out;
  }
  // Грузится ли хоть один из образцов (по прямым или проксированным URL). До 6
  // образцов, таймаут 10с, «ок» если загрузился ХОТЯ БЫ ОДИН — медленный-но-живой
  // CDN не забракуется, а реально заблокированный (DPI-reset) упадёт по всем за миг.
  function probeAny(urls) {
    return new Promise(function (res) {
      var left = urls.length, settled = false;
      if (!left) { res(true); return; }
      urls.forEach(function (u) {
        probeImg(u, 10000).then(function (ok) {
          if (settled) return;
          if (ok) { settled = true; res(true); }
          else if (--left === 0) res(false);
        });
      });
    });
  }
  // Кэш вердикта по хосту на СЕССИЮ (регион-блок стабилен → не перепроверяем на
  // каждом открытии фильма). _hostMode — в памяти, sessionStorage — между переходами.
  var _hostModeP = {}; // host -> Promise<mode> (защита от гонок в рамках страницы)
  function cachedMode(host) { if (_hostMode[host]) return _hostMode[host]; try { return sessionStorage.getItem('nz_hm_' + host) || ''; } catch (e) { return ''; } }
  function setMode(host, mode) { _hostMode[host] = mode; try { sessionStorage.setItem('nz_hm_' + host, mode); } catch (e) {} return mode; }
  // Определяем режим хоста: сперва пробуем НАПРЯМУЮ (доступен → 'direct', прокси не
  // нужен). Если напрямую не грузится и прокси разрешён — пробуем через прокси
  // ('proxy'), иначе 'drop'. Так через бэкенд идёт ТОЛЬКО реально заблокированное.
  function probeHostMode(host, samples) {
    var c = cachedMode(host); if (c) { _hostMode[host] = c; return Promise.resolve(c); }
    if (_hostModeP[host]) return _hostModeP[host];
    var picks = pickSamples(samples, 6);
    _hostModeP[host] = probeAny(picks).then(function (okDirect) {
      if (okDirect) return setMode(host, 'direct');
      if (!MEDIA_PROXY) return setMode(host, 'drop');
      return probeAny(picks.map(proxied)).then(function (okProxy) { return setMode(host, okProxy ? 'proxy' : 'drop'); });
    });
    return _hostModeP[host];
  }
  // urls → { host: 'direct'|'proxy'|'drop' }; попутно заполняет _hostMode (его читает murl)
  function resolveHostModes(urls) {
    var byHost = {};
    urls.forEach(function (u) { var h = hostOf(u); if (h) (byHost[h] = byHost[h] || []).push(u); });
    var hs = Object.keys(byHost);
    return Promise.all(hs.map(function (h) { return probeHostMode(h, byHost[h]).then(function (m) { return [h, m]; }); }))
      .then(function (pairs) { var m = {}; pairs.forEach(function (p) { m[p[0]] = p[1]; }); return m; });
  }

  // Пагинация «своими руками»: весь массив держим в JS, в DOM рисуем страницами.
  // «Показать ещё» дорисовывает следующую пачку (append), а не раскрывает через
  // display:none заранее отрисованные сотни тайлов — так DOM остаётся лёгким и
  // плитки не «телепортируются» от массового реф­лоу ленивых картинок.
  // opt.probe: сперва проверяем каждую картинку (скелетон-шиммер), в грид кладём
  // только успешно загрузившиеся — заблокированные по региону просто не появляются,
  // без onerror→display:none и последующего сдвига соседей.
  // Все элементы уже отфильтрованы по достижимым хостам (см. resolveHostModes), поэтому
  // здесь просто рисуем страницами: «Показать ещё» дорисовывает следующую пачку.
  function mountPaged(grid, items, renderItem, step) {
    if (!grid) return;
    var shown = 0, btn = null;
    function draw() {
      var batch = items.slice(shown, shown + step); shown += batch.length;
      grid.insertAdjacentHTML('beforeend', batch.map(renderItem).join(''));
      if (shown >= items.length) { if (btn) { btn.remove(); btn = null; } return; }
      if (!btn) { btn = el('button', 'nz-more'); grid.parentNode.appendChild(btn); btn.onclick = function () { draw(); }; }
      btn.textContent = 'Показать ещё ' + Math.min(step, items.length - shown) + ' · осталось ' + (items.length - shown);
    }
    draw();
  }

  var PAGINATE = {};
  function measureCols(grid, tiles) {
    var first = tiles[0]; if (!first) return 1;
    var prev = first.style.display; first.style.display = '';
    var csg = getComputedStyle(grid); var gap = parseFloat(csg.columnGap || csg.gap) || 0;
    var tw = first.getBoundingClientRect().width || 1; first.style.display = prev;
    var w = grid.clientWidth || (first.parentElement && first.parentElement.clientWidth) || 1;
    return Math.max(1, Math.round((w + gap) / (tw + gap)));
  }
  function applyPaginate(panel, rows) {
    panel.querySelectorAll('.nz-sg').forEach(function (sg) {
      if (sg.style.display === 'none') return;
      var grid = sg.querySelector('.similars-list, .nz-photos, .nz-vids'); if (!grid) return;
      var tiles = [].slice.call(grid.children); if (!tiles.length) return;
      var cols = measureCols(grid, tiles);
      var shownRows = +sg.dataset.pgRows || rows; sg.dataset.pgRows = shownRows;
      var shown = Math.min(tiles.length, cols * shownRows);
      tiles.forEach(function (t, i) { t.style.display = i < shown ? '' : 'none'; });
      var btn = sg.querySelector('.nz-more');
      if (shown >= tiles.length) { if (btn) btn.remove(); return; }
      if (!btn) { btn = el('button', 'nz-more'); sg.appendChild(btn); btn.onclick = function () { sg.dataset.pgRows = (+sg.dataset.pgRows || rows) + rows; applyPaginate(panel, rows); }; }
      var left = tiles.length - shown;
      btn.textContent = 'Показать ещё ' + Math.min(cols * rows, left) + ' · осталось ' + left;
    });
  }
  function refreshActivePaginate() {
    Object.keys(PAGINATE).forEach(function (pid) { var p = document.getElementById(pid); if (p && p.classList.contains('on')) applyPaginate(p, PAGINATE[pid]); });
  }
  function wireChips(panel) {
    panel.querySelectorAll('.nz-lchip').forEach(function (btn) {
      btn.onclick = function () {
        var t = btn.dataset.t;
        panel.querySelectorAll('.nz-lchip').forEach(function (b) { b.classList.toggle('on', b === btn); });
        panel.querySelectorAll('.nz-sg').forEach(function (sg) { sg.style.display = (!t || sg.dataset.type === t) ? '' : 'none'; });
        if (PAGINATE[panel.id]) applyPaginate(panel, PAGINATE[panel.id]);
      };
    });
  }
  function spinner() { return '<div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i></div>'; }
  // Ошибка с кнопкой «Повторить»: retry() перезапускает загрузку вкладки.
  function errBox(target, retry) {
    target.innerHTML = '<div class="nz-err"><span>Не удалось загрузить.</span> <button class="nz-more" type="button">Повторить</button></div>';
    var b = target.querySelector('button'); if (b) b.onclick = retry;
  }
})();
