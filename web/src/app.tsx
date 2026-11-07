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
import { Toaster } from './ui/components/sonner'
import { Button } from './ui/components/button'
import { applyTheme } from './ui/theme/tokens'
import { AuthPage, VerifyEmail } from './features/auth'
import { Account } from './features/account'
import { MyTrips, TripPlaceholder, JoinTrip } from './features/trips'
import { Members, TripSettings } from './features/trip-management'
import { startSync } from './sync-runtime'
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
            onClick={() => {
              if (needRefresh) void updateServiceWorker(true)
              else window.location.reload()
            }}
          >
            {upgrade ? '需要更新应用，点击刷新' : '有更新，点击刷新'}
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
                  { index: true, element: <TripPlaceholder title="行程" /> },
                  { path: 'ledger', element: <TripPlaceholder title="账本" /> },
                  {
                    path: 'packing',
                    element: <TripPlaceholder title="清单" />,
                  },
                  { path: 'more', element: <TripPlaceholder title="更多" /> },
                  { path: 'members', element: <Members /> },
                  { path: 'settings', element: <TripSettings /> },
                  ...(
                    [
                      ['documents', '凭证'],
                      ['polls', '投票'],
                      ['history', '修改记录'],
                    ] as const
                  ).map(([path, title]) => ({
                    path,
                    element: <TripPlaceholder title={title} />,
                  })),
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
