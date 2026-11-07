import { test, expect, type Page, type APIRequestContext } from './csp'
import { latestMailLink } from './mailpit'
const password = 'Waypoint-test-123'
async function register(page: Page, name = '旅人') {
  const email = `e2e-${crypto.randomUUID()}@example.com`
  await page.goto('/register')
  await page.getByLabel('昵称', { exact: true }).fill(name)
  await page.getByLabel('邮箱', { exact: true }).fill(email)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '注册', exact: true }).click()
  await expect(page.getByRole('heading', { name: '我的行程' })).toBeVisible()
  return email
}
async function verify(page: Page, request: APIRequestContext, email: string) {
  const link = new URL(await latestMailLink(request, email, '/verify-email'))
  await page.goto(link.pathname + link.search)
  await expect(page.getByRole('status')).toHaveText('邮箱验证成功')
  await page.getByRole('link', { name: '返回账户' }).click()
}
test('账号流程与修改密码保留当前会话', async ({ page, context, request }) => {
  const email = await register(page)
  await verify(page, request, email)
  await page.getByLabel('昵称', { exact: true }).fill('远行者')
  await page.getByRole('button', { name: '保存昵称' }).click()
  await expect(page.locator('strong')).toHaveText('远行者')
  await page.getByRole('button', { name: '修改密码', exact: true }).click()
  await page.getByLabel('原密码', { exact: true }).fill(password)
  await page.getByLabel('新密码', { exact: true }).fill('New-waypoint-456')
  await page.getByRole('button', { name: '确认修改' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page).toHaveURL(/\/account$/)
  await expect(page.getByText('密码已修改，其他设备已退出登录')).toBeVisible()
  await page.reload()
  await expect(page.locator('strong')).toHaveText('远行者')
  await context.clearCookies()
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('登录已失效')
  await expect(page.getByRole('button', { name: '保存昵称' })).toBeDisabled()
  await page.getByRole('link', { name: '重新登录', exact: true }).click()
  await page.getByLabel('邮箱', { exact: true }).fill(email)
  await page.getByLabel('密码', { exact: true }).fill('New-waypoint-456')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL(/\/account$/)
})
test('找回密码', async ({ page, request }) => {
  const email = await register(page)
  await page.goto('/account')
  await page.getByRole('button', { name: '退出登录' }).click()
  await page.getByRole('link', { name: '忘记密码？' }).click()
  await expect(
    page.getByRole('heading', { name: '找回密码', exact: true }),
  ).toBeVisible()
  await page.getByLabel('邮箱', { exact: true }).fill(email)
  await page.getByRole('button', { name: '发送重置邮件' }).click()
  await expect(page.getByRole('status')).toContainText('重置邮件')
  const link = new URL(await latestMailLink(request, email, '/reset-password'))
  await page.goto(link.pathname + link.search)
  await page.getByLabel('新密码', { exact: true }).fill('New-waypoint-456')
  await page.getByRole('button', { name: '重置密码', exact: true }).click()
  await expect(page).toHaveURL(/\/login/)
  await page.getByLabel('邮箱', { exact: true }).fill(email)
  await page.getByLabel('密码', { exact: true }).fill('New-waypoint-456')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '我的行程' })).toBeVisible()
})
test('弹层返回', async ({ page }, info) => {
  await register(page)
  await page.goto('/account')
  await page.getByRole('button', { name: '修改密码', exact: true }).click()
  await expect(
    page.locator(
      `[data-overlay="${info.project.name === 'mobile' ? 'drawer' : 'dialog'}"]`,
    ),
  ).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page).toHaveURL(/\/account$/)
  await page.getByRole('button', { name: '修改密码', exact: true }).click()
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
test('主题', async ({ page }) => {
  await register(page)
  await page.goto('/account')
  for (const theme of ['dark', 'light']) {
    await page.getByLabel('主题', { exact: true }).selectOption(theme)
    await page.addInitScript(() => {
      requestAnimationFrame(() =>
        Object.assign(window, {
          firstTheme: document.documentElement.classList.contains('dark'),
        }),
      )
    })
    await page.reload()
    expect(await page.evaluate(() => Reflect.get(window, 'firstTheme'))).toBe(
      theme === 'dark',
    )
    expect(
      await page.locator('meta[name="theme-color"]').getAttribute('content'),
    ).toBe(theme === 'dark' ? '#0E141B' : '#F7FAFC')
    await expect(
      page.locator('meta[name="apple-mobile-web-app-status-bar-style"]'),
    ).toHaveAttribute(
      'content',
      theme === 'dark' ? 'black-translucent' : 'default',
    )
  }
  await page.getByLabel('主题', { exact: true }).selectOption('system')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveClass('dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).not.toHaveClass('dark')
})
test('离线外壳', async ({ page, context }) => {
  await register(page)
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await page.goto('/account')
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true)
  await context.setOffline(true)
  await page.reload()
  await expect(page.locator('strong')).toHaveText('旅人')
  await expect(page.getByRole('status')).toContainText('离线')
  await expect(page.getByRole('button', { name: '保存昵称' })).toBeDisabled()
})
test('邀请加入、成员同步、离线数据与移除', async ({
  page,
  browser,
  request,
}, info) => {
  const email = await register(page, '发起人')
  await verify(page, request, email)
  await page.goto('/')
  await page.getByRole('button', { name: '新建行程' }).click()
  await page.getByLabel('名称', { exact: true }).fill('端到端测试之旅')
  await page.getByLabel('开始日期').fill('2027-01-01')
  await page.getByLabel('结束日期').fill('2027-01-03')
  await page.getByRole('button', { name: '保存行程' }).click()
  await expect(page).toHaveURL(/\/trips\/[\w-]+$/)
  const tripPath = new URL(page.url()).pathname
  await page.getByRole('link', { name: '更多', exact: true }).click()
  await page.getByRole('link', { name: '成员', exact: true }).click()
  await page.getByRole('button', { name: '生成邀请链接' }).click()
  const invite = page.getByRole('textbox', { name: '邀请链接' })
  await expect(invite).toBeVisible()
  const url = await invite.inputValue()
  const guestContext = await browser.newContext({
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    baseURL: info.project.use.baseURL ?? 'http://localhost:8088',
    ignoreHTTPSErrors: true,
    viewport: info.project.use.viewport,
  })
  try {
    const guest = await guestContext.newPage()
    await guest.goto(url)
    await guest.getByRole('link', { name: '注册并加入' }).click()
    await guest.getByLabel('昵称', { exact: true }).fill('同行人')
    await guest
      .getByLabel('邮箱', { exact: true })
      .fill(`guest-${crypto.randomUUID()}@example.com`)
    await guest.getByLabel('密码', { exact: true }).fill(password)
    await guest.getByRole('button', { name: '注册', exact: true }).click()
    await expect(guest).toHaveURL(tripPath)
    await guest.getByRole('link', { name: '更多', exact: true }).click()
    await guest.getByRole('link', { name: '成员', exact: true }).click()
    await expect(guest.getByText('发起人', { exact: true })).toBeVisible()
    await expect(page.getByText('同行人', { exact: true })).toBeVisible()
    await guest.evaluate(async () => {
      await navigator.serviceWorker.ready
    })
    await guest.reload()
    await expect
      .poll(() => guest.evaluate(() => !!navigator.serviceWorker.controller))
      .toBe(true)
    await guestContext.setOffline(true)
    await guest.reload()
    await expect(guest.getByText('发起人', { exact: true })).toBeVisible()
    await guest.getByRole('link', { name: '我的行程', exact: true }).click()
    await expect(
      guest.getByRole('heading', { name: '端到端测试之旅' }),
    ).toBeVisible()
    await guest.reload()
    await expect(
      guest.getByRole('heading', { name: '端到端测试之旅' }),
    ).toBeVisible()
    await guestContext.setOffline(false)
    await guest.goto(`${tripPath}/members`)
    await page.getByRole('button', { name: '移除成员' }).click()
    await page.getByRole('button', { name: '确认', exact: true }).click()
    await expect(guest.getByText(/你已被移出行程/)).toBeVisible()
    await guest.goto('/')
    await expect(
      guest.getByRole('heading', { name: '端到端测试之旅' }),
    ).toHaveCount(0)
    await expect(page.getByText('已退出成员')).toBeVisible()
  } finally {
    await guestContext.close()
  }
})
test('静态资源缺失返回 404，页面路由仍可打开', async ({ request }) => {
  const asset = await request.get('/assets/does-not-exist.js')
  expect(asset.status()).toBe(404)
  expect(asset.headers()['cache-control'] ?? '').not.toContain('immutable')
  expect((await request.get('/login')).status()).toBe(200)
})
