// ISO 4217 精度优先；不采用部分地区现金显示时省略小数的惯例。
const digits: Record<string, number> = {
  JPY: 0,
  KRW: 0,
  TWD: 2,
  USD: 2,
  EUR: 2,
  CNY: 2,
  KWD: 3,
}
export function minorDigits(currency: string) {
  return (
    digits[currency] ??
    new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
    }).resolvedOptions().maximumFractionDigits!
  )
}
export function parseMoney(input: string, currency: string): bigint {
  const text = input.trim()
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text))
    throw new Error('金额格式无效')
  const [whole, part = ''] = text.replaceAll(',', '').split('.'),
    places = minorDigits(currency)
  if (part.length > places)
    throw new Error(`${currency} 最多支持 ${places} 位小数`)
  return BigInt(whole + part.padEnd(places, '0'))
}
export function moneyInput(amount: bigint, currency: string) {
  const places = minorDigits(currency),
    text = (amount < 0n ? -amount : amount).toString().padStart(places + 1, '0')
  return (
    (amount < 0n ? '-' : '') +
    (places ? text.slice(0, -places) + '.' + text.slice(-places) : text)
  )
}
export function formatMoney(amount: bigint, currency = 'CNY') {
  const [whole, part] = moneyInput(amount, currency).split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return (
    (currency === 'CNY' ? '¥' : `${currency} `) +
    grouped +
    (part === undefined ? '' : '.' + part)
  )
}
