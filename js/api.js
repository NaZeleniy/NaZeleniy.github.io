const API_BASE = 'https://nazeleniy.mooo.com'

function posterUrl(url) {
  if (!url) return ''
  return API_BASE + '/proxy/poster?url=' + encodeURIComponent(url)
}
