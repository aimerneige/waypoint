// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { OverlayHistory } from './overlay-history'
let manager: OverlayHistory
afterEach(() => manager?.dispose())
function back() {
  return new Promise<void>((resolve) => {
    window.addEventListener('popstate', () => resolve(), { once: true })
    history.back()
  })
}
it('back closes only the top nested overlay', async () => {
  history.replaceState({}, '', '/account')
  manager = new OverlayHistory(window)
  const closed: string[] = []
  manager.open(() => closed.push('outer'))
  manager.open(() => closed.push('inner'))
  await back()
  expect(closed).toEqual(['inner'])
  expect(location.pathname).toBe('/account')
  await back()
  expect(closed).toEqual(['inner', 'outer'])
})
it('programmatic close consumes its record without closing its parent', async () => {
  history.replaceState({}, '', '/account')
  manager = new OverlayHistory(window)
  const closed: string[] = []
  manager.open(() => closed.push('outer'))
  const inner = manager.open(() => closed.push('inner'))
  const popped = new Promise<void>((resolve) =>
    window.addEventListener('popstate', () => resolve(), { once: true }),
  )
  manager.close(inner)
  await popped
  expect(closed).toEqual(['inner'])
  await back()
  expect(closed).toEqual(['inner', 'outer'])
})
it('route cleanup closes all overlays and removes the marker', () => {
  manager = new OverlayHistory(window)
  let closed = false
  manager.open(() => {
    closed = true
  })
  history.pushState({}, '', '/login')
  manager.clearForRoute()
  expect(closed).toBe(true)
  expect(history.state['wp:overlay']).toBeUndefined()
  expect(location.pathname).toBe('/login')
})
it('closing a parent consumes its nested overlays', async () => {
  history.replaceState({ idx: 0 }, '', '/account')
  manager = new OverlayHistory(window)
  const closed: string[] = []
  const outer = manager.open(() => closed.push('outer'))
  manager.open(() => closed.push('inner'))
  const popped = new Promise<void>((resolve) =>
    window.addEventListener('popstate', () => resolve(), { once: true }),
  )
  manager.close(outer)
  await popped
  expect(closed).toEqual(['inner', 'outer'])
  expect(history.state['wp:overlay']).toBeUndefined()
})
it('skips stale overlay records after a route change', async () => {
  history.replaceState({ idx: 0 }, '', '/account')
  manager = new OverlayHistory(window)
  manager.open(() => {})
  manager.open(() => {})
  history.pushState({ idx: 1 }, '', '/login')
  manager.clearForRoute()
  await back()
  expect(location.pathname).toBe('/account')
  expect(history.state['wp:overlay']).toBeUndefined()
})
it('does not undo a route transition immediately after programmatic close', async () => {
  history.replaceState({ idx: 0 }, '', '/account')
  manager = new OverlayHistory(window)
  const id = manager.open(() => {})
  manager.close(id)
  await Promise.resolve()
  history.pushState({ idx: 1 }, '', '/login')
  manager.clearForRoute()
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(location.pathname).toBe('/login')
})
