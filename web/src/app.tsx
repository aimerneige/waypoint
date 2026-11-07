import { Suspense, useEffect, useState } from 'react'
import { Skeleton } from './ui/components/skeleton'
import { Navigate, Outlet, useLocation, Link } from 'react-router'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { bootstrapSession, useSession } from './platform/session'
import { useSyncStatus } from './ui/sync-status'
import { overlayHistory } from './ui/overlay-history'
import { Toaster } from './ui/components/sonner'
import { toast } from './ui/toast'
import { Button } from './ui/components/button'
import { applyTheme } from './ui/theme/tokens'
import { startSync } from './sync-runtime'
export function Root() {
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
      <Suspense
        fallback={
          <main className="page stack" role="status" aria-label="正在加载页面">
            <Skeleton className="h-12" />
            <Skeleton className="h-32" />
          </main>
        }
      >
        <Outlet />
      </Suspense>
      <Toaster />
    </>
  )
}
export function Protected() {
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
