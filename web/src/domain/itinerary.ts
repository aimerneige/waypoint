import { generateKeyBetween } from 'fractional-indexing'
import { formatDate, zoneAbbreviation } from './format'
import type { State } from './ops'
export type ItineraryFields = {
  title: string
  date: string
  startTime?: string | null
  endTime?: string | null
  timezone?: string | null
  endTimezone?: string | null
  endDate?: string | null
  place?: string | null
  bookingInfo?: string | null
  voucherIds?: string[] | null
  wishItemId?: string | null
  sortOrder?: string | null
}
export type WishFields = {
  title: string
  note?: string | null
  url?: string | null
  place?: string | null
}
export function sortKey(item: State) {
  if (item.fields.sortOrder) return String(item.fields.sortOrder)
  let n = item.createdSeq,
    digits = ''
  const alphabet =
    '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
  do {
    digits = alphabet[n % 62] + digits
    n = Math.floor(n / 62)
  } while (n > 0)
  return 'k' + digits.padStart(11, '0')
}
export function compareItems(a: State, b: State) {
  const at = String(a.fields.startTime ?? ''),
    bt = String(b.fields.startTime ?? '')
  const ak = sortKey(a),
    bk = sortKey(b)
  return (
    (at < bt ? -1 : at > bt ? 1 : 0) ||
    (ak < bk ? -1 : ak > bk ? 1 : 0) ||
    (a.createdSeq || Number.MAX_SAFE_INTEGER) -
      (b.createdSeq || Number.MAX_SAFE_INTEGER)
  )
}
export function insertionKey(before?: string | null, after?: string | null) {
  return generateKeyBetween(before || null, after || null)
}
export function scheduledItems(wishId: string, items: State[]) {
  return items
    .filter((i) => !i.deleted && i.fields.wishItemId === wishId)
    .sort(
      (a, b) =>
        String(a.fields.date).localeCompare(String(b.fields.date)) ||
        compareItems(a, b),
    )
}
export function timeLabel(fields: State['fields'], defaultZone: string) {
  if (!fields.startTime) return '未定时间'
  const date = String(fields.date),
    start = String(fields.startTime)
  const zone = String(fields.timezone || defaultZone),
    endZone = String(fields.endTimezone || zone)
  const suffix = (d: string, t: string, z: string) =>
    z !== defaultZone ? ` ${zoneAbbreviation(d, t, z)}` : ''
  let label = start + suffix(date, start, zone)
  if (fields.endTime) {
    const end = String(fields.endTime),
      endDate = String(fields.endDate || date)
    const next = new Date(`${date}T12:00:00Z`)
    next.setUTCDate(next.getUTCDate() + 1)
    const day =
      endDate > date
        ? endDate === next.toISOString().slice(0, 10)
          ? '次日 '
          : `${formatDate(endDate)} `
        : ''
    label += ` → ${day}${end}${suffix(endDate, end, endZone)}${endDate > date && endZone !== zone ? '（当地）' : ''}`
  }
  return label
}
