import { describe, expect, it } from 'vitest'
import { convert } from './decimal'
import { formatMoney, minorDigits, parseMoney } from './money'
import { splitEqual } from './split'
import { netBalances, settle } from './settlement'
import { wallet } from './wallet'
import { valueExpense } from './expense'
import type { Exchange, Expense } from './ledger-types'

const expense = (patch: Partial<Expense> = {}): Expense => ({
  id: 'e',
  createdSeq: 3,
  title: '餐费',
  date: '2026-11-10',
  amount: 100,
  currency: 'JPY',
  method: 'card',
  payerUserId: 'a',
  rateSource: 'default',
  split: { mode: 'equal', members: ['b', 'a', 'c'] },
  ...patch,
})
const exchange = (patch: Partial<Exchange> = {}): Exchange => ({
  id: 'x',
  createdSeq: 1,
  ownerUserId: 'a',
  currency: 'JPY',
  cnyPaid: 500,
  foreignReceived: 100,
  date: '2026-11-10',
  ...patch,
})
describe('金额、汇率与分摊', () => {
  it('ISO 精度、解析、格式化与 half up', () => {
    for (const [currency, digits] of Object.entries({
      JPY: 0,
      KRW: 0,
      USD: 2,
      EUR: 2,
      CNY: 2,
      KWD: 3,
      TWD: 2,
    }))
      expect(minorDigits(currency)).toBe(digits)
    expect(parseMoney('1,234.5', 'USD')).toBe(123450n)
    expect(() => parseMoney('1.1', 'JPY')).toThrow()
    expect(() => parseMoney('12,34', 'USD')).toThrow()
    expect(formatMoney(123450n)).toBe('¥1,234.50')
    expect(formatMoney(1234n, 'JPY')).toBe('JPY 1,234')
    expect(convert(1n, '0.005', 0)).toBe(1n)
    expect(convert(1234n, '7.1234567891', 3)).toBe(879n)
  })
  it('余数按字典序分配，精确守恒', () => {
    expect(splitEqual(100n, ['c', 'a', 'b'])).toEqual({
      a: 34n,
      b: 33n,
      c: 33n,
    })
    for (let amount = 0n; amount < 1000n; amount++)
      expect(
        Object.values(splitEqual(amount, ['z', 'x', 'y'])).reduce(
          (a, b) => a + b,
          0n,
        ),
      ).toBe(amount)
  })
  it('修改默认汇率仅影响 default 来源，CNY 固定 1', () => {
    const e = expense()
    expect(valueExpense(e, { JPY: '0.05' }).amountCny).toBe(500n)
    expect(valueExpense(e, { JPY: '0.06' }).amountCny).toBe(600n)
    for (const rates of [{ JPY: '0.05' }, { JPY: '0.06' }]) {
      expect(
        valueExpense({ ...e, rateSource: 'manual', rate: '0.04' }, rates)
          .amountCny,
      ).toBe(400n)
      expect(
        valueExpense({ ...e, rateSource: 'actual', amountCny: 420 }, rates)
          .amountCny,
      ).toBe(420n)
      expect(
        valueExpense({ ...e, rateSource: 'wallet' }, rates, {
          e: { amountCny: 430n, rate: '0.043', status: '钱包成本' },
        }).amountCny,
      ).toBe(430n)
      expect(valueExpense({ ...e, currency: 'CNY' }, rates).amountCny).toBe(
        100n,
      )
    }
    expect(valueExpense(e, {}).status).toBe('缺少汇率')
  })
})
describe('钱包加权成本', () => {
  it('多次换汇、穿插支出、透支与补记后重算', () => {
    const expenses = [
      expense({
        id: 'a',
        method: 'cash',
        rateSource: 'wallet',
        amount: 50,
        createdSeq: 2,
      }),
      expense({
        id: 'b',
        method: 'cash',
        rateSource: 'wallet',
        amount: 100,
        createdSeq: 4,
      }),
      expense({
        id: 'c',
        method: 'cash',
        rateSource: 'wallet',
        amount: 100,
        createdSeq: 5,
      }),
    ]
    const exchanges = [
      exchange(),
      exchange({ id: 'y', createdSeq: 3, cnyPaid: 1000 }),
    ]
    const w = wallet('a', 'JPY', exchanges, expenses)
    expect(w.valuations.a.amountCny).toBe(250n)
    expect(w.valuations.b.amountCny).toBe(833n)
    expect(w.valuations.c.amountCny).toBe(833n)
    expect(w.valuations.c.insufficient).toBe(true)
    expect(w.balance).toBe(-50n)
    const updated = wallet(
      'a',
      'JPY',
      [
        ...exchanges,
        exchange({
          id: 'early',
          date: '2026-11-09',
          foreignReceived: 100,
          cnyPaid: 200,
        }),
      ],
      expenses,
    )
    expect(updated.valuations.a.amountCny).toBe(175n)
    expect(updated.balance).toBe(50n)
    expect(wallet('a', 'JPY', [], expenses).valuations.a.status).toBe(
      '缺少汇率',
    )
  })
  it('按日期、空时间、序号排序，与输入顺序无关', () => {
    const ex = [
        exchange({ time: '09:00' }),
        exchange({ id: 'y', time: '11:00', cnyPaid: 1000 }),
      ],
      e = expense({
        method: 'cash',
        rateSource: 'wallet',
        time: '10:00',
        amount: 50,
      })
    expect(wallet('a', 'JPY', ex, [e]).valuations.e.amountCny).toBe(250n)
    expect(wallet('a', 'JPY', [...ex].reverse(), [e])).toEqual(
      wallet('a', 'JPY', ex, [e]),
    )
  })
})
// 独立暴力搜索：每步消去首位债务，枚举其所有相反符号的配对。
function brute(input: bigint[]): number {
  const a = input.filter((n) => n !== 0n)
  if (!a.length) return 0
  let best = Infinity
  for (let j = 1; j < a.length; j++)
    if (a[0] * a[j] < 0n) {
      const next = a.slice(1)
      next[j - 1] += a[0]
      best = Math.min(best, 1 + brute(next))
    }
  return best
}
describe('最少转账', () => {
  it('数百个固定随机样本与暴力最优解一致，转账守恒且确定', () => {
    let seed = 42
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed
    }
    for (let sample = 0; sample < 400; sample++) {
      const n = 2 + (random() % 7),
        a = Array.from({ length: n - 1 }, () =>
          BigInt(Number(random() % 21) - 10),
        )
      a.push(-a.reduce((x, y) => x + y, 0n))
      const net = Object.fromEntries(a.map((v, i) => [String(i), v])),
        result = settle(net)
      expect(result.transfers.length).toBe(brute(a))
      expect(settle(Object.fromEntries(Object.entries(net).reverse()))).toEqual(
        result,
      )
      const remaining = { ...net }
      for (const t of result.transfers) {
        remaining[t.fromUserId] += t.amountCny
        remaining[t.toUserId] -= t.amountCny
      }
      expect(Object.values(remaining).every((n) => n === 0n)).toBe(true)
    }
  })
  it('20 人在 1 秒内完成；超过 20 人降级', () => {
    const net = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [
        String(i),
        BigInt(i < 10 ? i + 1 : -(i - 9)),
      ]),
    )
    const start = performance.now(),
      result = settle(net)
    expect(performance.now() - start).toBeLessThan(1000)
    expect(result.exact).toBe(true)
    expect(result.transfers).toHaveLength(10)
    expect(settle({ ...net, x: 1n, y: -1n }).exact).toBe(false)
  })
  it('净额含转账，缺少汇率排除计数', () => {
    const a = expense({ currency: 'CNY', amount: 100 }),
      b = expense({ id: 'missing' })
    const values = { e: valueExpense(a, {}), missing: valueExpense(b, {}) }
    expect(
      netBalances(
        [a, b],
        values,
        [
          {
            id: 't',
            fromUserId: 'b',
            toUserId: 'a',
            amountCny: 10,
            date: a.date,
          },
        ],
        ['a', 'b', 'c'],
      ),
    ).toEqual({ net: { a: 56n, b: -23n, c: -33n }, missing: 1 })
  })
})
