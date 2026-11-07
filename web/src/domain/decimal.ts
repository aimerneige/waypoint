export type Decimal = { n: bigint; d: bigint }
export const fraction = (n: bigint, d = 1n): Decimal => {
  if (d === 0n) throw new Error('除数不能为零')
  if (d < 0n) {
    n = -n
    d = -d
  }
  let a = n < 0n ? -n : n,
    b = d
  while (b) {
    const r = a % b
    a = b
    b = r
  }
  return { n: n / a, d: d / a }
}
export function decimal(value: string): Decimal {
  if (!/^\d{1,9}(\.\d{1,10})?$/.test(value)) throw new Error('汇率格式无效')
  const [whole, part = ''] = value.split('.')
  return fraction(BigInt(whole + part), 10n ** BigInt(part.length))
}
export const add = (a: Decimal, b: Decimal) =>
  fraction(a.n * b.d + b.n * a.d, a.d * b.d)
export const multiply = (a: Decimal, b: Decimal) =>
  fraction(a.n * b.n, a.d * b.d)
export const divide = (a: Decimal, b: Decimal) => fraction(a.n * b.d, a.d * b.n)
export function round(a: Decimal): bigint {
  const sign = a.n < 0n ? -1n : 1n,
    n = a.n * sign
  return sign * ((n * 2n + a.d) / (2n * a.d))
}
export function decimalText(a: Decimal, digits = 10) {
  const scale = 10n ** BigInt(digits),
    n = round(multiply(a, fraction(scale)))
  const sign = n < 0n ? '-' : '',
    text = (n < 0n ? -n : n).toString().padStart(digits + 1, '0')
  return (
    sign +
    text.slice(0, -digits) +
    ('.' + text.slice(-digits)).replace(/\.?0+$/, '')
  )
}
export function convert(amount: bigint, rate: string, minorDigits: number) {
  const r = decimal(rate)
  if (r.n <= 0n) throw new Error('汇率必须大于零')
  return round(multiply(fraction(amount * 100n, 10n ** BigInt(minorDigits)), r))
}
