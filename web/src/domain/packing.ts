import { generateKeyBetween } from 'fractional-indexing'
import type { State } from './ops'
import { todayInZone } from './format'
export type PackingTemplateItem = {
  name: string
  category: string
  scope: 'personal' | 'shared'
}
export type TemplateSelection = PackingTemplateItem & {
  assigneeUserId?: string
}
export function comparePackingItems(a: State, b: State) {
  const ak = String(a.fields.sortOrder ?? ''),
    bk = String(b.fields.sortOrder ?? '')
  return (ak < bk ? -1 : ak > bk ? 1 : 0) || a.createdSeq - b.createdSeq
}
export function templateFields(items: TemplateSelection[], userId: string) {
  let previous: string | null = null
  return items.map((item) => {
    previous = generateKeyBetween(previous, null)
    return {
      name: item.name,
      category: item.category,
      scope: item.scope,
      sortOrder: previous,
      ...(item.scope === 'shared'
        ? { assigneeUserId: item.assigneeUserId || userId }
        : {}),
    }
  })
}
export function personalItems(items: State[], userId: string) {
  return items.filter(
    (i) =>
      !i.deleted &&
      i.fields.scope === 'personal' &&
      (!i.fields.ownerUserId || i.fields.ownerUserId === userId),
  )
}
export function departureReminder(
  trip: { startDate: string; timezone: string },
  items: State[],
  userId: string,
  now = new Date(),
) {
  const today = todayInZone(trip.timezone, now)
  const days = (Date.parse(trip.startDate) - Date.parse(today)) / 86400000
  if (days < 0 || days > 3) return null
  const personal = personalItems(items, userId).filter(
    (i) => !i.fields[`checked.${userId}`],
  ).length
  const shared = items.filter(
    (i) =>
      !i.deleted &&
      i.fields.scope === 'shared' &&
      i.fields.assigneeUserId === userId &&
      !i.fields.packed,
  ).length
  return personal || shared ? { today, personal, shared } : null
}
