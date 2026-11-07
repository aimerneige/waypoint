import type { State } from './ops'
export function isPollClosed(poll: State, now = new Date()) {
  return (
    !!poll.fields.closedAt ||
    (!!poll.fields.deadline &&
      now.getTime() > Date.parse(String(poll.fields.deadline)))
  )
}
export function pollCounts(poll: State, options: State[]) {
  const active = options
    .filter((o) => !o.deleted && o.fields.pollId === poll.entityId)
    .sort((a, b) => {
      const ak = String(a.fields.sortOrder ?? ''),
        bk = String(b.fields.sortOrder ?? '')
      return (ak < bk ? -1 : ak > bk ? 1 : 0) || a.createdSeq - b.createdSeq
    })
  const voters = new Set<string>()
  const counts = active.map((option) => {
    const users = Object.entries(poll.fields)
      .filter(
        ([key, value]) =>
          key.startsWith('vote.') &&
          Array.isArray(value) &&
          value.includes(option.entityId),
      )
      .map(([key]) => key.slice(5))
    users.forEach((id) => voters.add(id))
    return { option, users, count: users.length }
  })
  return { counts, total: voters.size }
}
export function deadlineText(poll: State, now = new Date()) {
  if (isPollClosed(poll, now)) return '已截止'
  if (!poll.fields.deadline) return '未设置截止时间'
  const minutes = Math.ceil(
    (Date.parse(String(poll.fields.deadline)) - now.getTime()) / 60000,
  )
  return `${new Date(String(poll.fields.deadline)).toLocaleString('zh-CN')} · 还剩${minutes > 1440 ? `${Math.ceil(minutes / 1440)} 天` : minutes > 60 ? `${Math.ceil(minutes / 60)} 小时` : `${minutes} 分钟`}`
}
