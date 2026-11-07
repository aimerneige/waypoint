import { liveQuery } from 'dexie'
import { database, localWrites } from '@/data/db'
import { useSession } from '@/platform/session'
import { useSyncStatus } from '@/ui/shell'
import { toast } from '@/ui/components/sonner'
import { SyncEngine } from './sync/engine'
let active: SyncEngine | undefined
let cleanup: (() => void) | undefined
export function currentEngine() {
  return active
}
export function startSync() {
  const update = () => {
    cleanup?.()
    cleanup = undefined
    active = undefined
    const { currentUser, status } = useSession.getState()
    if (!currentUser || status !== 'authenticated') return
    const db = database(currentUser.id)
    const engine = new SyncEngine(
      db,
      undefined,
      (busy) =>
        useSyncStatus.setState({
          state: busy ? 'syncing' : 'synced',
          upgrade: engine.upgradeRequired,
        }),
      () => useSession.setState({ status: 'expired' }),
    )
    active = engine
    const refresh = () => {
      if (navigator.onLine && document.visibilityState !== 'hidden')
        void engine.discover()
    }
    let debounce: ReturnType<typeof setTimeout>
    const write = () => {
      clearTimeout(debounce)
      debounce = setTimeout(refresh, 300)
    }
    window.addEventListener('online', refresh)
    document.addEventListener('visibilitychange', refresh)
    localWrites.addEventListener('write', write)
    const interval = setInterval(refresh, 60000)
    const sub = liveQuery(async () => ({
      pending: await db.outbox.count(),
      rejected: await db.rejected.count(),
      notices: await db.notices.toArray(),
    })).subscribe({
      next: ({ pending, rejected, notices }) => {
        useSyncStatus.setState({ pending, rejected })
        for (const notice of notices)
          if (!notice.seen) {
            toast.error(notice.message)
            void db.notices.update(notice.id!, { seen: true })
          }
      },
      error: (error) => toast.error(String(error)),
    })
    refresh()
    cleanup = () => {
      engine.stop()
      clearInterval(interval)
      clearTimeout(debounce)
      sub.unsubscribe()
      window.removeEventListener('online', refresh)
      document.removeEventListener('visibilitychange', refresh)
      localWrites.removeEventListener('write', write)
    }
  }
  const unsubscribe = useSession.subscribe((next, prev) => {
    if (
      next.currentUser?.id !== prev.currentUser?.id ||
      next.status !== prev.status
    )
      update()
  })
  update()
  return () => {
    unsubscribe()
    cleanup?.()
  }
}
export function subscribeTrip(id: string) {
  const engine = active
  if (!engine || !navigator.onLine) return () => {}
  const events = new EventSource(`/api/trips/${id}/events`)
  events.addEventListener('seq', (event) => {
    const seq = JSON.parse((event as MessageEvent).data).latestSeq
    void engine.db.trips.get(id).then((trip) => {
      if (seq > (trip?.lastSeq ?? 0)) void engine.sync(id)
    })
  })
  for (const [event, access] of [
    ['revoked', 'revoked'],
    ['trip_deleted', 'deleted'],
  ] as const)
    events.addEventListener(event, () => {
      events.close()
      void engine.revoke(id, access)
    })
  events.addEventListener('unauthorized', () => {
    events.close()
    useSession.setState({ status: 'expired' })
  })
  return () => events.close()
}
