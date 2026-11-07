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
    useSyncStatus.setState({
      state: 'synced',
      pending: 0,
      rejected: 0,
      upgrade: false,
    })
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
    const dirty = new Set<string>()
    const write = (event: Event) => {
      dirty.add((event as CustomEvent<{ tripId: string }>).detail.tripId)
      clearTimeout(debounce)
      debounce = setTimeout(() => {
        if (navigator.onLine) for (const id of dirty) void engine.sync(id)
        dirty.clear()
      }, 300)
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
            toast.error(
              notice.message ?? '有新的行程提示',
              notice.type
                ? {
                    action: {
                      label: '查看',
                      onClick: () => {
                        window.location.href = `/trips/${notice.tripId}?notices=1`
                      },
                    },
                  }
                : undefined,
            )
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
  if (!engine) return () => {}
  let events: EventSource | undefined
  let terminal = false
  const close = () => {
    events?.close()
    events = undefined
  }
  const connect = () => {
    if (!navigator.onLine || document.visibilityState === 'hidden') {
      close()
      return
    }
    if (events || terminal || engine.stopped) return
    events = new EventSource(`/api/trips/${id}/events`)
    const source = events
    void engine.sync(id)
    source.addEventListener('error', () => {
      if (source.readyState === EventSource.CLOSED) {
        terminal = true
        close()
        void engine.sync(id)
      }
    })
    source.addEventListener('seq', (event) => {
      const seq = JSON.parse((event as MessageEvent).data).latestSeq
      void engine.db.trips.get(id).then((trip) => {
        if (seq > (trip?.lastSeq ?? 0)) void engine.sync(id)
      })
    })
    for (const [event, access] of [
      ['revoked', 'revoked'],
      ['trip_deleted', 'deleted'],
    ] as const)
      source.addEventListener(event, () => {
        terminal = true
        close()
        void engine.revoke(id, access)
      })
    source.addEventListener('unauthorized', () => {
      terminal = true
      close()
      useSession.setState({ status: 'expired' })
    })
  }
  window.addEventListener('online', connect)
  window.addEventListener('offline', connect)
  document.addEventListener('visibilitychange', connect)
  connect()
  return () => {
    close()
    window.removeEventListener('online', connect)
    window.removeEventListener('offline', connect)
    document.removeEventListener('visibilitychange', connect)
  }
}
