// Если браузер закэшировал старый HTML — форсируем перезагрузку.
// Версия обновляется автоматически pre-commit хуком вместе с остальными ?v=
;(function () {
  var V = 'v=1782736285'
  var key = 'nz_page_v'
  var stored = localStorage.getItem(key)
  if (stored !== V) {
    localStorage.setItem(key, V)
    // Первый визит (stored===null): HTML только что пришёл из сети — браузер ещё
    // ничего не кешировал, SW не установлен. Хард-релоад тут только удвоил бы
    // FCP/LCP и плодил _nocache-URL у ботов (их localStorage не персистится между
    // запросами → каждый краул считался бы «первым визитом»). Бастить нечего.
    if (stored === null) return
    // Если страницу уже контролирует Service Worker (а он network-first для HTML),
    // свежий HTML с новыми ?v= уже пришёл из сети — хард-релоад лишний и давал бы
    // двойную загрузку у каждого вернувшегося юзера на каждый деплой.
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      if (location.search.includes('_nocache')) {
        history.replaceState(null, '', location.href.replace(/[?&]_nocache=[^&]*/g, '').replace(/[?&]$/, ''))
      }
      return
    }
    // hard reload: обходит кэш браузера (первый визит / нет SW)
    var url = location.href.replace(/[?&]_nocache=[^&]*/g, '')
    var sep = url.includes('?') ? '&' : '?'
    location.replace(url + sep + '_nocache=' + Date.now())
  } else if (location.search.includes('_nocache')) {
    // убираем _nocache из адресной строки без перезагрузки
    var clean = location.href.replace(/[?&]_nocache=[^&]*/g, '').replace(/[?&]$/, '')
    history.replaceState(null, '', clean)
  }
})()

// Ненавязчивое уведомление о новой версии. Авто-reload НЕ делаем намеренно — на
// странице фильма он прервал бы просмотр. Показываем тост, перезагрузка по клику.
// SW использует skipWaiting+clients.claim, поэтому к моменту клика новый воркер
// уже контролирует страницу → reload сразу подтянет свежие ассеты.
;(function () {
  if (!('serviceWorker' in navigator)) return

  function showUpdateToast() {
    if (document.getElementById('nz-update-toast')) return
    var root = document.body || document.documentElement
    if (!root) return
    var bar = document.createElement('div')
    bar.id = 'nz-update-toast'
    bar.style.cssText = 'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:99999;display:flex;align-items:center;gap:12px;background:#1c1c1c;color:#fff;border:1px solid #333;border-radius:12px;padding:11px 14px;box-shadow:0 8px 30px rgba(0,0,0,.5);font:14px/1.3 system-ui,-apple-system,sans-serif;max-width:calc(100vw - 32px)'
    var txt = document.createElement('span')
    txt.textContent = 'Доступна новая версия'
    var btn = document.createElement('button')
    btn.type = 'button'
    btn.textContent = 'Обновить'
    btn.style.cssText = 'background:#27ae60;color:#fff;border:0;border-radius:8px;padding:7px 14px;font:600 14px system-ui,sans-serif;cursor:pointer'
    btn.onclick = function () { location.reload() }
    var close = document.createElement('button')
    close.type = 'button'
    close.textContent = '✕'
    close.setAttribute('aria-label', 'Закрыть')
    close.style.cssText = 'background:none;border:0;color:#888;font-size:16px;line-height:1;cursor:pointer;padding:0 2px'
    close.onclick = function () { bar.remove() }
    bar.appendChild(txt)
    bar.appendChild(btn)
    bar.appendChild(close)
    root.appendChild(bar)
  }

  navigator.serviceWorker.register('/sw.js').then(function (reg) {
    // Новый воркер уже установлен и ждёт активации
    if (reg.waiting && navigator.serviceWorker.controller) showUpdateToast()
    reg.addEventListener('updatefound', function () {
      var nw = reg.installing
      if (!nw) return
      nw.addEventListener('statechange', function () {
        // 'installed' + есть контроллер = это ОБНОВЛЕНИЕ, а не первая установка
        // (на первом визите controller ещё null — тост не показываем)
        if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdateToast()
      })
    })
  }).catch(function () {})
})()
