const API_BASE = window.location.hostname.endsWith('github.io')
  ? 'https://nazeleniy.mooo.com'
  : ''

const PLACEHOLDER = '/img/placeholder.svg'

function posterUrl(url) {
  if (!url) return PLACEHOLDER
  return API_BASE + '/proxy/poster?url=' + encodeURIComponent(url)
}

function vibixSrcdoc(kpId, height) {
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{margin:0;padding:0}body{background:#000}</style>
<script src="https://graphicslab.io/sdk/v2/rendex-sdk.min.js"></script>
</head><body>
<ins data-publisher-id="677393820" data-type="kp" data-id="${kpId}" data-design="2" data-height="${height}" data-color1="#333333" data-color2="#666666" data-color3="#999999" data-color4="#CCCCCC" data-color5="#FFFFFF"></ins>
<script>
window.addEventListener('message',function(e){
  if(e.source===window.parent){
    document.querySelectorAll('iframe').forEach(function(f){f.contentWindow.postMessage(e.data,'*');});
  } else {
    window.parent.postMessage(e.data,'*');
  }
});
<\/script>
</body></html>`
}
