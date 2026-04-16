const API_BASE = window.location.hostname.endsWith('github.io')
  ? 'https://nazeleniy.site'
  : ''

// credentials mode для fetch:
// - same-origin (API_BASE = ''): 'include' — куки работают
// - null-origin (TV webview, file://, sandboxed iframe): 'omit' — только Bearer
//   (браузер блокирует 'include' когда сервер отвечает Access-Control-Allow-Origin: *)
// - известный cross-origin (github.io): 'include'
const _CREDS = (() => {
  if (!API_BASE) return 'include'
  if (typeof location !== 'undefined' && location.origin === 'null') return 'omit'
  return 'include'
})()

const PLACEHOLDER = '/img/placeholder.svg'

function posterUrl(url) {
  // KP API иногда возвращает свой URL-заглушки "no-poster.png", который сам отдаёт 404.
  // Заменяем его на наш placeholder сразу, до того как браузер попытается загрузить.
  if (!url || url.includes('no-poster')) return PLACEHOLDER
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
