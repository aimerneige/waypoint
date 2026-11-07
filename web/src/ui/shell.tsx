import { create } from 'zustand'
import { Link, NavLink, Outlet } from 'react-router'
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
}>(() => ({ state: 'synced', pending: 0 }))
export function SyncStatus() {
  const online = useOnline()
  const { state, pending } = useSyncStatus()
  const expired = useSession((s) => s.status === 'expired')
  const text =
    expired || state === 'pending'
      ? '有修改未生效'
      : !online
        ? `离线（${pending} 条待同步）`
        : state === 'syncing'
          ? '同步中'
          : '已同步'
  return (
    <span role="status" className="row muted">
      <CloudCheck size={16} />
      {text}
    </span>
  )
}
export function AppShell() {
  return (
    <>
      <header className="page row" style={{ justifyContent: 'space-between' }}>
        <Link className="row" to="/">
          <Compass />
          Waypoint
        </Link>
        <SyncStatus />
        <Link to="/account">账户</Link>
      </header>
      <Outlet />
    </>
  )
}
export function TripLayout() {
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
        <Outlet />
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
