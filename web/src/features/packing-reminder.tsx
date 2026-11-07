import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { type Trip, database } from '@/data/db'
import { useSession } from '@/platform/session'
import { notify, useNotifications } from '@/platform/notify'
import { departureReminder } from '@/domain/packing'
import { Button } from '@/ui/components/button'
export function PackingReminder({ trip }: { trip: Trip }) {
  const user = useSession((s) => s.currentUser)!,
    db = database(user.id)
  const items = useLiveQuery(
    () =>
      db.entities
        .where('[tripId+entity]')
        .equals([trip.id, 'packing_item'])
        .toArray(),
    [db, trip.id],
    [],
  )
  const [dismissed, setDismissed] = useState('')
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(timer)
  }, [])
  const reminder = departureReminder(
    trip,
    items.flatMap((i) => (i.view ? [i.view] : [])),
    user.id,
    now,
  )
  const key = `packing:${user.id}:${trip.id}`
  const today = reminder?.today ?? ''
  const hidden = dismissed === today || localStorage.getItem(key) === today
  const message =
    reminder && !hidden
      ? `你还有 ${reminder.shared} 件公共物品未装；你还有 ${reminder.personal} 件个人物品未勾选`
      : ''
  const displayed = useNotifications((s) => s.messages[key])
  useEffect(() => {
    if (message) void notify.schedule(message, new Date(), key)
    else notify.remove(key)
    return () => notify.remove(key)
  }, [message, key])
  if (!message || !displayed) return null
  return (
    <div className="banner" role="status">
      <span>
        {trip.name} · {displayed}
      </span>
      <Button
        variant="outline"
        onClick={() => {
          localStorage.setItem(key, today)
          setDismissed(today)
        }}
      >
        今天不再提示
      </Button>
    </div>
  )
}
