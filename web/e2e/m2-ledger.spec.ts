import { test, expect, type Page } from '@playwright/test'
import { latestMailLink } from './mailpit'
import { netBalances, settle } from '../src/domain/settlement'
import { valueExpense } from '../src/domain/expense'
import { formatMoney } from '../src/domain/money'
import type { Expense } from '../src/domain/ledger-types'

test.use({ actionTimeout: 10000 })
const synced = async (page: Page) =>
  expect(page.getByRole('status', { name: /^同步状态/ })).toHaveText('已同步')
const expenseCard = (p: Page, title: string) =>
  p
    .getByTestId('expense-card')
    .filter({ has: p.getByText(title, { exact: true }) })
async function close(p: Page) {
  await p
    .getByRole('dialog')
    .last()
    .getByRole('button', { name: '关闭', exact: true })
    .click()
}
async function screenshots(p: Page, name: string) {
  await expect(
    p.locator('[data-sonner-toast][data-visible="true"]'),
  ).toHaveCount(0)
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
    await p.screenshot({
      animations: 'disabled',
      path: `e2e/screenshots/m2-${name}-${theme}.png`,
      fullPage: true,
    })
  }
  await p.evaluate(() => document.documentElement.classList.remove('dark'))
}
async function chooseCurrency(p: Page, currency: string) {
  await p
    .getByRole('dialog')
    .last()
    .getByRole('button', { name: '币种', exact: true })
    .click()
  await p.getByLabel('搜索币种').fill(currency)
  await p
    .locator('[cmdk-item]')
    .filter({ hasText: new RegExp(`^${currency}$`) })
    .click()
  await expect(
    p.getByRole('dialog', { name: '选择币种', exact: true }),
  ).toHaveCount(0)
}
async function rate(p: Page, value: string, count: number) {
  await p.getByRole('button', { name: '默认汇率', exact: true }).click()
  await p.getByLabel('默认汇率', { exact: true }).fill(value)
  await p.getByRole('button', { name: '保存默认汇率' }).click()
  await expect(
    p.getByText(`将影响 ${count} 笔按默认汇率计算的账目`, { exact: true }),
  ).toBeVisible()
  await p.getByRole('button', { name: '确认修改', exact: true }).click()
  await expect(
    p.getByRole('dialog', { name: '确认修改默认汇率', exact: true }),
  ).toHaveCount(0)
  await expect(
    p.getByRole('dialog', { name: '默认汇率设置', exact: true }),
  ).toBeVisible()
  await close(p)
  await expect(p.getByRole('dialog')).toHaveCount(0)
}
async function addExpense(
  p: Page,
  title: string,
  amount: string,
  kind: 'cny' | 'card' | 'cash',
  shot?: string,
) {
  await p.getByRole('button', { name: '新增账目' }).click()
  if (kind !== 'cny') await chooseCurrency(p, 'JPY')
  if (kind === 'cash')
    await p.getByRole('button', { name: '现金', exact: true }).click()
  await p.getByLabel('金额', { exact: true }).fill(amount)
  await p.getByLabel('标题', { exact: true }).fill(title)
  await p.getByLabel('日期', { exact: true }).fill('2026-11-10')
  if (kind === 'cash') await p.getByLabel('时间', { exact: true }).fill('12:00')
  if (shot) await screenshots(p, shot)
  await p.getByRole('button', { name: '保存账目' }).click()
  await expect(p.getByRole('dialog')).toHaveCount(0)
  await expect(expenseCard(p, title)).toBeVisible()
}
test('M2 多币种、钱包、对账、三人结算、离线与汇率冲突', async ({
  browser,
  request,
}, info) => {
  test.setTimeout(300000)
  const options = {
    baseURL: info.project.use.baseURL,
    ignoreHTTPSErrors: true,
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  }
  const ac = await browser.newContext(options),
    bc = await browser.newContext(options),
    cc = await browser.newContext(options)
  const a = await ac.newPage(),
    b = await bc.newPage(),
    c = await cc.newPage()
  async function register(p: Page, name: string) {
    const email = `m2-${crypto.randomUUID()}@example.com`
    await p.goto('/register')
    await p.getByLabel('昵称', { exact: true }).fill(name)
    await p.getByLabel('邮箱', { exact: true }).fill(email)
    await p.getByLabel('密码', { exact: true }).fill('Waypoint-test-123')
    await p.getByRole('button', { name: '注册', exact: true }).click()
    await expect(p.getByRole('heading', { name: '我的行程' })).toBeVisible()
    return email
  }
  try {
    const email = await register(a, '账本 A'),
      link = new URL(await latestMailLink(request, email, '/verify-email'))
    await a.goto(link.pathname + link.search)
    await expect(a.getByRole('status')).toHaveText('邮箱验证成功')
    await a.goto('/')
    await a.getByRole('button', { name: '新建行程' }).click()
    await a.getByLabel('名称', { exact: true }).fill('M2 账本之旅')
    await a.getByLabel('开始日期').fill('2026-11-10')
    await a.getByLabel('结束日期').fill('2026-11-12')
    await a.getByRole('button', { name: '保存行程' }).click()
    await expect(a).toHaveURL(/\/trips\/[\w-]+$/)
    const path = new URL(a.url()).pathname,
      tripId = path.split('/').at(-1)!
    await a.goto(`${path}/members`)
    await a.getByRole('button', { name: '生成邀请链接' }).click()
    const invite = await a
      .getByRole('textbox', { name: '邀请链接' })
      .inputValue()
    for (const [p, name] of [
      [b, '账本 B'],
      [c, '账本 C'],
    ] as const) {
      await register(p, name)
      await p.goto(invite)
      await p.getByRole('button', { name: '加入行程', exact: true }).click()
      await expect(p).toHaveURL(path)
    }
    for (const p of [a, b, c]) await p.goto(`${path}/ledger`)
    await synced(a)
    await synced(b)
    await synced(c)
    await test.step('默认汇率重算与实际扣款隔离', async () => {
      await rate(a, '0.05', 0)
      await synced(a)
      await addExpense(
        a,
        '刷卡寿司',
        '1000',
        'card',
        info.project.name === 'mobile' ? 'form-card' : undefined,
      )
      await synced(a)
      await expect(expenseCard(a, '刷卡寿司')).toContainText('¥50.00')
      await expect(expenseCard(a, '刷卡寿司')).toContainText('估算')
      await rate(a, '0.06', 1)
      await expect(expenseCard(a, '刷卡寿司')).toContainText('¥60.00')
      await a.getByRole('button', { name: '对账', exact: true }).click()
      if (info.project.name === 'mobile') await screenshots(a, 'reconcile')
      await a.getByLabel('实际扣款人民币', { exact: true }).fill('55.01')
      await a.getByRole('button', { name: '保存实际扣款' }).click()
      await expect(a.getByRole('button', { name: '保存实际扣款' })).toHaveCount(
        0,
      )
      await a.getByRole('button', { name: '账目', exact: true }).click()
      await expect(expenseCard(a, '刷卡寿司')).toContainText('已核实')
      await rate(a, '0.07', 0)
      await expect(expenseCard(a, '刷卡寿司')).toContainText('¥55.01')
      await synced(a)
    })
    await test.step('两次换汇与现金权限', async () => {
      await a.getByRole('button', { name: '钱包', exact: true }).click()
      for (const [paid, time] of [
        ['50', '09:00'],
        ['70', '10:00'],
      ]) {
        await a.getByRole('button', { name: '新增换汇' }).click()
        await a.getByLabel('支付人民币').fill(paid)
        await a.getByLabel('收到外币').fill('1000')
        await a.getByLabel('换汇日期').fill('2026-11-10')
        await a.getByLabel('换汇时间').fill(time)
        await a.getByRole('button', { name: '保存换汇' }).click()
        await expect(a.getByRole('dialog')).toHaveCount(0)
      }
      await a.getByRole('button', { name: '账目', exact: true }).click()
      await addExpense(
        a,
        '现金拉面',
        '500',
        'cash',
        info.project.name === 'mobile' ? 'form-cash' : undefined,
      )
      await synced(a)
      await expect(expenseCard(a, '现金拉面')).toContainText('¥30.00')
      await a.getByRole('button', { name: '钱包', exact: true }).click()
      await expect(
        a.getByText('平均成本汇率：0.06', { exact: true }),
      ).toBeVisible()
      await expect(a.getByText('JPY 1,500', { exact: true })).toBeVisible()
      if (info.project.name === 'mobile') await screenshots(a, 'wallet')
      await expect(expenseCard(b, '现金拉面')).toBeVisible()
      await expenseCard(b, '现金拉面')
        .getByRole('button', { name: '现金拉面', exact: true })
        .click()
      await expect(b.getByLabel('金额', { exact: true })).toBeDisabled()
      await close(b)
      await a.getByRole('button', { name: '账目', exact: true }).click()
    })
    await test.step('三人精确结算、标记与撤销', async () => {
      await addExpense(b, '交通', '10.01', 'cny')
      await addExpense(c, '门票', '20.02', 'cny')
      await synced(b)
      await synced(c)
      await synced(a)
      const snapshot = await a.evaluate(async (tripId) => {
        const r = await fetch(`/api/trips/${tripId}/snapshot`)
        return r.json()
      }, tripId)
      const expenses: Expense[] = snapshot.entities
        .filter(
          (e: { entity: string; deleted: boolean }) =>
            e.entity === 'expense' && !e.deleted,
        )
        .map((e: { entityId: string; createdSeq: number; fields: object }) => ({
          ...e.fields,
          id: e.entityId,
          createdSeq: e.createdSeq,
        }))
      const vals = Object.fromEntries(
        expenses.map((e) => [
          e.id,
          valueExpense(
            e,
            { JPY: '0.07' },
            {
              [expenses.find((e) => e.title === '现金拉面')!.id]: {
                amountCny: 3000n,
                rate: '0.06',
                status: '钱包成本',
              },
            },
          ),
        ]),
      )
      const members = snapshot.entities.filter(
          (e: { entity: string }) => e.entity === 'member',
        ),
        names: Record<string, string> = Object.fromEntries(
          members.map(
            (m: { entityId: string; fields: { nickname: string } }) => [
              m.entityId,
              m.fields.nickname,
            ],
          ),
        )
      const expected = netBalances(expenses, vals, [], Object.keys(names)),
        suggestions = settle(expected.net)
      await a.getByRole('button', { name: '结算', exact: true }).click()
      for (const [id, n] of Object.entries(expected.net))
        await expect(
          a.getByText(`${names[id]} · 净额 ${formatMoney(n)}`, { exact: true }),
        ).toBeVisible()
      for (const t of suggestions.transfers)
        await expect(
          a.getByText(
            `${names[t.fromUserId]} → ${names[t.toUserId]} ${formatMoney(t.amountCny)}`,
            { exact: true },
          ),
        ).toBeVisible()
      await a.getByText('账本 A · 净额', { exact: false }).click()
      await expect(a.getByText(/已付 ¥85.01/)).toBeVisible()
      if (info.project.name === 'mobile') await screenshots(a, 'settlement')
      const before = await a
        .getByTestId('settlement-member')
        .getByRole('button')
        .allTextContents()
      await a.getByRole('button', { name: '标记已转账' }).first().click()
      await expect(a.getByRole('button', { name: '撤销转账' })).toHaveCount(1)
      await expect
        .poll(() =>
          a
            .getByTestId('settlement-member')
            .getByRole('button')
            .allTextContents(),
        )
        .not.toEqual(before)
      await a.getByRole('button', { name: '撤销转账' }).click()
      await expect
        .poll(() =>
          a
            .getByTestId('settlement-member')
            .getByRole('button')
            .allTextContents(),
        )
        .toEqual(before)
      await synced(a)
    })
    await test.step('离线刷卡与现金恢复后金额结算一致', async () => {
      await a.getByRole('button', { name: '账目', exact: true }).click()
      await ac.setOffline(true)
      await addExpense(a, '离线刷卡', '100', 'card')
      await addExpense(a, '离线现金', '100', 'cash')
      await ac.setOffline(false)
      await synced(a)
      await synced(b)
      await expect(expenseCard(b, '离线刷卡')).toContainText('¥7.00')
      await expect(expenseCard(b, '离线现金')).toContainText('¥6.00')
      if (info.project.name === 'mobile') await screenshots(a, 'home')
      await a.getByRole('button', { name: '结算', exact: true }).click()
      await b.getByRole('button', { name: '结算', exact: true }).click()
      await expect
        .poll(() =>
          b
            .getByTestId('settlement-member')
            .getByRole('button')
            .allTextContents(),
        )
        .toEqual(
          await a
            .getByTestId('settlement-member')
            .getByRole('button')
            .allTextContents(),
        )
    })
    await test.step('离线同时改同一币种产生冲突提示', async () => {
      await synced(a)
      await synced(b)
      await ac.setOffline(true)
      await bc.setOffline(true)
      await rate(a, '0.08', 1)
      await rate(b, '0.09', 1)
      await ac.setOffline(false)
      await synced(a)
      await bc.setOffline(false)
      await synced(b)
      await expect(b.getByRole('link', { name: /同步冲突提示/ })).toBeVisible()
      await b.getByRole('link', { name: /同步冲突提示/ }).click()
      await expect(b.getByRole('dialog', { name: '行程提示' })).toContainText(
        'JPY',
      )
      await expect(b.getByRole('dialog', { name: '行程提示' })).toContainText(
        '覆盖',
      )
    })
  } finally {
    await ac.close()
    await bc.close()
    await cc.close()
  }
})
