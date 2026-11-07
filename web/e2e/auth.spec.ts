import { test, expect } from '@playwright/test'
import { latestMailLink } from './mailpit'
test('账号流程、弹层历史、主题与离线外壳', async ({
  page,
  context,
  request,
}, testInfo) => {
  const email = `e2e-${testInfo.project.name}-${Date.now()}@example.com`
  const password = 'Waypoint-test-123'
  await page.goto('/register')
  await page.getByLabel('昵称', { exact: true }).fill('旅人')
  await page.getByLabel('邮箱', { exact: true }).fill(email)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '注册', exact: true }).click()
  await expect(page.getByRole('heading', { name: '我的行程' })).toBeVisible()
  const verify = await latestMailLink(request, email, '/verify-email')
  await page.goto(new URL(verify).pathname + new URL(verify).search)
  await expect(page.getByRole('status')).toHaveText('邮箱验证成功')
  await page.getByRole('link', { name: '返回账户' }).click()
  await expect(page.getByText('邮箱尚未验证', { exact: false })).toHaveCount(0)
  await page.getByRole('button', { name: '退出登录' }).click()
  await expect(page).toHaveURL(/\/login/)
  await page.getByLabel('邮箱', { exact: true }).fill(email)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.getByRole('link', { name: '账户', exact: true }).click()
  await page.getByLabel('昵称', { exact: true }).fill('远行者')
  await page.getByRole('button', { name: '保存昵称' }).click()
  await expect(page.locator('strong')).toHaveText('远行者')
  await context.clearCookies()
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('登录已失效')
  await expect(page.getByRole('button', { name: '保存昵称' })).toBeDisabled()
  await page.getByRole('link', { name: '重新登录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible()
  await page.getByLabel('邮箱', { exact: true }).fill(email)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: '账户', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: '修改密码', exact: true }).click()
  const overlay = page.locator(
    `[data-overlay="${testInfo.project.name === 'mobile' ? 'drawer' : 'dialog'}"]`,
  )
  await expect(overlay).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page).toHaveURL(/\/account$/)
  await page.getByRole('button', { name: '修改密码', exact: true }).click()
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByLabel('主题', { exact: true }).selectOption('dark')
  await page.addInitScript(() => {
    requestAnimationFrame(() => {
      Object.assign(window, {
        firstTheme: document.documentElement.classList.contains('dark'),
      })
    })
  })
  await page.reload()
  await expect(page.locator('html')).toHaveClass('dark')
  expect(await page.evaluate(() => Reflect.get(window, 'firstTheme'))).toBe(
    true,
  )
  // 首次应用脚本执行前，主题已经由 head 内脚本设置。
  expect(
    await page.evaluate(() =>
      document
        .querySelector('meta[name="theme-color"]')
        ?.getAttribute('content'),
    ),
  ).toBe('#0E141B')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true)
  await context.setOffline(true)
  await page.reload()
  await expect(page.locator('strong')).toHaveText('远行者')
  await expect(page.getByRole('status')).toContainText('离线')
  await expect(page.getByRole('button', { name: '保存昵称' })).toBeDisabled()
  await context.setOffline(false)
  await page.reload()
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('主题', { exact: true }).selectOption(theme)
    await page.goto('/trips/00000000-0000-4000-8000-000000000001')
    await expect(
      page.getByRole('heading', { name: '行程', exact: true }),
    ).toBeVisible()
    await page.screenshot({
      path: `e2e/screenshots/${testInfo.project.name}-${theme}-trip.png`,
      fullPage: true,
      animations: 'disabled',
    })
    await page.goto('/login')
    expect(await page.evaluate(() => Reflect.get(window, 'firstTheme'))).toBe(
      theme === 'dark',
    )
    await page.screenshot({
      path: `e2e/screenshots/${testInfo.project.name}-${theme}-login.png`,
      fullPage: true,
      animations: 'disabled',
    })
    await page.goto('/account')
  }
  await page.getByLabel('主题', { exact: true }).selectOption('system')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).not.toHaveClass('dark')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveClass('dark')
  await page.getByRole('button', { name: '退出登录' }).click()
  await page.getByRole('link', { name: '忘记密码？' }).click()
  await expect(page.getByRole('heading', { name: '找回密码' })).toBeVisible()
  await page.getByLabel('邮箱', { exact: true }).fill(email)
  await page.getByRole('button', { name: '发送重置邮件' }).click()
  await expect(page.getByRole('status')).toContainText('重置邮件')
  const reset = await latestMailLink(request, email, '/reset-password')
  await page.goto(new URL(reset).pathname + new URL(reset).search)
  await page.getByLabel('新密码', { exact: true }).fill('New-waypoint-456')
  await page.getByRole('button', { name: '重置密码', exact: true }).click()
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible()
  await page.getByLabel('邮箱', { exact: true }).fill(email)
  await page.getByLabel('密码', { exact: true }).fill('New-waypoint-456')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '我的行程' })).toBeVisible()
  const csrf = await (await context.request.get('/api/auth/csrf')).json()
  const headers = { 'X-CSRF-Token': csrf.token }
  const tripResponse = await context.request.post('/api/trips', {
    headers,
    data: {
      name: '端到端测试之旅',
      startDate: '2027-01-01',
      endDate: '2027-01-03',
      timezone: 'Asia/Tokyo',
    },
  })
  expect(tripResponse.ok()).toBe(true)
  const trip = await tripResponse.json()
  const inviteResponse = await context.request.post(
    `/api/trips/${trip.id}/invites`,
    { headers, data: {} },
  )
  expect(inviteResponse.ok()).toBe(true)
  const invite = await inviteResponse.json()
  await page.goto(`/join/${invite.token}`)
  await expect(
    page.getByRole('heading', { name: '端到端测试之旅' }),
  ).toBeVisible()
  await page.getByRole('button', { name: '加入行程', exact: true }).click()
  await expect(page).toHaveURL(`/trips/${trip.id}`)
  await page.goto('/account')
  await page.getByRole('button', { name: '退出登录' }).click()
  await expect(page).toHaveURL(/\/login/)
  await page.goto(`/join/${invite.token}`)
  await page.getByRole('link', { name: '注册并加入' }).click()
  await expect(
    page.getByRole('heading', { name: '创建账号', exact: true }),
  ).toBeVisible()
  await page.getByLabel('昵称', { exact: true }).fill('同行人')
  await page.getByLabel('邮箱', { exact: true }).fill(`guest-${email}`)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '注册', exact: true }).click()
  await expect(page).toHaveURL(`/trips/${trip.id}`)
  await page.getByRole('link', { name: '更多', exact: true }).click()
  await page.getByRole('link', { name: '成员', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: '成员', exact: true }),
  ).toBeVisible()
  await page.getByRole('link', { name: '账户', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: '账户', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: '修改密码', exact: true }).click()
  await page.getByLabel('原密码', { exact: true }).fill(password)
  await page
    .getByLabel('新密码', { exact: true })
    .fill('Guest-new-password-123')
  await page.getByRole('button', { name: '确认修改', exact: true }).click()
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible()
  await page.getByLabel('邮箱', { exact: true }).fill(`guest-${email}`)
  await page.getByLabel('密码', { exact: true }).fill('Guest-new-password-123')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '我的行程' })).toBeVisible()
})
test('静态资源缺失返回 404，页面路由仍可打开', async ({ request }) => {
  const asset = await request.get('/assets/does-not-exist.js')
  expect(asset.status()).toBe(404)
  expect(asset.headers()['cache-control'] ?? '').not.toContain('immutable')
  expect((await request.get('/login')).status()).toBe(200)
})
