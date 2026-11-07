import { useEffect, useState } from 'react'
import {
  createBrowserRouter,
  Navigate,
  Outlet,
  useLocation,
  Link,
} from 'react-router'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { bootstrapSession, useSession } from './platform/session'
import { AppShell, TripLayout, useSyncStatus } from './ui/shell'
import { overlayHistory } from './ui/overlay-history'
import { Toaster, toast } from './ui/components/sonner'
import { Button } from './ui/components/button'
import { applyTheme } from './ui/theme/tokens'
import { AuthPage, VerifyEmail } from './features/auth'
import { Account } from './features/account'
import { MyTrips, TripPlaceholder, JoinTrip } from './features/trips'
import { Members, TripSettings } from './features/trip-management'
import { startSync } from './sync-runtime'
import { Itinerary, TripHistory } from './features/itinerary'
import { Wishlist } from './features/wishlist'
import { Ledger } from './features/ledger'
import { Packing } from './features/packing'
import { Polls } from './features/polls'
function Root() {
  const status = useSession((s) => s.status)
  const upgrade = useSyncStatus((s) => s.upgrade)
  const location = useLocation()
  const [showInstall, setShowInstall] = useState(
    () =>
      /iPad|iPhone|iPod/.test(navigator.userAgent) &&
      /Safari/.test(navigator.userAgent) &&
      !/CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent) &&
      !matchMedia('(display-mode: standalone)').matches &&
      !('standalone' in navigator && navigator.standalone) &&
      !localStorage.getItem('wp:installDismissed'),
  )
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()
  useEffect(() => {
    const stopSync = startSync()
    void bootstrapSession()
    const media = matchMedia('(prefers-color-scheme: dark)')
    const change = () => {
      if ((localStorage.getItem('wp:theme') ?? 'system') === 'system')
        applyTheme('system')
    }
    media.addEventListener('change', change)
    return () => {
      stopSync()
      media.removeEventListener('change', change)
    }
  }, [])
  useEffect(() => {
    overlayHistory?.clearForRoute()
  }, [location.key])
  return (
    <>
      {status === 'expired' && (
        <div role="alert" className="banner">
          登录已失效，重新登录后继续同步{' '}
          <Link to={`/login?next=${encodeURIComponent(location.pathname)}`}>
            重新登录
          </Link>
        </div>
      )}
      {showInstall && (
        <div className="banner">
          在 Safari 分享菜单中选择“添加到主屏幕”，方便离线使用。
          <Button
            variant="outline"
            onClick={() => {
              localStorage.setItem('wp:installDismissed', '1')
              setShowInstall(false)
            }}
          >
            知道了
          </Button>
        </div>
      )}
      {(needRefresh || upgrade) && (
        <div className="banner">
          <Button
            onClick={async () => {
              try {
                const registration =
                  await navigator.serviceWorker?.getRegistration()
                await registration?.update()
                await updateServiceWorker(true)
                if (!registration?.waiting) window.location.reload()
              } catch (error) {
                toast.error(String(error))
              }
            }}
          >
            {upgrade ? '应用版本过旧，请刷新更新' : '有更新，点击刷新'}
          </Button>
        </div>
      )}
      <Outlet />
      <Toaster />
    </>
  )
}
function Protected() {
  const { currentUser, status } = useSession()
  const location = useLocation()
  if (currentUser) return <Outlet />
  if (status === 'unknown')
    return (
      <main className="page" role="status">
        正在打开 Waypoint…
      </main>
    )
  return (
    <Navigate
      to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`}
      replace
    />
  )
}
export const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      ...(
        ['login', 'register', 'forgot-password', 'reset-password'] as const
      ).map((kind) => ({
        path: `/${kind}`,
        element: <AuthPage key={kind} kind={kind} />,
      })),
      { path: '/verify-email', element: <VerifyEmail /> },
      { path: '/join/:token', element: <JoinTrip /> },
      {
        element: <Protected />,
        children: [
          {
            element: <AppShell />,
            children: [
              { path: '/', element: <MyTrips /> },
              { path: '/account', element: <Account /> },
              {
                path: '/trips/:tripId',
                element: <TripLayout />,
                children: [
                  { index: true, element: <Itinerary /> },
                  { path: 'wishes', element: <Wishlist /> },
                  { path: 'history', element: <TripHistory /> },
                  { path: 'ledger', element: <Ledger /> },
                  {
                    path: 'packing',
                    element: <Packing />,
                  },
                  { path: 'more', element: <TripPlaceholder title="更多" /> },
                  { path: 'members', element: <Members /> },
                  { path: 'settings', element: <TripSettings /> },
                  { path: 'polls', element: <Polls /> },
                  { path: 'polls/:pollId', element: <Polls /> },
                  ...([['documents', '凭证']] as const).map(
                    ([path, title]) => ({
                      path,
                      element: <TripPlaceholder title={title} />,
                    }),
                  ),
                ],
              },
            ],
          },
        ],
      },
      {
        path: '*',
        element: (
          <main className="page">
            <h1>页面不存在</h1>
            <Link to="/">返回首页</Link>
          </main>
        ),
      },
    ],
  },
])
