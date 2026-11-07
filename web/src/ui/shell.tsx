import { create } from 'zustand'
import { Link, NavLink, Outlet, useParams } from 'react-router'
import { useEffect, useState } from 'react'
import { RejectedChanges } from '@/features/itinerary'
import { PackingReminder } from '@/features/packing-reminder'
import { ResponsiveOverlay } from './responsive-overlay'
import { useLiveQuery } from 'dexie-react-hooks'
import { database } from '@/data/db'
import { subscribeTrip } from '@/sync-runtime'
import {
  Map,
  Wallet,
  ListChecks,
  Ellipsis,
  Compass,
  Plus,
  CloudCheck,
} from 'lucide-react'
import { Button } from './components/button'
import { useOnline } from './hooks'
import { useSession } from '@/platform/session'
export const useSyncStatus = create<{
  state: 'synced' | 'syncing' | 'pending'
  pending: number
  rejected: number
  upgrade: boolean
}>(() => ({ state: 'synced', pending: 0, rejected: 0, upgrade: false }))
export function SyncStatus() {
  const [open, setOpen] = useState(false)
  const online = useOnline()
  const { state, pending, rejected, upgrade } = useSyncStatus()
  const expired = useSession((s) => s.status === 'expired')
  const text = upgrade
    ? '需要更新应用'
    : expired
      ? '登录已失效'
      : !online
        ? `离线（${pending} 条待同步）`
        : rejected > 0 || state === 'pending'
          ? '有修改未生效'
          : state === 'syncing' || pending > 0
            ? '同步中'
            : '已同步'
  const short = !online
    ? `离线·${pending}`
    : rejected > 0 || state === 'pending'
      ? `未生效·${rejected}`
      : text
  return (
    <>
      <button
        type="button"
        role="status"
        aria-label={`同步状态：${text}`}
        title={text}
        className="row muted sync-status"
        onClick={() => {
          setOpen(true)
        }}
      >
        <CloudCheck size={16} />
        <span aria-label={text}>{short}</span>
      </button>
      <ResponsiveOverlay
        open={open}
        onOpenChange={setOpen}
        title="未生效的修改"
      >
        <p>{text}</p>
        <RejectedChanges />
      </ResponsiveOverlay>
    </>
  )
}
export function AppShell() {
  const user = useSession((s) => s.currentUser)
  return (
    <>
      <Link className="row desktop-brand" to="/">
        <Compass />
        Waypoint
      </Link>
      <div className="app-content">
        <header
          className="page row app-header"
          style={{ justifyContent: 'space-between' }}
        >
          <Link className="row mobile-brand" to="/">
            <Compass />
            Waypoint
          </Link>
          <SyncStatus />
          <Link to="/account" aria-label="账户" className="account-avatar">
            {user?.nickname?.slice(0, 1) || '我'}
          </Link>
        </header>
        <Outlet />
      </div>
    </>
  )
}
export function TripLayout() {
  const { tripId = '' } = useParams()
  const user = useSession((s) => s.currentUser)!
  const status = useSession((s) => s.status)
  const trip = useLiveQuery(
    () => database(user.id).trips.get(tripId),
    [user.id, tripId],
  )
  useEffect(() => subscribeTrip(tripId), [tripId, status])
  return (
    <>
      <nav aria-label="行程导航" className="trip-nav">
        {[
          ['', '行程', Map],
          ['ledger', '账本', Wallet],
          ['packing', '清单', ListChecks],
          ['more', '更多', Ellipsis],
        ].map(([path, label, Icon]) => {
          const Glyph = Icon as typeof Map
          return (
            <NavLink key={String(path)} to={String(path) || '.'} end>
              <Glyph size={22} />
              {String(label)}
            </NavLink>
          )
        })}
      </nav>
      <div className="trip-content">
        {trip?.access === 'ok' && <PackingReminder trip={trip} />}
        <div className="page row">
          <Link to="/">我的行程</Link>
          <strong>{trip?.name}</strong>
        </div>
        {trip && trip.access !== 'ok' ? (
          <main className="page">
            该行程已无法访问 <Link to="/">返回我的行程</Link>
          </main>
        ) : (
          <Outlet />
        )}
      </div>
    </>
  )
}
export function Fab(props: React.ComponentProps<typeof Button>) {
  return (
    <Button
      {...props}
      className="fab"
      aria-label={props['aria-label'] ?? '新增'}
    >
      {props.children ?? <Plus />}
    </Button>
  )
}
