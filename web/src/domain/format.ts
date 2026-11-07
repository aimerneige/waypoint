export function formatDate(date: string, now = new Date()) {
  const d = new Date(`${date}T12:00:00Z`)
  return new Intl.DateTimeFormat('zh-CN', {
    year: d.getUTCFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(d)
}
export function todayInZone(zone: string, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}
export function validTimezone(zone: string) {
  if (!zone || zone === 'Local') return false
  try {
    new Intl.DateTimeFormat('zh-CN', { timeZone: zone })
    return true
  } catch {
    return false
  }
}
export function formatDateTime(date: string, now = new Date()) {
  const d = new Date(date)
  return new Intl.DateTimeFormat('zh-CN', {
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)
}
export function dayLabel(date: string, index: number) {
  const weekday = new Intl.DateTimeFormat('zh-CN', {
    weekday: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`))
  return `第 ${index + 1} 天 · ${formatDate(date)} ${weekday}`
}
export function tripDays(start: string, end: string) {
  const days: string[] = []
  for (
    const d = new Date(`${start}T12:00:00Z`);
    d.toISOString().slice(0, 10) <= end;
    d.setUTCDate(d.getUTCDate() + 1)
  )
    days.push(d.toISOString().slice(0, 10))
  return days
}
export function zoneAbbreviation(date: string, time: string, zone: string) {
  const instant = new Date(`${date}T${time}:00Z`)
  // 迭代当地时间偏移，避免用浏览器所在时区解释航班时间。
  let adjusted = instant
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(adjusted)
    const p = Object.fromEntries(parts.map((p) => [p.type, p.value]))
    const local = new Date(
      `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`,
    )
    adjusted = new Date(
      adjusted.getTime() + instant.getTime() - local.getTime(),
    )
  }
  const short = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    timeZoneName: 'short',
  })
    .formatToParts(adjusted)
    .find((p) => p.type === 'timeZoneName')!.value
  return (
    (
      {
        'Asia/Tokyo': 'JST',
        'Europe/Paris': short === 'GMT+2' ? 'CEST' : 'CET',
        'Europe/Berlin': short === 'GMT+2' ? 'CEST' : 'CET',
      } as Record<string, string>
    )[zone] ?? short
  )
}
