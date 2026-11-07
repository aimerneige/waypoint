import { test, expect, type Page } from '@playwright/test'
import { latestMailLink } from './mailpit'
test.use({ actionTimeout: 10000 })

async function synced(page: Page) {
  await expect(page.getByRole('status', { name: /^同步状态/ })).toHaveText(
    '已同步',
  )
}
function card(page: Page, title: string) {
  return page
    .locator('.wish-card')
    .filter({ has: page.getByText(title, { exact: true }) })
}
function item(page: Page, title: string) {
  return page
    .getByTestId('itinerary-item')
    .filter({ has: page.getByText(title, { exact: true }) })
}
async function screenshot(page: Page, name: string) {
  await expect(
    page.locator('[data-sonner-toast][data-visible="true"]'),
  ).toHaveCount(0)
  const dialog = page.getByRole('dialog').last()
  if (await dialog.count()) {
    await dialog.evaluate(async (element) => {
      await Promise.all(
        element.getAnimations().map((animation) => animation.finished),
      )
    })
    await expect(dialog).toBeInViewport({ ratio: 0.99 })
    if (await page.locator('[data-sonner-toaster]').count())
      await expect(page.locator('[data-sonner-toaster]')).toHaveAttribute(
        'data-y-position',
        'top',
      )
  }
  for (const theme of ['light', 'dark']) {
    await page.evaluate(
      (theme) =>
        document.documentElement.classList.toggle('dark', theme === 'dark'),
      theme,
    )
    await page.screenshot({
      animations: 'disabled',
      path: `e2e/screenshots/m1-${name}-${theme}.png`,
      fullPage: true,
    })
  }
  await page.evaluate(() => document.documentElement.classList.remove('dark'))
}
test('M1 心愿安排、撤销、历史、离线、排序、并发与桌面拖拽', async ({
  browser,
  request,
}, info) => {
  test.setTimeout(240000)
  const options = {
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    baseURL: info.project.use.baseURL,
    ignoreHTTPSErrors: true,
    viewport: info.project.use.viewport,
    isMobile: info.project.use.isMobile,
    hasTouch: info.project.use.hasTouch,
  }
  const ac = await browser.newContext(options),
    bc = await browser.newContext(options)
  const a = await ac.newPage(),
    b = await bc.newPage()
  async function register(page: Page, name: string) {
    const email = `m1-${crypto.randomUUID()}@example.com`
    await page.goto('/register')
    await page.getByLabel('昵称', { exact: true }).fill(name)
    await page.getByLabel('邮箱', { exact: true }).fill(email)
    await page.getByLabel('密码', { exact: true }).fill('Waypoint-test-123')
    await page.getByRole('button', { name: '注册', exact: true }).click()
    await expect(page.getByRole('heading', { name: '我的行程' })).toBeVisible()
    return email
  }
  async function addWish(title: string) {
    await a.getByRole('button', { name: '新增心愿', exact: true }).click()
    await a.getByLabel('标题', { exact: true }).fill(title)
    await a.getByLabel('地点', { exact: true }).fill('东京')
    await a.getByLabel('备注', { exact: true }).fill('一起去看看')
    await a.getByLabel('链接', { exact: true }).fill('https://example.com')
    await a.getByRole('button', { name: '保存心愿' }).click()
    await expect(a.getByRole('dialog')).toHaveCount(0)
  }
  async function schedule(page: Page, title: string, day: number) {
    await card(page, title).getByRole('button', { name: '安排到…' }).click()
    await page
      .getByRole('button', { name: new RegExp(`第 ${day} 天 ·`) })
      .click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  }
  try {
    const email = await register(a, '心愿 A')
    const link = new URL(await latestMailLink(request, email, '/verify-email'))
    await a.goto(link.pathname + link.search)
    await expect(a.getByRole('status')).toHaveText('邮箱验证成功')
    await a.goto('/')
    await a.getByRole('button', { name: '新建行程' }).click()
    await a.getByLabel('名称', { exact: true }).fill('M1 心愿之旅')
    await a.getByLabel('开始日期').fill('2026-11-10')
    await a.getByLabel('结束日期').fill('2026-11-12')
    await a.getByRole('button', { name: '保存行程' }).click()
    await expect(a).toHaveURL(/\/trips\/[\w-]+$/)
    const path = new URL(a.url()).pathname
    await a.goto(`${path}/members`)
    await a.getByRole('button', { name: '生成邀请链接' }).click()
    const invite = await a
      .getByRole('textbox', { name: '邀请链接' })
      .inputValue()
    await register(b, '心愿 B')
    await b.goto(invite)
    await b.getByRole('button', { name: '加入行程', exact: true }).click()
    await expect(b).toHaveURL(path)
    await a.goto(`${path}/wishes`)
    await addWish('美术馆')
    await synced(a)
    await test.step('安排到第二天与撤销', async () => {
      await card(a, '美术馆').getByRole('button', { name: '安排到…' }).click()
      if (info.project.name === 'mobile') await screenshot(a, 'schedule')
      await a.getByRole('button', { name: /第 2 天 ·/ }).click()
      await expect(
        card(a, '美术馆').getByRole('link', { name: '第 2 天', exact: true }),
      ).toBeVisible()
      await expect(b.locator('[data-day="2026-11-11"]')).toContainText('美术馆')
      await a.getByRole('button', { name: '撤销', exact: true }).click()
      await expect(card(a, '美术馆')).toContainText('未安排')
      await expect(item(b, '美术馆')).toHaveCount(0)
    })
    await test.step('移回心愿池并查看创建删除历史', async () => {
      await schedule(a, '美术馆', 2)
      await a.getByRole('link', { name: '返回行程' }).click()
      await a.getByRole('button', { name: '条目操作 美术馆' }).click()
      await a.getByText('移回心愿池', { exact: true }).click()
      await expect(item(a, '美术馆')).toHaveCount(0)
      await a.getByRole('link', { name: /心愿池（/ }).click()
      await expect(card(a, '美术馆')).toContainText('未安排')
      await synced(a)
      await a.goto(`${path}/history`)
      await expect(
        a.getByText('行程条目 · 新增', { exact: true }).first(),
      ).toBeVisible()
      await expect(
        a.getByText('行程条目 · 删除', { exact: true }).first(),
      ).toBeVisible()
    })
    await a.goto(`${path}/wishes`)
    await synced(a)
    await synced(b)
    await test.step('离线安排与时间预订信息同步', async () => {
      await ac.setOffline(true)
      await schedule(a, '美术馆', 2)
      await a.getByRole('link', { name: '返回行程' }).click()
      await item(a, '美术馆').click()
      await a.getByLabel('开始时间', { exact: true }).fill('23:00')
      await a.getByLabel('结束时间', { exact: true }).fill('08:30')
      await a
        .getByLabel('预订信息', { exact: true })
        .fill('预约 https://example.com 电话 +81 90 1234 5678\n订单 123')
      await a.getByText('更多选项', { exact: true }).click()
      await a.getByLabel('到达日期', { exact: true }).fill('2026-11-12')
      if (info.project.name === 'mobile') await screenshot(a, 'editor')
      await a.getByRole('button', { name: '保存条目' }).click()
      await ac.setOffline(false)
      await synced(a)
      await synced(b)
      await expect(item(b, '美术馆')).toContainText('23:00 → 次日 08:30')
      await expect(
        item(b, '美术馆')
          .locator('xpath=ancestor::article')
          .getByRole('link', { name: 'https://example.com' }),
      ).toHaveAttribute('href', 'https://example.com')
    })
    await a.getByRole('link', { name: /心愿池（/ }).click()
    await addWish('公园')
    await schedule(a, '公园', 1)
    await addWish('咖啡馆')
    await schedule(a, '咖啡馆', 1)
    await a.getByRole('link', { name: '返回行程' }).click()
    await synced(a)
    await synced(b)
    await test.step('手机上移下移同步', async () => {
      await a.getByRole('button', { name: '条目操作 咖啡馆' }).click()
      await a.getByText('上移', { exact: true }).click()
      await synced(a)
      await synced(b)
      await expect(
        b
          .locator('[data-day="2026-11-10"]')
          .getByTestId('itinerary-item')
          .first(),
      ).toContainText('咖啡馆')
      await a.getByRole('button', { name: '条目操作 咖啡馆' }).click()
      await a.getByText('下移', { exact: true }).click()
      await synced(a)
      await expect(
        b
          .locator('[data-day="2026-11-10"]')
          .getByTestId('itinerary-item')
          .first(),
      ).toContainText('公园')
    })
    // 添加一个有时间的当天条目，与无时间和跨夜条目一同验收布局。
    await item(a, '公园').click()
    await a.getByLabel('开始时间', { exact: true }).fill('09:00')
    await a.getByRole('button', { name: '保存条目' }).click()
    await synced(a)
    if (info.project.name === 'mobile') await screenshot(a, 'itinerary-mobile')
    await a.getByRole('link', { name: /心愿池（/ }).click()
    await addWish('并发心愿')
    await synced(a)
    if (info.project.name === 'mobile') await screenshot(a, 'wishlist')
    await b.getByRole('link', { name: /心愿池（/ }).click()
    await expect(card(b, '并发心愿')).toBeVisible()
    await synced(b)
    await test.step('两成员离线同时安排同一心愿', async () => {
      await ac.setOffline(true)
      await bc.setOffline(true)
      await schedule(a, '并发心愿', 1)
      await schedule(b, '并发心愿', 3)
      await ac.setOffline(false)
      await bc.setOffline(false)
      await synced(a)
      await synced(b)
      await expect(card(a, '并发心愿')).toContainText('已安排 2 次')
      await expect(card(b, '并发心愿')).toContainText('已安排 2 次')
      await expect(
        card(a, '并发心愿').getByRole('link', { name: '第 1 天', exact: true }),
      ).toBeVisible()
      await a.getByRole('link', { name: '返回行程' }).click()
      await b.getByRole('link', { name: '返回行程' }).click()
      await expect(item(a, '并发心愿')).toHaveCount(2)
      await expect(item(b, '并发心愿')).toHaveCount(2)
    })
    if (info.project.name === 'desktop')
      await test.step('桌面鼠标拖拽安排心愿', async () => {
        await addWish('拖拽心愿')
        const handle = a.getByRole('button', { name: '拖动心愿 拖拽心愿' })
        const target = a.locator('[data-day="2026-11-10"]')
        await a.evaluate(() => window.scrollTo(0, 0))
        await expect(target.getByRole('heading')).toBeInViewport()
        await expect(handle).toBeInViewport()
        const from = await handle.boundingBox(),
          to = await target.getByRole('heading').boundingBox()
        expect(from).toBeTruthy()
        expect(to).toBeTruthy()
        await a.mouse.move(
          from!.x + from!.width / 2,
          from!.y + from!.height / 2,
        )
        await a.mouse.down()
        await a.mouse.move(
          from!.x + from!.width / 2 - 12,
          from!.y + from!.height / 2,
          { steps: 5 },
        )
        await a.mouse.move(to!.x + to!.width / 2, to!.y + 40, { steps: 30 })
        await a.mouse.up()
        await expect(item(a, '拖拽心愿')).toHaveCount(1)
        await expect(target).toContainText('拖拽心愿')
        await synced(a)
        await expect(item(b, '拖拽心愿')).toHaveCount(1)
        await screenshot(a, 'itinerary-desktop')
      })
  } finally {
    await ac.close()
    await bc.close()
  }
})
