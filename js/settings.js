const Settings = (() => {
  const KEY = 'nz_settings'
  const DEFAULTS = { bgEffect: true, cardSize: 'medium', bgPosterHover: true, bgParallax: false }

  function get() {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') } }
    catch { return { ...DEFAULTS } }
  }

  function save(patch) {
    localStorage.setItem(KEY, JSON.stringify({ ...get(), ...patch }))
  }

  function apply(s) {
    const h = document.documentElement
    h.dataset.bgEffect = s.bgEffect ? '1' : '0'
    h.dataset.bgParallax = (s.bgParallax && s.bgEffect) ? '1' : '0'
    if (!(s.bgParallax && s.bgEffect)) {
      const bgEl = document.querySelector('.bg-poster')
      if (bgEl) bgEl.style.backgroundPositionY = ''
    }
    const isTV = document.body?.classList.contains('tv-mode') ?? false
    h.style.setProperty('--card-min',
      isTV
        ? (s.cardSize === 'small' ? '120px' : s.cardSize === 'large' ? '220px' : '170px')
        : (s.cardSize === 'small' ? '160px' : s.cardSize === 'large' ? '320px' : '250px')
    )
  }

  apply(get())

  return { get, save, apply }
})()
