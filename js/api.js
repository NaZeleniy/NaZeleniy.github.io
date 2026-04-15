const API_BASE = window.location.hostname.endsWith('github.io')
  ? 'https://nazeleniy.site'
  : ''

const PLACEHOLDER = '/img/placeholder.svg'

function posterUrl(url) {
  // KP API иногда возвращает свой URL-заглушки "no-poster.png", который сам отдаёт 404.
  // Заменяем его на наш placeholder сразу, до того как браузер попытается загрузить.
  if (!url || url.includes('no-poster')) return PLACEHOLDER
  return url
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
