const API_BASE = window.location.hostname.endsWith('github.io')
  ? 'https://nazeleniy.mooo.com'
  : ''

const PLACEHOLDER = '/img/placeholder.svg'

function posterUrl(url) {
  if (!url) return PLACEHOLDER
  return API_BASE + '/proxy/poster?url=' + encodeURIComponent(url)
}
