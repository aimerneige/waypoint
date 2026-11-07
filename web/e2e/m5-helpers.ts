import { expect, type Page } from '@playwright/test'
export const synced = (page: Page) =>
  expect(page.getByRole('status', { name: /^同步状态/ })).toHaveText('已同步')
export async function register(page: Page, name: string) {
  const email = `m5-${crypto.randomUUID()}@example.com`
  await page.goto('/register')
  await page.getByLabel('昵称', { exact: true }).fill(name)
  await page.getByLabel('邮箱', { exact: true }).fill(email)
  await page.getByLabel('密码', { exact: true }).fill('Waypoint-test-123')
  await page.getByRole('button', { name: '注册', exact: true }).click()
  await expect(page.getByRole('heading', { name: '我的行程' })).toBeVisible()
  return email
}
export async function newTrip(page: Page) {
  await page.getByRole('button', { name: '新建行程' }).click()
  await page.getByLabel('名称', { exact: true }).fill('M5 打磨验收')
  await page.getByLabel('开始日期').fill('2026-12-01')
  await page.getByLabel('结束日期').fill('2026-12-02')
  await page.getByRole('button', { name: '保存行程' }).click()
  await expect(page).toHaveURL(/\/trips\/[\w-]+$/)
  await synced(page)
  return new URL(page.url()).pathname
}
export async function close(page: Page) {
  await page
    .getByRole('dialog')
    .last()
    .getByRole('button', { name: '关闭', exact: true })
    .click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}
