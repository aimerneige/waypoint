import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { register, newTrip, close } from './m5-helpers'
test.use({ reducedMotion: 'reduce', actionTimeout: 10000 })

test('M5 主要页面触摸尺寸、axe、长文本、安全区与截图', async ({
  page,
}, info) => {
  test.setTimeout(180000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await register(page, '打磨检查')
  const path = await newTrip(page)
  await page.getByRole('button', { name: '新增条目' }).click()
  await page.getByLabel('标题', { exact: true }).fill('长'.repeat(200))
  await page.getByLabel('地点', { exact: true }).fill('地点'.repeat(100))
  await page.getByRole('button', { name: '保存条目' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  for (const route of [
    '',
    '/wishes',
    '/ledger',
    '/packing',
    '/polls',
    '/documents',
    '/members',
    '/settings',
    '/history',
    '/more',
    '/account',
    '/',
    '/login',
  ]) {
    const global = ['/account', '/', '/login'].includes(route)
    const shotName = route === '/' ? 'trips' : route.slice(1) || 'itinerary'
    await page.goto(global ? route : path + route)
    await expect(page.getByRole('heading').first()).toBeVisible()
    await expect(
      page.getByRole('status', { name: '正在读取本地数据' }),
    ).toHaveCount(0)
    const small = await page
      .locator('button,a,[role="button"],input')
      .evaluateAll((elements) =>
        elements.flatMap((el) => {
          const r = el.getBoundingClientRect(),
            css = getComputedStyle(el)
          if (
            !r.width ||
            !r.height ||
            css.visibility === 'hidden' ||
            css.display === 'none'
          )
            return []
          // 文件输入由 44px 上传按钮代理，不是独立的可见触摸目标。
          if (
            el instanceof HTMLInputElement &&
            el.type === 'file' &&
            css.opacity === '0'
          )
            return []
          return r.width < 43.9 || r.height < 43.9
            ? [
                {
                  tag: el.tagName,
                  text: el.getAttribute('aria-label') || el.textContent,
                  width: r.width,
                  height: r.height,
                },
              ]
            : []
        }),
      )
    expect(small, route).toEqual([])
    const axe = await new AxeBuilder({ page }).analyze()
    expect(
      axe.violations.filter((v) =>
        ['serious', 'critical'].includes(v.impact ?? ''),
      ),
      route,
    ).toEqual([])
    for (const theme of ['light', 'dark']) {
      await page.evaluate(
        (t) => document.documentElement.classList.toggle('dark', t === 'dark'),
        theme,
      )
      const themedAxe = await new AxeBuilder({ page }).analyze()
      expect(
        themedAxe.violations.filter((v) =>
          ['serious', 'critical'].includes(v.impact ?? ''),
        ),
        `${route} ${theme}`,
      ).toEqual([])
      await page.screenshot({
        path: `e2e/screenshots/m5-${info.project.name}-${shotName}-${theme}.png`,
        fullPage: true,
        animations: 'disabled',
      })
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      route,
    ).toBe(true)
  }
  if (info.project.name === 'mobile') {
    await page.setViewportSize({ width: 320, height: 812 })
    for (const route of ['', '/ledger', '/packing', '/documents']) {
      await page.goto(path + route)
      await expect(page.locator('main h1').first()).toBeVisible()
      await page.addStyleTag({
        content: ':root { --safe-area-bottom: 34px; }',
      })
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      await page.screenshot({
        path: `e2e/screenshots/m5-320-safe-${route.slice(1) || 'itinerary'}.png`,
        fullPage: true,
      })
      if (!route) {
        await page.getByRole('button', { name: '新增条目' }).click()
        await expect(page.getByRole('dialog')).toBeVisible()
        expect(
          await page
            .getByRole('dialog')
            .evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom)),
        ).toBeGreaterThanOrEqual(58)
        await page.screenshot({
          path: 'e2e/screenshots/m5-320-safe-drawer.png',
          fullPage: true,
        })
        await close(page)
      }
    }
  }
  await page.goto(path)
  const trigger = page.getByRole('button', { name: '新增条目' })
  await trigger.click()
  const dialog = page.getByRole('dialog').last()
  await expect(dialog).toBeVisible()
  await expect
    .poll(() => dialog.evaluate((el) => el.contains(document.activeElement)))
    .toBe(true)
  await close(page)
  await expect(trigger).toBeFocused()
  expect(errors).toEqual([])
})
