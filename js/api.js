const API_BASE = window.location.hostname === 'nazeleniy.mooo.com'
  ? 'https://nazeleniy.mooo.com'
  : ''

function posterUrl(url) {
  if (!url) return ''
  return API_BASE + '/proxy/poster?url=' + encodeURIComponent(url)
}
