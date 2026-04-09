// Если браузер закэшировал старый HTML — форсируем перезагрузку.
// Версия обновляется автоматически pre-commit хуком вместе с остальными ?v=
;(function () {
  var V = 'v=1775751827'
  var key = 'nz_page_v'
  var stored = localStorage.getItem(key)
  if (stored !== V) {
    localStorage.setItem(key, V)
    // hard reload: обходит кэш браузера
    var url = location.href.replace(/[?&]_nocache=[^&]*/g, '')
    var sep = url.includes('?') ? '&' : '?'
    location.replace(url + sep + '_nocache=' + Date.now())
  }
})()
