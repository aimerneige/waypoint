import { useSyncExternalStore } from 'react'
const onlineSubscribe = (fn: () => void) => {
  window.addEventListener('online', fn)
  window.addEventListener('offline', fn)
  return () => {
    window.removeEventListener('online', fn)
    window.removeEventListener('offline', fn)
  }
}
export function useOnline() {
  return useSyncExternalStore(
    onlineSubscribe,
    () => navigator.onLine,
    () => true,
  )
}
export function useMedia(query: string) {
  return useSyncExternalStore(
    (fn) => {
      const media = matchMedia(query)
      media.addEventListener('change', fn)
      return () => media.removeEventListener('change', fn)
    },
    () => matchMedia(query).matches,
    () => false,
  )
}
