// ================================================================
const STREAMERS_LIST = [
  {
    nick: 'serega_pirat',
    sources: [
      { url: 'https://t.me/BFBF10' },
    ]
  },
  {
    nick: 'qeqoqeq',
    sources: [
      { url: 'https://t.me/qeqoqeq_Films' },
    ]
  },
  {
    nick: 'dinablin',
    sources: [
      { url: 'https://t.me/AnimeDinablin' },
    ]
  },
  {
    nick: 'skywhywalker',
    sources: [
      { url: 'https://t.me/skywhyfilm' },
    ]
  },
  {
    nick: 't2x2',
    sources: [
      { url: 'https://t.me/t2x2_clip' },
    ]
  },
  {
    nick: 'guit88man',
    sources: [
      { url: 'https://t.me/guitman_anistream' },
    ]
  },
  {
    nick: 'stintik',
    sources: [
      { url: 'https://t.me/stintvod' },
    ]
  },
  {
    nick: 'derzko69',
    sources: [
      { url: 'https://t.me/derzko69archive' },
    ]
  },
  {
    nick: 'by_owl',
    sources: [
      { url: 'https://t.me/by_owl_vods' },
    ]
  },
  {
    nick: 'evelone2004',
    sources: [
      { url: 'https://t.me/Eveloneanime' },
    ]
  },
  {
    nick: 'mazellovvv',
    sources: [
      { url: 'https://t.me/mazellovvvfilms' },
    ]
  },
  {
    nick: 'kussia88',
    sources: [
      { url: 'https://t.me/kussia_streams' },
    ]
  },
  {
    nick: 'honeymad',
    sources: [
      { url: 'https://t.me/dedvods' },
    ]
  },
  {
    nick: 'rostikfacekid',
    sources: [
      { url: 'https://t.me/uglyfacekidstreams' },
    ]
  },
  {
    nick: 'buster',
    sources: [
      { url: 'https://t.me/busteranime' },
    ]
  },
  {
    nick: 'bratishkinoff',
    sources: [
      { url: 'https://t.me/bratishkinfullstreams' },
    ]
  },
  {
    nick: 'zubarefff',
    sources: [
      { url: 'https://t.me/kjwdnfwdkjf' },
    ]
  },
  {
    nick: 'fasoollka',
    sources: [
      { url: 'https://t.me/+EF600Qoarmo2ZTZi' },
    ]
  },
  {
    nick: 'yumiliya_nya',
    sources: [
      { url: 'https://t.me/Yumiliya_yumi' },
    ]
  },
  {
    nick: 'degrastream',
    sources: [
      { url: 'https://t.me/archive_degrastream/2' },
    ]
  },
  {
    nick: 'mayni_yt',
    sources: [
      { url: 'https://t.me/mayniyt' },
    ]
  },
  {
    nick: 'meowh0cki',
    sources: [
      { url: 'https://t.me/meowh0cki2' },
    ]
  },
  {
    nick: 'tarelko',
    sources: [
      { url: 'https://t.me/tarelkoanime' },
    ]
  },
  {
    nick: 'vitecp',
    sources: [
      { url: 'https://t.me/vitecpnarezka' },
    ]
  },
  {
    nick: 'zakvielchannel',
    sources: [
      { url: 'https://t.me/zakanime' },
    ]
  },
]

// ================================================================

const _TWITCH_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/></svg>'
const _TG_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>'
const _YT_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.495 6.205a3.007 3.007 0 0 0-2.088-2.088c-1.87-.501-9.396-.501-9.396-.501s-7.507-.01-9.396.501A3.007 3.007 0 0 0 .527 6.205a31.247 31.247 0 0 0-.522 5.805 31.247 31.247 0 0 0 .522 5.783 3.007 3.007 0 0 0 2.088 2.088c1.868.502 9.396.502 9.396.502s7.506 0 9.396-.502a3.007 3.007 0 0 0 2.088-2.088 31.247 31.247 0 0 0 .5-5.783 31.247 31.247 0 0 0-.5-5.805zM9.609 15.601V8.408l6.264 3.602z"/></svg>'

function _isTgUrl(url) {
  return url && (url.includes('t.me') || url.includes('telegram'))
}

function _srcIcon(url) {
  if (!url) return ''
  if (_isTgUrl(url)) return _TG_SVG
  if (url.includes('youtube') || url.includes('youtu.be')) return _YT_SVG
  if (url.includes('twitch')) return _TWITCH_SVG
  return ''
}

function _srcClass(url) {
  if (!url) return 'streamer-btn-other'
  if (_isTgUrl(url)) return 'streamer-btn-tg'
  if (url.includes('youtube') || url.includes('youtu.be')) return 'streamer-btn-yt'
  if (url.includes('twitch')) return 'streamer-btn-twitch'
  return 'streamer-btn-other'
}

function _srcFallback(url) {
  if (!url) return '?'
  try {
    const u = new URL(url)
    if (u.hostname === 't.me' || u.hostname.includes('telegram')) {
      const first = u.pathname.replace(/^\//, '').split('/')[0]
      return first.startsWith('+') ? 'Telegram' : first
    }
    if (u.hostname.includes('youtube') || u.hostname.includes('youtu.be')) return 'YouTube'
    if (u.hostname.includes('twitch')) return 'Twitch'
    return u.hostname
  } catch { return url }
}

// Нормализует t.me-ссылки: убирает ID поста (t.me/channel/123 → t.me/channel)
function _normalizeTgUrl(url) {
  try {
    const u = new URL(url)
    if (u.hostname === 't.me') {
      const parts = u.pathname.split('/').filter(Boolean)
      if (parts.length > 1 && !parts[0].startsWith('+')) {
        return 'https://t.me/' + parts[0]
      }
    }
  } catch {}
  return url
}

function streamersApp() {
  return {
    list: STREAMERS_LIST,
    avatars: {},   // nick  → twitch avatar url
    chInfo: {},   // url   → { name, avatar }

    search: '',

    get filtered() {
      const q = this.search.trim().toLowerCase()
      if (!q) return this.list
      return this.list.filter(s => s.nick.toLowerCase().includes(q))
    },

    avatarSrc(nick) { return this.avatars[nick] || null },
    avatarReady(nick) { return nick in this.avatars },

    srcIcon(url) { return _srcIcon(url) },
    srcClass(url) { return 'streamer-btn ' + _srcClass(url) },

    srcName(url) {
      return (this.chInfo[url] && this.chInfo[url].name) || _srcFallback(url)
    },
    srcAvatar(url) {
      return this.chInfo[url] && this.chInfo[url].avatar
    },

    twitchUrl(nick) {
      return 'https://twitch.tv/' + encodeURIComponent(nick)
    },

    async init() {
      // Twitch-аватарки через бэкенд-прокси (decapi.me + кеш на сервере)
      STREAMERS_LIST.forEach(s => {
        this.avatars[s.nick] = API_BASE + '/proxy/twitch-avatar?nick=' + encodeURIComponent(s.nick)
      })

      // Инфо о Telegram-каналах (name + avatar) с бэкенда
      const uniqueUrls = [
        ...new Set(
          STREAMERS_LIST.flatMap(s => s.sources)
            .map(src => src.url)
            .filter(u => _isTgUrl(u))
        )
      ]
      uniqueUrls.forEach(async srcUrl => {
        try {
          const res = await fetch(
            API_BASE + '/proxy/tg-channel?url=' + encodeURIComponent(_normalizeTgUrl(srcUrl))
          )
          if (res.ok) {
            const data = await res.json()
            if (data.name || data.avatar) this.chInfo[srcUrl] = data
          }
        } catch { }
      })
    }
  }
}
