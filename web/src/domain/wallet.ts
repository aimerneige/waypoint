import {
  add,
  decimalText,
  divide,
  fraction,
  multiply,
  round,
  type Decimal,
} from './decimal'
import { minorDigits } from './money'
import type { Exchange, Expense, Valuation } from './ledger-types'

export function wallet(
  ownerUserId: string,
  currency: string,
  exchanges: Exchange[],
  expenses: Expense[],
) {
  let balance = 0n,
    cost = fraction(0n),
    average: Decimal | null = null
  const valuations: Record<string, Valuation> = {}
  const events = [
    ...exchanges
      .filter((e) => e.ownerUserId === ownerUserId && e.currency === currency)
      .map((e) => ({ ...e, kind: 'exchange' as const })),
    ...expenses
      .filter(
        (e) =>
          e.payerUserId === ownerUserId &&
          e.currency === currency &&
          e.method === 'cash',
      )
      .map((e) => ({ ...e, kind: 'expense' as const })),
  ].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.time || '00:00').localeCompare(b.time || '00:00') ||
      a.createdSeq - b.createdSeq ||
      a.id.localeCompare(b.id),
  )
  for (const e of events) {
    if (e.kind === 'exchange') {
      balance += BigInt(e.foreignReceived)
      cost = add(cost, fraction(BigInt(e.cnyPaid)))
      if (balance > 0n) average = divide(cost, fraction(balance))
    } else {
      const amount = BigInt(e.amount),
        insufficient = balance < amount
      if (balance > 0n) average = divide(cost, fraction(balance))
      const spent = average ? multiply(fraction(amount), average) : null
      valuations[e.id] = {
        amountCny: spent ? round(spent) : null,
        rate: average
          ? decimalText(
              multiply(
                average,
                fraction(10n ** BigInt(minorDigits(currency)), 100n),
              ),
            )
          : null,
        status: average ? '钱包成本' : '缺少汇率',
        insufficient,
      }
      if (spent) cost = add(cost, fraction(-spent.n, spent.d))
      balance -= amount
    }
  }
  return {
    ownerUserId,
    currency,
    balance,
    cost,
    averageRate: average
      ? decimalText(
          multiply(
            average,
            fraction(10n ** BigInt(minorDigits(currency)), 100n),
          ),
        )
      : null,
    valuations,
  }
}
