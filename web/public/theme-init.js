;(() => {
  let theme = 'system'
  try {
    theme = localStorage.getItem('wp:theme') || 'system'
  } catch {
    /* 存储不可用时跟随系统。 */
  }
  const dark =
    theme === 'dark' ||
    (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  document.querySelector('meta[name="theme-color"]').content = dark
    ? '#0E141B'
    : '#F7FAFC'
  document.querySelector(
    'meta[name="apple-mobile-web-app-status-bar-style"]',
  ).content = dark ? 'black-translucent' : 'default'
})()
/* global localStorage, matchMedia, document */
