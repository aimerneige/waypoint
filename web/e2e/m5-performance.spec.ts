import { test, expect } from './csp'
import { register, newTrip } from './m5-helpers'
test.use({ actionTimeout: 10000 })

test('M5 千条行程及千笔账目本地切换在 300ms 内完成', async ({
  page,
  context,
}) => {
  await register(page, '性能检查')
  const path = await newTrip(page)
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  for (const route of ['/ledger', '']) {
    await page.goto(path + route)
    await expect(page.locator('main h1')).toBeVisible()
  }
  await context.setOffline(true)
  await page.evaluate(async (tripId) => {
    const uid = JSON.parse(localStorage.getItem('wp:lastUser')!).id
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(`waypoint-u-${uid}`)
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
    const tx = db.transaction('entities', 'readwrite'),
      store = tx.objectStore('entities')
    for (let i = 0; i < 1000; i++)
      for (const entity of ['itinerary_item', 'expense']) {
        const entityId = `${entity}-${i}`
        const state = {
          entity,
          entityId,
          fields:
            entity === 'expense'
              ? {
                  title: `压力账目${i}`,
                  date: '2026-12-01',
                  amount: 100,
                  currency: 'CNY',
                  method: 'cny',
                  payerUserId: uid,
                  rateSource: 'default',
                  split: { mode: 'equal', members: [uid] },
                }
              : { title: `压力行程${i}`, date: '2026-12-01', place: '东京' },
          fieldSeq: {},
          fieldActor: {},
          createdBy: uid,
          createdSeq: i + 1,
          updatedSeq: i + 1,
          deleted: false,
          deletedBy: null,
          deletedSeq: null,
        }
        store.put({ tripId, entity, entityId, server: state, view: state })
      }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  }, path.split('/').at(-1)!)
  await page.reload()
  await expect(page.locator('.itinerary-card')).toHaveCount(50)
  await expect(
    page.getByRole('button', { name: '显示更多行程（50/1000）' }),
  ).toBeVisible()
  for (const [name, selector] of [
    ['账本', '[data-testid="expense-card"]'],
    ['行程', '.itinerary-card'],
  ] as const) {
    const elapsed = await page.evaluate(
      async ({ name, selector }) => {
        const link = [...document.querySelectorAll('nav a')].find(
          (a) => a.textContent === name,
        ) as HTMLAnchorElement
        const start = performance.now()
        link.click()
        await new Promise<void>((resolve) => {
          const done = () => {
            if (document.querySelectorAll(selector).length === 50) {
              observer.disconnect()
              resolve()
              return true
            }
            return false
          }
          const observer = new MutationObserver(done)
          observer.observe(document.body, { childList: true, subtree: true })
          done()
        })
        return performance.now() - start
      },
      { name, selector },
    )
    expect(elapsed, `${name} render duration`).toBeLessThan(300)
    if (name === '账本')
      await expect(page.locator('.ledger-summary')).toContainText('¥1,000.00')
  }
})
