import { test, expect, type Page } from './csp'
import { latestMailLink } from './mailpit'
test.use({ actionTimeout: 10000 })

async function synced(page: Page) {
  await expect(page.getByRole('status', { name: /^同步状态/ })).toHaveText(
    '已同步',
  )
}
async function edit(
  page: Page,
  title: string,
  field: '标题' | '地点',
  next: string,
) {
  await page
    .getByTestId('itinerary-item')
    .filter({ has: page.getByText(title, { exact: true }) })
    .click()
  await page.getByLabel(field, { exact: true }).fill(next)
  await page.getByRole('button', { name: '保存条目', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}
async function add(page: Page, title: string) {
  await page.getByRole('button', { name: '新增条目' }).click()
  await page.getByLabel('标题', { exact: true }).fill(title)
  await page.getByRole('button', { name: '保存条目', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}
async function remove(page: Page, title: string) {
  await page
    .getByTestId('itinerary-item')
    .filter({ has: page.getByText(title, { exact: true }) })
    .click()
  await page.getByRole('button', { name: '删除条目', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}
async function shots(page: Page, name: string) {
  const dialog = page.getByRole('dialog', {
    name: (
      {
        editor: '编辑条目',
        conflicts: '行程提示',
        rejected: '未生效的修改',
        history: '条目修改记录',
      } as Record<string, string>
    )[name],
    exact: true,
  })
  if (await dialog.count()) {
    await dialog.evaluate(async (element) => {
      await Promise.all(
        element.getAnimations().map((animation) => animation.finished),
      )
    })
    await expect(dialog).toBeInViewport({ ratio: 0.99 })
  }
  for (const theme of ['light', 'dark']) {
    await page.evaluate(
      (theme) =>
        document.documentElement.classList.toggle('dark', theme === 'dark'),
      theme,
    )
    await page.screenshot({ path: `e2e/screenshots/m0-${name}-${theme}.png` })
  }
}
test('M0 双用户离线、冲突、拒绝、删除、移除与退出清理', async ({
  browser,
  request,
}, info) => {
  test.setTimeout(180000)
  const options = {
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    baseURL: info.project.use.baseURL,
    ignoreHTTPSErrors: true,
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
  }
  const ac = await browser.newContext(options)
  const bc = await browser.newContext(options)
  const a = await ac.newPage(),
    b = await bc.newPage()
  a.setDefaultTimeout(10000)
  b.setDefaultTimeout(10000)
  async function register(page: Page, nickname: string) {
    const email = `m0-${crypto.randomUUID()}@example.com`
    await page.goto('/register')
    await page.getByLabel('昵称', { exact: true }).fill(nickname)
    await page.getByLabel('邮箱', { exact: true }).fill(email)
    await page.getByLabel('密码', { exact: true }).fill('Waypoint-test-123')
    await page.getByRole('button', { name: '注册', exact: true }).click()
    await expect(page.getByRole('heading', { name: '我的行程' })).toBeVisible()
    return email
  }
  try {
    const email = await register(a, 'A')
    const link = new URL(await latestMailLink(request, email, '/verify-email'))
    await a.goto(link.pathname + link.search)
    await expect(a.getByRole('status')).toHaveText('邮箱验证成功')
    await a.goto('/')
    await a.getByRole('button', { name: '新建行程' }).click()
    await a.getByLabel('名称', { exact: true }).fill('M0 同步之旅')
    await a.getByLabel('开始日期').fill('2027-01-01')
    await a.getByLabel('结束日期').fill('2027-01-03')
    await a.getByRole('button', { name: '保存行程' }).click()
    await expect(a).toHaveURL(/\/trips\/[\w-]+$/)
    const tripPath = new URL(a.url()).pathname
    await a.goto(`${tripPath}/members`)
    await a.getByRole('button', { name: '生成邀请链接' }).click()
    const invite = await a
      .getByRole('textbox', { name: '邀请链接' })
      .inputValue()
    await register(b, 'B')
    await b.goto(invite)
    await b.getByRole('button', { name: '加入行程', exact: true }).click()
    await expect(b).toHaveURL(tripPath)
    await a.goto(tripPath)
    await synced(a)
    await synced(b)
    await add(a, '共同条目')
    await add(a, 'Z')
    await synced(a)
    await expect(b.getByTestId('itinerary-item')).toHaveCount(2)
    await synced(b)
    await test.step('1 离线各自修改后一致', async () => {
      await ac.setOffline(true)
      await bc.setOffline(true)
      await a.getByRole('link', { name: '更多', exact: true }).click()
      await a.getByRole('link', { name: '行程', exact: true }).click()
      await edit(a, '共同条目', '标题', 'A 的标题')
      await edit(b, '共同条目', '地点', 'B 的地点')
      await add(a, 'X')
      await add(b, 'Y')
      await remove(b, 'Z')
      await expect(a.getByRole('status', { name: /^同步状态/ })).toHaveText(
        '离线·2',
      )
      await expect(b.getByRole('status', { name: /^同步状态/ })).toHaveText(
        '离线·3',
      )
      await ac.setOffline(false)
      await bc.setOffline(false)
      await synced(a)
      await synced(b)
      await expect(a.getByTestId('itinerary-item')).toHaveCount(3)
      await expect(b.getByTestId('itinerary-item')).toHaveCount(3)
      await expect(
        a
          .getByTestId('itinerary-item')
          .filter({ hasText: 'A 的标题' })
          .locator('xpath=ancestor::article'),
      ).toContainText('B 的地点')
      await expect(
        b
          .getByTestId('itinerary-item')
          .filter({ hasText: 'A 的标题' })
          .locator('xpath=ancestor::article'),
      ).toContainText('B 的地点')
      expect(await a.getByTestId('itinerary-item').allTextContents()).toEqual(
        await b.getByTestId('itinerary-item').allTextContents(),
      )
      await shots(a, 'itinerary')
    })
    await test.step('2 冲突提示、恢复与三次修改记录', async () => {
      await ac.setOffline(true)
      await bc.setOffline(true)
      await edit(a, 'A 的标题', '标题', 'A 冲突值')
      await edit(b, 'A 的标题', '标题', 'B 冲突值')
      await ac.setOffline(false)
      await synced(a)
      await bc.setOffline(false)
      await synced(b)
      await expect(
        a.getByTestId('itinerary-item').filter({ hasText: 'B 冲突值' }),
      ).toBeVisible()
      for (const [page, text] of [
        [a, '被 B 覆盖'],
        [b, '覆盖了 A 的修改'],
      ] as const) {
        await page.getByRole('button', { name: /行程提示/ }).click()
        await expect(page.getByRole('dialog')).toContainText(text)
      }
      await shots(a, 'conflicts')
      await a.getByRole('button', { name: '恢复为旧值' }).click()
      await a.getByRole('button', { name: '关闭', exact: true }).click()
      await b.getByRole('button', { name: '关闭', exact: true }).click()
      await synced(a)
      await synced(b)
      await expect(
        b.getByTestId('itinerary-item').filter({ hasText: 'A 冲突值' }),
      ).toBeVisible()
      await a
        .getByTestId('itinerary-item')
        .filter({ hasText: 'A 冲突值' })
        .click()
      await shots(a, 'editor')
      await a.getByRole('button', { name: '修改记录', exact: true }).click()
      const history = a.getByRole('dialog', {
        name: '条目修改记录',
        exact: true,
      })
      await expect(history).toContainText('A 的标题 → A 冲突值')
      await expect(history).toContainText('A 冲突值 → B 冲突值')
      await expect(history).toContainText('B 冲突值 → A 冲突值')
      await shots(a, 'history')
      await history.getByRole('button', { name: '关闭', exact: true }).click()
      await expect(history).toHaveCount(0)
      await a
        .getByRole('dialog', { name: '编辑条目', exact: true })
        .getByRole('button', { name: '关闭', exact: true })
        .click()
    })
    await test.step('3 拒绝回滚与修改后重试', async () => {
      await bc.setOffline(true)
      await edit(b, 'A 冲突值', '标题', '被拒内容')
      await b.route('**/api/trips/*/ops', async (route) => {
        if (route.request().method() !== 'POST') return route.continue()
        const body = route.request().postDataJSON()
        for (const op of body.ops)
          if (op.fields.title) op.fields.title = '长'.repeat(201)
        await route.continue({ postData: JSON.stringify(body) })
      })
      await bc.setOffline(false)
      await expect(b.getByRole('status', { name: /^同步状态/ })).toHaveText(
        '未生效·1',
      )
      await expect(
        b.getByTestId('itinerary-item').filter({ hasText: 'A 冲突值' }),
      ).toBeVisible()
      await expect(
        b.getByTestId('itinerary-item').filter({ hasText: '被拒内容' }),
      ).toHaveCount(0)
      await b.getByRole('status', { name: /^同步状态/ }).click()
      await expect(b.getByRole('dialog')).toContainText('修改内容不合法')
      await shots(b, 'rejected')
      await b.unroute('**/api/trips/*/ops')
      await b.getByRole('button', { name: '修改后重试', exact: true }).click()
      await b.getByLabel('标题', { exact: true }).fill('合法重试')
      await b.getByRole('button', { name: '保存条目' }).click()
      await expect(
        b.getByRole('dialog', { name: '修改后重试', exact: true }),
      ).toHaveCount(0)
      await b
        .getByRole('dialog', { name: '未生效的修改', exact: true })
        .getByRole('button', { name: '关闭', exact: true })
        .click()
      await synced(b)
      await synced(a)
      await expect(
        a.getByTestId('itinerary-item').filter({ hasText: '合法重试' }),
      ).toBeVisible()
    })
    await test.step('4 删除后编辑与恢复', async () => {
      await ac.setOffline(true)
      await edit(a, '合法重试', '标题', '删除后编辑')
      await remove(b, '合法重试')
      await synced(b)
      await ac.setOffline(false)
      await synced(a)
      await a.getByRole('button', { name: /行程提示/ }).click()
      await expect(a.getByRole('dialog')).toContainText('该项已被 B 删除')
      await a.getByRole('button', { name: '恢复该项' }).click()
      await a.getByRole('button', { name: '关闭', exact: true }).click()
      await synced(a)
      await synced(b)
      await expect(
        b.getByTestId('itinerary-item').filter({ hasText: '删除后编辑' }),
      ).toBeVisible()
    })
    await test.step('5 离线修改时被移出，清理本地行程', async () => {
      await bc.setOffline(true)
      await edit(b, '删除后编辑', '地点', '将被丢弃')
      await a.goto(`${tripPath}/members`)
      await a.getByRole('button', { name: '移除成员' }).click()
      await a.getByRole('button', { name: '确认', exact: true }).click()
      await bc.setOffline(false)
      await expect(b.getByText(/你已被移出行程/)).toBeVisible()
      await b.goto('/')
      await expect(b.getByRole('heading', { name: 'M0 同步之旅' })).toHaveCount(
        0,
      )
      const counts = await b.evaluate(async (id) => {
        const user = JSON.parse(localStorage.getItem('wp:lastUser')!)
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const r = indexedDB.open(`waypoint-u-${user.id}`)
          r.onsuccess = () => resolve(r.result)
          r.onerror = () => reject(r.error)
        })
        try {
          return await Promise.all(
            ['entities', 'outbox', 'rejected', 'ops'].map(
              (table) =>
                new Promise<number>((resolve, reject) => {
                  const r = db
                    .transaction(table)
                    .objectStore(table)
                    .index('tripId')
                    .count(id)
                  r.onsuccess = () => resolve(r.result)
                  r.onerror = () => reject(r.error)
                }),
            ),
          )
        } finally {
          db.close()
        }
      }, tripPath.split('/').at(-1)!)
      expect(counts).toEqual([0, 0, 0, 0])
    })
    await test.step('6 离线退出确认与数据库删除', async () => {
      await a.goto(tripPath)
      await synced(a)
      const dbName = await a.evaluate(
        () =>
          `waypoint-u-${JSON.parse(localStorage.getItem('wp:lastUser')!).id}`,
      )
      await ac.setOffline(true)
      await add(a, '退出前未同步')
      await a.getByRole('link', { name: '账户', exact: true }).click()
      await a.getByRole('button', { name: '退出登录', exact: true }).click()
      await expect(a.getByRole('dialog')).toContainText(
        '有 1 条修改尚未同步，退出将丢失',
      )
      await a.getByRole('button', { name: '确认退出登录' }).click()
      await expect(a).toHaveURL(/\/login$/)
      expect(
        await a.evaluate(async () =>
          (await indexedDB.databases()).map((db) => db.name),
        ),
      ).not.toContain(dbName)
      expect(
        await a.evaluate(() => localStorage.getItem('wp:lastUser')),
      ).toBeNull()
    })
  } finally {
    await ac.close()
    await bc.close()
  }
})
