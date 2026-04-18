const API_BASE = window.location.hostname.endsWith('github.io')
  ? 'https://nazeleniy.site'
  : ''

// credentials mode для fetch:
// - same-origin (API_BASE = ''): 'include' — куки работают
// - github.io cross-origin с корректным origin: 'include' — CORS разрешает
// - TV/webview с null-origin, app://-схемой или любым нестандартным origin: 'omit'
//   (браузер блокирует 'include' когда сервер отвечает Access-Control-Allow-Origin: *)
//   Bearer-токен в Authorization-заголовке работает без cookies
const _CREDS = (() => {
  if (!API_BASE) return 'include'
  const o = location.origin  // API_BASE !== '' только на github.io-страницах
  if (o === 'null' || !o.endsWith('github.io')) return 'omit'
  return 'include'
})()

const PLACEHOLDER = '/img/placeholder.svg'

function posterUrl(url, size) {
  if (!url || url.includes('no-poster')) return PLACEHOLDER
  if (url.includes('avatars.mds.yandex.net')) {
    const s = size || (window.innerWidth >= 1400 ? '480x720' : '360x540')
    return url.replace(/\/\d+x\d+$/, '/' + s)
  }
  return url
}

function _bearerHeader() {
  try {
    const t = localStorage.getItem('nz_bearer')
    return t ? { Authorization: 'Bearer ' + t } : {}
  } catch { return {} }
}

function vibixSrcdoc(kpId, height) {
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{margin:0;padding:0}body{background:#000}</style>
<script src="https://graphicslab.io/sdk/v2/rendex-sdk.min.js"></script>
</head><body>
<ins data-publisher-id="677393820" data-type="kp" data-id="${kpId}" data-design="2" data-height="${height}" data-color1="#333333" data-color2="#666666" data-color3="#999999" data-color4="#CCCCCC" data-color5="#FFFFFF"></ins>
</body></html>`
}
