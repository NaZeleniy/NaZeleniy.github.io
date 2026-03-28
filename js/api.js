const API_BASE = window.location.hostname.endsWith('github.io')
  ? 'https://nazeleniy.mooo.com'
  : ''

function posterUrl(url) {
  if (!url) return ''
  return API_BASE + '/proxy/poster?url=' + encodeURIComponent(url)
}
