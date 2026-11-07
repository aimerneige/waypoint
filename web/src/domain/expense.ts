import { convert, decimalText, fraction } from './decimal'
import { minorDigits } from './money'
import type { Expense, Rates, Valuation } from './ledger-types'
export function valueExpense(
  e: Expense,
  rates: Rates,
  cash: Record<string, Valuation> = {},
): Valuation {
  if (e.currency === 'CNY')
    return {
      amountCny: BigInt(e.amount),
      rate: '1',
      status: e.rateSource === 'actual' ? '已核实' : '手动',
    }
  if (e.rateSource === 'wallet')
    return cash[e.id] ?? { amountCny: null, rate: null, status: '缺少汇率' }
  if (e.rateSource === 'actual' && e.amountCny)
    return {
      amountCny: BigInt(e.amountCny),
      rate: decimalText(
        fraction(
          BigInt(e.amountCny) * 10n ** BigInt(minorDigits(e.currency)),
          BigInt(e.amount) * 100n,
        ),
      ),
      status: '已核实',
      insufficient: cash[e.id]?.insufficient,
    }
  const rate = e.rateSource === 'manual' ? e.rate : rates[e.currency]
  return rate
    ? {
        amountCny: convert(BigInt(e.amount), rate, minorDigits(e.currency)),
        rate,
        status: e.rateSource === 'manual' ? '手动' : '估算',
        insufficient: cash[e.id]?.insufficient,
      }
    : { amountCny: null, rate: null, status: '缺少汇率' }
}
