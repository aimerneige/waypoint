import { test, expect, type Page } from '@playwright/test'
import { latestMailLink } from './mailpit'
test.use({ actionTimeout: 10000 })
const synced = (p: Page) =>
  expect(p.getByRole('status', { name: /^同步状态/ })).toHaveText('已同步')
const item = (p: Page, name: string) =>
  p
    .getByTestId('packing-item')
    .filter({ has: p.getByRole('checkbox', { name, exact: true }) })
async function shots(p: Page, name: string) {
  const dialog = p.getByRole('dialog').last()
  if (await dialog.count())
    await dialog.evaluate(async (el) => {
      await Promise.all(el.getAnimations().map((a) => a.finished))
    })
  for (const theme of ['light', 'dark']) {
    await expect(
      p.locator('[data-sonner-toast][data-visible="true"]'),
    ).toHaveCount(0)
    await p.evaluate(
      (t) => document.documentElement.classList.toggle('dark', t === 'dark'),
      theme,
    )
    await p.screenshot({
      path: `e2e/screenshots/m3-${name}-${theme}.png`,
      animations: 'disabled',
      fullPage: true,
    })
  }
  await p.evaluate(() => document.documentElement.classList.remove('dark'))
}
async function close(p: Page) {
  await p
    .getByRole('dialog')
    .last()
    .getByRole('button', { name: '关闭', exact: true })
    .click()
  await expect(p.getByRole('dialog')).toHaveCount(0)
}
test('M3 模板、独立勾选、提醒、实名投票与截止回滚', async ({
  browser,
  request,
}, info) => {
  test.setTimeout(240000)
  const opts = {
    baseURL: info.project.use.baseURL,
    ignoreHTTPSErrors: true,
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
    locale: 'zh-CN',
    timezoneId: 'Asia/Tokyo',
  }
  const ac = await browser.newContext(opts),
    bc = await browser.newContext(opts),
    a = await ac.newPage(),
    b = await bc.newPage()
  const errors: string[] = []
  for (const p of [a, b]) p.on('pageerror', (e) => errors.push(String(e)))
  async function register(p: Page, name: string) {
    const email = `m3-${crypto.randomUUID()}@example.com`
    await p.goto('/register')
    await p.getByLabel('昵称', { exact: true }).fill(name)
    await p.getByLabel('邮箱', { exact: true }).fill(email)
    await p.getByLabel('密码', { exact: true }).fill('Waypoint-test-123')
    await p.getByRole('button', { name: '注册', exact: true }).click()
    await expect(p.getByRole('heading', { name: '我的行程' })).toBeVisible()
    return email
  }
  async function newTrip(name: string) {
    const date = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
    await a.goto('/')
    await a.getByRole('button', { name: '新建行程' }).click()
    await a.getByLabel('名称', { exact: true }).fill(name)
    await a.getByLabel('开始日期').fill(date)
    await a.getByLabel('结束日期').fill(date)
    await a.getByRole('button', { name: '保存行程' }).click()
    await expect(a).toHaveURL(/\/trips\/[\w-]+$/)
    return new URL(a.url()).pathname
  }
  async function poll(question: string, multi: boolean) {
    await a.getByRole('button', { name: '新建投票' }).click()
    await a.getByLabel('问题', { exact: true }).fill(question)
    if (multi) await a.getByLabel('允许多选').check()
    await a.getByLabel('选项 1', { exact: true }).fill('拉面')
    await a.getByLabel('选项 2', { exact: true }).fill('寿司')
    await a
      .getByLabel('截止时间（设备当地时间）')
      .fill(new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 16))
    await a.getByRole('button', { name: '保存投票' }).click()
    await expect(a.getByRole('dialog')).toHaveCount(0)
    await synced(a)
  }
  try {
    const email = await register(a, '清单 A'),
      link = new URL(await latestMailLink(request, email, '/verify-email'))
    await a.goto(link.pathname + link.search)
    await expect(a.getByRole('status')).toHaveText('邮箱验证成功')
    const path = await newTrip('M3 轻装之旅')
    await a.goto(`${path}/members`)
    await a.getByRole('button', { name: '生成邀请链接' }).click()
    const invite = await a
      .getByRole('textbox', { name: '邀请链接' })
      .inputValue()
    await register(b, '清单 B')
    await b.goto(invite)
    await b.getByRole('button', { name: '加入行程', exact: true }).click()
    await expect(b).toHaveURL(path)
    // 让 A 成为普通成员，验证负责人权限，同时保留 owner 的例外权限。
    await a.reload()
    await a.getByRole('button', { name: '转让所有者' }).click()
    await a.getByRole('button', { name: '确认', exact: true }).click()
    await expect(a.getByRole('button', { name: '转让所有者' })).toHaveCount(0)
    await a.goto(`${path}/packing`)
    await b.goto(`${path}/packing`)
    await test.step('模板套用与独立勾选', async () => {
      await a.getByRole('button', { name: '套用模板', exact: true }).click()
      await a.getByRole('button', { name: '证件类', exact: true }).click()
      await a
        .getByRole('group', { name: '护照类型', exact: true })
        .getByRole('button', { name: '公共', exact: true })
        .click()
      await a
        .getByLabel('护照负责人', { exact: true })
        .selectOption({ label: '清单 B' })
      if (info.project.name === 'mobile') await shots(a, 'template')
      await a.getByRole('button', { name: '确认套用' }).click()
      await expect(a.getByRole('dialog')).toHaveCount(0)
      await synced(a)
      await expect(item(b, '身份证')).toBeVisible()
      await a.getByRole('checkbox', { name: '身份证', exact: true }).click()
      await synced(a)
      await expect(
        b.getByRole('checkbox', { name: '身份证', exact: true }),
      ).not.toBeChecked()
      await b.getByRole('checkbox', { name: '身份证', exact: true }).click()
      await synced(b)
      await expect(
        a.getByRole('checkbox', { name: '护照', exact: true }),
      ).toBeDisabled()
      await b.getByRole('checkbox', { name: '护照', exact: true }).click()
      await synced(b)
      await expect(
        a.getByRole('checkbox', { name: '护照', exact: true }),
      ).toBeChecked()
      await expect(item(a, '护照')).toContainText('清单 B')
      if (info.project.name === 'mobile') await shots(a, 'packing')
      await expect(a.getByText(/你还有 \d+ 件公共物品未装/)).toBeVisible()
      if (info.project.name === 'mobile') await shots(a, 'reminder')
      await a.getByRole('button', { name: '今天不再提示' }).click()
      await a.reload()
      await expect(a.getByRole('button', { name: '今天不再提示' })).toHaveCount(
        0,
      )
      await a.goto('/')
      await expect(a.getByRole('button', { name: '今天不再提示' })).toHaveCount(
        0,
      )
      await a.goto(`${path}/packing`)
    })
    await test.step('用户模板跨行程离线套用', async () => {
      await a.getByRole('button', { name: '另存为模板' }).click()
      await a.getByLabel('模板名称').fill('出行证件')
      await a.getByRole('button', { name: '保存模板', exact: true }).click()
      await expect(a.getByRole('dialog')).toHaveCount(0)
      const next = await newTrip('M3 模板复用')
      await a.goto(`${next}/packing`)
      await synced(a)
      await ac.setOffline(true)
      await a.getByRole('button', { name: '套用模板', exact: true }).click()
      await a.getByRole('button', { name: '出行证件', exact: true }).click()
      await a.getByRole('button', { name: '确认套用' }).click()
      await expect(a.getByRole('dialog')).toHaveCount(0)
      await expect(item(a, '护照')).toBeVisible()
      await ac.setOffline(false)
      await synced(a)
      await a.goto(`${path}/polls`)
      await b.goto(`${path}/polls`)
    })
    await test.step('同时实名投票、改票与撤票', async () => {
      await poll('今晚吃什么', false)
      await poll('明天想吃什么', true)
      if (info.project.name === 'mobile') await shots(a, 'poll-list')
      await a.getByRole('link', { name: '今晚吃什么', exact: true }).click()
      await b.getByRole('link', { name: '今晚吃什么', exact: true }).click()
      await Promise.all([
        a.getByRole('radio', { name: '拉面', exact: true }).click(),
        b.getByRole('radio', { name: '寿司', exact: true }).click(),
      ])
      await expect(
        a.getByRole('radio', { name: '拉面', exact: true }),
      ).toBeChecked()
      await expect(
        b.getByRole('radio', { name: '寿司', exact: true }),
      ).toBeChecked()
      await synced(a)
      await synced(b)
      for (const p of [a, b]) {
        await expect(p.getByText('2 人已投票 · 实名可见')).toBeVisible()
        await expect(p.getByText('清单 A', { exact: true })).toBeVisible()
        await expect(p.getByText('清单 B', { exact: true })).toBeVisible()
      }
      if (info.project.name === 'mobile') await shots(a, 'poll-single')
      await b.getByRole('radio', { name: '拉面', exact: true }).click()
      await expect(
        b.getByRole('radio', { name: '拉面', exact: true }),
      ).toBeChecked()
      await synced(b)
      await expect(a.getByText('2 票 · 100%')).toBeVisible()
      await b.getByRole('button', { name: '撤票', exact: true }).click()
      await synced(b)
      await expect(a.getByText('1 人已投票 · 实名可见')).toBeVisible()
      await a.getByRole('link', { name: '返回投票列表' }).click()
      await a.getByRole('link', { name: '明天想吃什么', exact: true }).click()
      await a.getByRole('checkbox', { name: '拉面', exact: true }).click()
      await expect(
        a.getByRole('checkbox', { name: '拉面', exact: true }),
      ).toBeChecked()
      await a.getByRole('checkbox', { name: '寿司', exact: true }).click()
      await expect(
        a.getByRole('checkbox', { name: '寿司', exact: true }),
      ).toBeChecked()
      await synced(a)
      if (info.project.name === 'mobile') await shots(a, 'poll-multiple')
      await a.getByRole('button', { name: '追加选项', exact: true }).click()
      await a.getByLabel('选项内容', { exact: true }).fill('火锅')
      await a.getByRole('button', { name: '保存选项' }).click()
      await expect(a.getByRole('dialog')).toHaveCount(0)
      await synced(a)
      await a.getByRole('link', { name: '返回投票列表' }).click()
      await a.getByRole('link', { name: '今晚吃什么', exact: true }).click()
    })
    await test.step('离线投票在关闭后拒绝并回滚', async () => {
      await bc.setOffline(true)
      await b.getByRole('radio', { name: '寿司', exact: true }).click()
      await expect(
        b.getByRole('radio', { name: '寿司', exact: true }),
      ).toBeChecked()
      await expect(b.getByText('2 人已投票 · 实名可见')).toBeVisible()
      await a
        .getByRole('button', { name: '今晚吃什么操作', exact: true })
        .click()
      await a.getByRole('button', { name: '关闭投票', exact: true }).click()
      await expect(a.getByText('已截止，不能继续投票')).toBeVisible()
      await bc.setOffline(false)
      await expect(b.getByRole('status', { name: /^同步状态/ })).toContainText(
        '未生效',
      )
      await expect(b.getByText('1 人已投票 · 实名可见')).toBeVisible()
      await expect(
        b.getByRole('radio', { name: '寿司', exact: true }),
      ).not.toBeChecked()
      await expect(
        b.getByRole('radio', { name: '寿司', exact: true }),
      ).toBeDisabled()
      await b.getByRole('status', { name: /^同步状态/ }).click()
      await expect(b.getByRole('alert')).toContainText('投票已截止')
      await b.getByRole('button', { name: '丢弃', exact: true }).click()
      await close(b)
    })
    expect(errors).toEqual([])
  } finally {
    await ac.setOffline(false)
    await bc.setOffline(false)
    await ac.close()
    await bc.close()
  }
})
