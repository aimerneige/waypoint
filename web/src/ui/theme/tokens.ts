export const themes = {
  light: {
    background: '#F7FAFC',
    foreground: '#0F1B26',
    card: '#FFFFFF',
    'card-foreground': '#0F1B26',
    popover: '#FFFFFF',
    'popover-foreground': '#0F1B26',
    primary: '#1B65A6',
    'primary-foreground': '#FFFFFF',
    secondary: '#E3F1FC',
    'secondary-foreground': '#173E60',
    muted: '#EAF0F5',
    'muted-foreground': '#526372',
    accent: '#E3F1FC',
    'accent-foreground': '#173E60',
    destructive: '#B42332',
    'destructive-foreground': '#FFFFFF',
    border: '#BDCADA',
    input: '#BDCADA',
    ring: '#3D9BE0',
  },
  dark: {
    background: '#0E141B',
    foreground: '#E6EDF3',
    card: '#151D26',
    'card-foreground': '#E6EDF3',
    popover: '#151D26',
    'popover-foreground': '#E6EDF3',
    primary: '#8FCBF5',
    'primary-foreground': '#0A2236',
    secondary: '#1C3347',
    'secondary-foreground': '#D1E9FC',
    muted: '#202C38',
    'muted-foreground': '#A6B5C3',
    accent: '#1C3347',
    'accent-foreground': '#D1E9FC',
    destructive: '#F6A5AE',
    'destructive-foreground': '#400C16',
    border: '#435467',
    input: '#435467',
    ring: '#8FCBF5',
  },
} as const
export type Theme = 'system' | 'light' | 'dark'
export function applyTheme(theme: Theme) {
  localStorage.setItem('wp:theme', theme)
  const dark =
    theme === 'dark' ||
    (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', themes[dark ? 'dark' : 'light'].background)
  document
    .querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
    ?.setAttribute('content', dark ? 'black-translucent' : 'default')
}
