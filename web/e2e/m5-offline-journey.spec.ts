import { test, expect, type Page } from './csp'
import { latestMailLink } from './mailpit'
import { register, newTrip, synced, close } from './m5-helpers'
import { fileURLToPath } from 'node:url'
test.use({ actionTimeout: 10000 })

test('M5 两人跨模块离线旅途、冲突、截止回滚与一致结算', async ({
  browser,
  request,
}, info) => {
  test.setTimeout(240000)
  const opts = {
    ...info.project.use,
    baseURL: info.project.use.baseURL,
    ignoreHTTPSErrors: true,
  }
  const ac = await browser.newContext(opts),
    bc = await browser.newContext(opts)
  const a = await ac.newPage(),
    b = await bc.newPage()
  try {
    const email = await register(a, '旅途 A')
    const verification = new URL(
      await latestMailLink(request, email, '/verify-email'),
    )
    await a.goto(verification.pathname + verification.search)
    await expect(a.getByRole('status')).toHaveText('邮箱验证成功')
    await a.goto('/')
    const path = await newTrip(a),
      tripId = path.split('/').at(-1)!
    await a.goto(path + '/members')
    await a.getByRole('button', { name: '生成邀请链接' }).click()
    const invite = await a
      .getByRole('textbox', { name: '邀请链接' })
      .inputValue()
    await register(b, '旅途 B')
    await b.goto(invite)
    await b.getByRole('button', { name: '加入行程', exact: true }).click()
    await expect(b).toHaveURL(path)
    const user = (p: Page) =>
      p.evaluate(
        () => JSON.parse(localStorage.getItem('wp:lastUser')!).id as string,
      )
    const aid = await user(a),
      bid = await user(b)
    const csrf = await (await ac.request.get('/api/auth/csrf')).json()
    const itemId = crypto.randomUUID(),
      wishId = crypto.randomUUID(),
      packingId = crypto.randomUUID(),
      pollId = crypto.randomUUID(),
      optionId = crypto.randomUUID()
    const seeds = [
      ['itinerary_item', itemId, { title: '共同计划', date: '2026-12-01' }],
      ['wish_item', wishId, { title: '离线心愿' }],
      [
        'packing_item',
        packingId,
        { name: '充电器', scope: 'personal', category: '电子' },
      ],
      ['poll', pollId, { question: '旅途晚餐', multiChoice: false }],
      ['poll_option', optionId, { pollId, text: '拉面', sortOrder: 'a0' }],
      [
        'poll_option',
        crypto.randomUUID(),
        { pollId, text: '寿司', sortOrder: 'a1' },
      ],
      [
        'exchange',
        crypto.randomUUID(),
        {
          ownerUserId: aid,
          currency: 'JPY',
          cnyPaid: 10000,
          foreignReceived: 2000,
          date: '2026-12-01',
        },
      ],
    ] as const
    const response = await ac.request.post(`/api/trips/${tripId}/ops`, {
      headers: { 'X-CSRF-Token': csrf.token },
      data: {
        ops: seeds.map(([entity, entityId, fields]) => ({
          opId: crypto.randomUUID(),
          tripId,
          actorUserId: aid,
          schemaVersion: 1,
          entity,
          entityId,
          kind: 'create',
          fields,
          baseSeq: {},
          clientTime: new Date().toISOString(),
        })),
      },
    })
    expect(response.ok()).toBe(true)
    expect(
      (await response.json()).results.every(
        (r: { status: string }) => r.status === 'accepted',
      ),
    ).toBe(true)
    // 在断网前加载所有路由，保证后续跳转来自本地 PWA 外壳。
    for (const p of [a, b])
      for (const route of [
        '',
        '/wishes',
        '/ledger',
        '/packing',
        '/documents',
        `/polls/${pollId}`,
      ]) {
        await p.goto(path + route)
        await expect(
          p.locator('main').getByRole('heading').first(),
        ).toBeVisible()
        await synced(p)
      }
    await expect(
      b.getByRole('radio', { name: '拉面', exact: true }),
    ).toBeVisible()
    await Promise.all([ac.setOffline(true), bc.setOffline(true)])
    for (const [p, title] of [
      [a, 'A 的共同计划'],
      [b, 'B 的共同计划'],
    ] as const) {
      await p.goto(path)
      await p
        .getByRole('button')
        .filter({ hasText: '共同计划' })
        .first()
        .click()
      await p.getByLabel('标题', { exact: true }).fill(title)
      await p.getByRole('button', { name: '保存条目' }).click()
      await expect(p.getByRole('dialog')).toHaveCount(0)
      await p.goto(path + '/packing')
      await p.getByRole('checkbox', { name: '充电器', exact: true }).click()
      await expect(
        p.getByRole('checkbox', { name: '充电器', exact: true }),
      ).toBeChecked()
      await p.goto(path + `/polls/${pollId}`)
      await p.getByRole('radio', { name: '拉面', exact: true }).click()
      await expect(
        p.getByRole('radio', { name: '拉面', exact: true }),
      ).toBeChecked()
      await p.goto(path + '/documents')
      const chooser = p.waitForEvent('filechooser')
      await p.getByRole('button', { name: '上传凭证', exact: true }).click()
      await (
        await chooser
      ).setFiles(fileURLToPath(new URL('fixtures/ticket.png', import.meta.url)))
      await p.getByLabel('标题', { exact: true }).fill(title + '凭证')
      await p.getByRole('button', { name: '保存凭证' }).click()
      await expect(p.getByRole('dialog')).toHaveCount(0)
    }
    await a.goto(path + '/wishes')
    await a.getByRole('button', { name: '安排到…', exact: true }).click()
    await a.getByRole('button', { name: /第 2 天/ }).click()
    await expect(a.getByRole('dialog')).toHaveCount(0)
    for (const [p, kind] of [
      [a, '现金'],
      [b, '刷卡'],
    ] as const) {
      await p.goto(path + '/ledger')
      await p.getByRole('button', { name: '新增账目' }).click()
      await p
        .getByRole('dialog')
        .last()
        .getByRole('button', { name: '币种', exact: true })
        .click()
      await p.getByLabel('搜索币种').fill('JPY')
      await p.locator('[cmdk-item]').filter({ hasText: /^JPY$/ }).click()
      await p.getByRole('button', { name: kind, exact: true }).click()
      await p.getByLabel('金额', { exact: true }).fill('100')
      await p.getByLabel('标题', { exact: true }).fill(kind + '支出')
      await p.getByLabel('日期', { exact: true }).fill('2026-12-01')
      await p.getByLabel('时间', { exact: true }).fill('12:00')
      if (kind === '刷卡')
        await p.getByLabel('首次使用 JPY，请填写默认汇率').fill('0.05')
      await p.getByRole('button', { name: '保存账目' }).click()
      await expect(p.getByRole('dialog')).toHaveCount(0)
    }
    await ac.setOffline(false)
    await synced(a)
    await a.goto(path + `/polls/${pollId}`)
    await a.getByRole('button', { name: '旅途晚餐操作', exact: true }).click()
    await a
      .getByRole('button', { name: '关闭投票', exact: true })
      .or(a.getByRole('menuitem', { name: '关闭投票', exact: true }))
      .click()
    await expect(a.getByText('已截止，不能继续投票')).toBeVisible()
    await bc.setOffline(false)
    await expect(b.getByRole('status', { name: /^同步状态/ })).toContainText(
      '未生效',
    )
    await b.getByRole('status', { name: /^同步状态/ }).click()
    await expect(b.getByRole('alert')).toContainText('投票已截止')
    await b.getByRole('button', { name: '丢弃', exact: true }).click()
    await close(b)
    for (const p of [a, b]) {
      await p.goto(path + `/polls/${pollId}`)
      await expect(p.getByText('1 人已投票 · 实名可见')).toBeVisible()
      await expect(
        p.getByRole('radio', { name: '拉面', exact: true }),
      ).toBeDisabled()
      if (p === b)
        await expect(
          p.getByRole('radio', { name: '拉面', exact: true }),
        ).not.toBeChecked()
      await p.goto(path)
      await expect(
        p.getByRole('button').filter({ hasText: 'B 的共同计划' }).first(),
      ).toBeVisible()
      await p.getByRole('button', { name: '行程提示' }).click()
      await expect(p.getByRole('dialog')).toContainText('覆盖')
      await close(p)
      await p.goto(path + '/documents')
      await expect(p.getByTestId('voucher-card')).toHaveCount(2)
      await p.goto(path + '/ledger')
      await expect(p.getByTestId('expense-card')).toHaveCount(2)
      for (const card of await p.getByTestId('expense-card').all())
        await expect(card).toContainText('¥5.00')
      await p.getByRole('button', { name: '筛选', exact: true }).click()
      await p.getByLabel('方式', { exact: true }).selectOption('cash')
      await close(p)
      await expect(p.getByTestId('expense-card')).toHaveCount(1)
      await p
        .getByRole('button', { name: '清除筛选 现金', exact: true })
        .click()
      await expect(p.getByTestId('expense-card')).toHaveCount(2)
      await p.getByRole('button', { name: '结算', exact: true }).click()
    }
    await expect
      .poll(() => b.getByTestId('settlement-member').allTextContents())
      .toEqual(await a.getByTestId('settlement-member').allTextContents())
    const local = (p: Page, uid: string) =>
      p.evaluate(
        async ({ uid, tripId }) => {
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const r = indexedDB.open(`waypoint-u-${uid}`)
            r.onsuccess = () => resolve(r.result)
            r.onerror = () => reject(r.error)
          })
          const rows = await new Promise<
            Array<{ tripId: string; entityId: string; view: unknown }>
          >((resolve, reject) => {
            const r = db
              .transaction('entities')
              .objectStore('entities')
              .getAll()
            r.onsuccess = () => resolve(r.result)
            r.onerror = () => reject(r.error)
          })
          db.close()
          return rows
            .filter((r) => r.tripId === tripId)
            .sort((a, b) => a.entityId.localeCompare(b.entityId))
            .map((r) => r.view)
        },
        { uid, tripId },
      )
    await expect.poll(() => local(b, bid)).toEqual(await local(a, aid))
  } finally {
    await ac.setOffline(false)
    await bc.setOffline(false)
    await ac.close()
    await bc.close()
  }
})
