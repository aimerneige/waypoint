import { test, expect, type Page } from './csp'
import { fileURLToPath } from 'node:url'
import { latestMailLink } from './mailpit'
test.use({ actionTimeout: 10000 })
const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
const synced = (p: Page) =>
  expect(p.getByRole('status', { name: /^同步状态/ })).toHaveText('已同步')
const card = (p: Page, title: string) =>
  p
    .getByTestId('voucher-card')
    .filter({ has: p.getByRole('button', { name: title, exact: true }) })
async function close(p: Page) {
  await p
    .getByRole('dialog')
    .last()
    .getByRole('button', { name: '关闭', exact: true })
    .click()
  await expect(p.getByRole('dialog')).toHaveCount(0)
}
async function shots(p: Page, project: string, name: string, fullPage = true) {
  const dialog = p.getByRole('dialog').last()
  if (await dialog.count())
    await dialog.evaluate(async (el) => {
      await Promise.all(el.getAnimations().map((a) => a.finished))
    })
  for (const theme of ['light', 'dark']) {
    await p.evaluate(
      (t) => document.documentElement.classList.toggle('dark', t === 'dark'),
      theme,
    )
    if (!fullPage) {
      await p.screenshot({
        path: `e2e/screenshots/m5b-${project}-${name}-${theme}.png`,
        animations: 'disabled',
        fullPage: false,
      })
    }
    if (project === 'mobile') {
      await p.screenshot({
        path: `e2e/screenshots/m4-${name}-${theme}.png`,
        animations: 'disabled',
        fullPage,
      })
    }
  }
  await p.evaluate(() => document.documentElement.classList.remove('dark'))
}
test('M4 凭证共享、私有隔离、离线上传、缓存、HEIC 和查看器', async ({
  browser,
  request,
}, info) => {
  test.setTimeout(240000)
  const options = {
    baseURL: info.project.use.baseURL,
    ignoreHTTPSErrors: true,
    viewport: info.project.use.viewport ?? { width: 375, height: 812 },
    isMobile: info.project.use.isMobile ?? false,
    hasTouch: info.project.use.hasTouch ?? false,
    locale: 'zh-CN',
    timezoneId: 'Asia/Tokyo',
  }
  const ac = await browser.newContext(options),
    bc = await browser.newContext(options)
  const a = await ac.newPage(),
    b = await bc.newPage()
  const errors: string[] = []
  for (const p of [a, b]) p.on('pageerror', (e) => errors.push(String(e)))
  async function register(p: Page, name: string) {
    const email = `m4-${crypto.randomUUID()}@example.com`
    await p.goto('/register')
    await p.getByLabel('昵称', { exact: true }).fill(name)
    await p.getByLabel('邮箱', { exact: true }).fill(email)
    await p.getByLabel('密码', { exact: true }).fill('Waypoint-test-123')
    await p.getByRole('button', { name: '注册', exact: true }).click()
    await expect(p.getByRole('heading', { name: '我的行程' })).toBeVisible()
    return email
  }
  async function choose(name: string) {
    const chooser = a.waitForEvent('filechooser')
    await a.getByRole('button', { name: '上传凭证', exact: true }).click()
    await (await chooser).setFiles(fixture(name))
    await expect(a.getByRole('dialog', { name: '上传凭证' })).toBeVisible()
  }
  async function save(title: string) {
    await a.getByLabel('标题', { exact: true }).fill(title)
    await a.getByRole('button', { name: '保存凭证', exact: true }).click()
    await expect(a.getByRole('dialog')).toHaveCount(0)
  }
  try {
    const email = await register(a, '凭证 A')
    const verify = new URL(
      await latestMailLink(request, email, '/verify-email'),
    )
    await a.goto(verify.pathname + verify.search)
    await expect(a.getByRole('status')).toHaveText('邮箱验证成功')
    await a.goto('/')
    await a.getByRole('button', { name: '新建行程' }).click()
    await a.getByLabel('名称', { exact: true }).fill('M4 凭证旅行')
    await a.getByLabel('开始日期').fill('2026-12-01')
    await a.getByLabel('结束日期').fill('2026-12-02')
    await a.getByRole('button', { name: '保存行程' }).click()
    await expect(a).toHaveURL(/\/trips\/[\w-]+$/)
    const path = new URL(a.url()).pathname
    await a.getByRole('button', { name: '新增条目' }).click()
    await a.getByLabel('标题', { exact: true }).fill('东京集合')
    await a.getByRole('button', { name: '保存条目' }).click()
    await expect(a.getByRole('dialog')).toHaveCount(0)
    await synced(a)
    await a.goto(`${path}/members`)
    await a.getByRole('button', { name: '生成邀请链接' }).click()
    const invite = await a
      .getByRole('textbox', { name: '邀请链接' })
      .inputValue()
    await register(b, '凭证 B')
    await b.goto(invite)
    await b.getByRole('button', { name: '加入行程', exact: true }).click()
    await expect(b).toHaveURL(path)
    await a.goto(`${path}/documents`)
    await b.goto(`${path}/documents`)
    await choose('ticket.pdf')
    await a.getByLabel('类型', { exact: true }).selectOption('flight')
    await a.getByLabel('标题', { exact: true }).fill('东京机票')
    await a.getByRole('checkbox', { name: /东京集合/ }).check()
    if (info.project.name === 'mobile')
      await shots(a, info.project.name, 'upload')
    await save('东京机票')
    await synced(a)
    await expect(card(b, '东京机票')).toContainText('已离线可用')
    await expect(card(a, '东京机票')).toContainText('已离线可用')
    if (info.project.name === 'mobile')
      await shots(b, info.project.name, 'list')
    await b.goto(path)
    await b.getByRole('button', { name: '▤ 东京机票', exact: true }).click()
    await expect(b.getByTestId('pdf-viewer').locator('canvas')).toHaveAttribute(
      'data-rendered',
      'true',
    )
    const pdfViewer = b.getByRole('dialog', { name: '东京机票', exact: true })
    const pdfCheck = await pdfViewer.evaluate((el) => {
      const r = el.getBoundingClientRect()
      const hit = document.elementFromPoint(innerWidth / 2, 10)
      return {
        top: Math.round(r.top),
        left: Math.round(r.left),
        width: Math.round(r.width),
        height: Math.round(r.height),
        innerWidth,
        innerHeight,
        hitInsideViewer: Boolean(hit && el.contains(hit)),
        hitInsideAppHeader: Boolean(hit && hit.closest('.app-header')),
      }
    })
    expect(pdfCheck).toEqual({
      top: 0,
      left: 0,
      width: pdfCheck.innerWidth,
      height: pdfCheck.innerHeight,
      innerWidth: pdfCheck.innerWidth,
      innerHeight: pdfCheck.innerHeight,
      hitInsideViewer: true,
      hitInsideAppHeader: false,
    })
    const canvas = b.getByTestId('pdf-viewer').locator('canvas').first()
    const cssWidth = await canvas.evaluate(
      (el: HTMLCanvasElement) => el.getBoundingClientRect().width,
    )
    expect(cssWidth).toBeGreaterThanOrEqual(pdfCheck.innerWidth * 0.9)
    await expect(b.getByTestId('pdf-page-indicator')).toHaveText('第 1 / 1 页')
    await shots(b, info.project.name, 'pdf', false)
    await b.getByRole('button', { name: '凭证信息', exact: true }).click()
    await expect(
      b.getByRole('dialog', { name: '凭证信息', exact: true }),
    ).toContainText('东京集合')
    await b
      .getByRole('dialog', { name: '凭证信息', exact: true })
      .getByRole('button', { name: '关闭', exact: true })
      .click()
    const width = await canvas.evaluate((el: HTMLCanvasElement) => el.width)
    await b.getByRole('button', { name: '放大 PDF', exact: true }).click()
    await expect
      .poll(() => canvas.evaluate((el: HTMLCanvasElement) => el.width))
      .toBeGreaterThan(width)
    await b.goBack()
    await expect(b.getByRole('dialog')).toHaveCount(0)
    if (info.project.name === 'desktop') {
      const trigger = b.getByRole('button', { name: '▤ 东京机票', exact: true })
      await trigger.click()
      await expect(
        b.getByTestId('pdf-viewer').locator('canvas'),
      ).toHaveAttribute('data-rendered', 'true')
      await b.keyboard.press('Escape')
      await expect(b.getByRole('dialog')).toHaveCount(0)
      await expect(trigger).toBeFocused()
    }
    if (info.project.name === 'mobile')
      await shots(b, info.project.name, 'itinerary')
    await b.getByRole('button').filter({ hasText: '东京集合' }).first().click()
    await expect(
      b.getByRole('checkbox', { name: '东京机票', exact: true }),
    ).toBeChecked()
    await close(b)
    await b.goto(`${path}/documents`)
    await choose('ticket.png')
    await a.getByLabel('类型', { exact: true }).selectOption('visa')
    await expect(a.getByLabel('可见性', { exact: true })).toHaveValue('private')
    await save('私有签证')
    await synced(a)
    await expect(card(b, '私有签证')).toHaveCount(0)
    const privateId = await a.evaluate(async (tripPath) => {
      const snap = await (await fetch(`/api${tripPath}/snapshot`)).json()
      return snap.entities.find(
        (e: { entity: string; fields: { title: string } }) =>
          e.entity === 'voucher' && e.fields.title === '私有签证',
      ).fields.fileId as string
    }, path)
    const forbidden = await b.evaluate(
      async ({ tripPath, id }) => {
        const csrf = document.cookie
          .split('; ')
          .find((c) => c.startsWith('wp_csrf='))!
          .slice(8)
        return (
          await fetch(`/api${tripPath}/files/${id}/link`, {
            method: 'POST',
            headers: { 'X-CSRF-Token': csrf },
          })
        ).status
      },
      { tripPath: path, id: privateId },
    )
    expect([403, 404]).toContain(forbidden)
    await b.goto(`${path}/history`)
    await expect(b.getByText('私有签证', { exact: false })).toHaveCount(0)
    await b.goto(path)
    await expect(b.getByText('私有签证', { exact: false })).toHaveCount(0)
    await b.goto(`${path}/documents`)
    await choose('ticket.png')
    await save('共享图片')
    await synced(a)
    await expect(card(b, '共享图片')).toContainText('已离线可用')
    await b.evaluate(async () => {
      await navigator.serviceWorker.ready
    })
    await bc.setOffline(true)
    await b.reload()
    await b.getByRole('button', { name: '共享图片', exact: true }).click()
    await expect(b.getByTestId('image-viewer').locator('img')).toBeVisible()
    expect(
      await b
        .getByTestId('image-viewer')
        .locator('img')
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    ).toBeGreaterThan(0)
    const imgViewer = b.getByRole('dialog', { name: '共享图片', exact: true })
    const imgCheck = await imgViewer.evaluate((el) => {
      const r = el.getBoundingClientRect()
      const hit = document.elementFromPoint(innerWidth / 2, 10)
      return {
        top: Math.round(r.top),
        left: Math.round(r.left),
        width: Math.round(r.width),
        height: Math.round(r.height),
        innerWidth,
        innerHeight,
        hitInsideViewer: Boolean(hit && el.contains(hit)),
        hitInsideAppHeader: Boolean(hit && hit.closest('.app-header')),
      }
    })
    expect(imgCheck).toEqual({
      top: 0,
      left: 0,
      width: imgCheck.innerWidth,
      height: imgCheck.innerHeight,
      innerWidth: imgCheck.innerWidth,
      innerHeight: imgCheck.innerHeight,
      hitInsideViewer: true,
      hitInsideAppHeader: false,
    })
    await shots(b, info.project.name, 'image', false)
    await close(b)
    await b.getByRole('button', { name: '东京机票', exact: true }).click()
    await expect(b.getByTestId('pdf-viewer').locator('canvas')).toHaveAttribute(
      'data-rendered',
      'true',
    )
    await close(b)
    await bc.setOffline(false)
    await ac.setOffline(true)
    await choose('ticket.png')
    await save('离线上传图片')
    await expect(card(a, '离线上传图片')).toContainText('待上传')
    await ac.setOffline(false)
    await synced(a)
    await expect(card(b, '离线上传图片')).toContainText('已离线可用')
    const chooser = a.waitForEvent('filechooser')
    await a.getByRole('button', { name: '上传凭证', exact: true }).click()
    await (
      await chooser
    ).setFiles({
      name: 'large.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.alloc(33 * 1024 * 1024),
    })
    await expect(a.getByText('文件过大，单个文件不能超过 32MB')).toBeVisible()
    await choose('sample.heic')
    await save('HEIC 照片')
    await synced(a)
    await expect(card(b, 'HEIC 照片')).toContainText('已离线可用')
    const mime = await a.evaluate(async (tripPath) => {
      const snap = await (await fetch(`/api${tripPath}/snapshot`)).json()
      return snap.entities.find(
        (e: { entity: string; fields: { title: string } }) =>
          e.entity === 'voucher' && e.fields.title === 'HEIC 照片',
      ).fields.mime
    }, path)
    expect(mime).toBe('image/jpeg')
    await b.getByRole('button', { name: 'HEIC 照片', exact: true }).click()
    await expect(b.getByTestId('image-viewer').locator('img')).toBeVisible()
    await close(b)
    const cacheSize = () =>
      b.evaluate(async () => {
        const user = JSON.parse(localStorage.getItem('wp:lastUser')!).id
        const c = await caches.open(`waypoint-credentials-${user}`)
        let size = 0
        for (const r of await c.keys())
          size += (await (await c.match(r))!.blob()).size
        return size
      })
    const before = await cacheSize()
    const actionRole = info.project.name === 'desktop' ? 'menuitem' : 'button'
    await b
      .getByRole('button', { name: '凭证操作 共享图片', exact: true })
      .click()
    await b.getByRole(actionRole, { name: '取消离线', exact: true }).click()
    await expect(card(b, '共享图片')).toContainText('未离线')
    await expect.poll(cacheSize).toBeLessThan(before)
    await b.reload()
    await synced(b)
    await expect(card(b, '共享图片')).toContainText('未离线')
    await b
      .getByRole('button', { name: '凭证操作 共享图片', exact: true })
      .click()
    await b.getByRole(actionRole, { name: '重新离线', exact: true }).click()
    await expect(card(b, '共享图片')).toContainText('已离线可用')
    const userId = await b.evaluate(
      () => JSON.parse(localStorage.getItem('wp:lastUser')!).id as string,
    )
    await b.goto('/account')
    await b.getByRole('button', { name: '退出登录', exact: true }).click()
    await expect(b).toHaveURL(/\/login/)
    expect(
      await b.evaluate(
        async (user) =>
          (await caches.keys()).filter((k) =>
            k.startsWith(`waypoint-credentials-${user}`),
          ),
        userId,
      ),
    ).toEqual([])
    expect(errors).toEqual([])
  } finally {
    await ac.close()
    await bc.close()
  }
})
