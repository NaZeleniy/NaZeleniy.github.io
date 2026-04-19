// Если браузер закэшировал старый HTML — форсируем перезагрузку.
// Версия обновляется автоматически pre-commit хуком вместе с остальными ?v=
;(function () {
  var V = 'v=1776609108'
  var key = 'nz_page_v'
  var stored = localStorage.getItem(key)
  if (stored !== V) {
    localStorage.setItem(key, V)
    // hard reload: обходит кэш браузера
    var url = location.href.replace(/[?&]_nocache=[^&]*/g, '')
    var sep = url.includes('?') ? '&' : '?'
    location.replace(url + sep + '_nocache=' + Date.now())
  } else if (location.search.includes('_nocache')) {
    // убираем _nocache из адресной строки без перезагрузки
    var clean = location.href.replace(/[?&]_nocache=[^&]*/g, '').replace(/[?&]$/, '')
    history.replaceState(null, '', clean)
  }
})()
