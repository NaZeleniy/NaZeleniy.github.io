const Settings = (() => {
  const KEY = 'nz_settings'
  const DEFAULTS = { bgEffect: true, cardSize: 'medium' }

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
    h.style.setProperty('--card-min',
      s.cardSize === 'small' ? '160px' :
      s.cardSize === 'large' ? '320px' : '250px')
  }

  apply(get())

  return { get, save, apply }
})()
