import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { database } from '@/data/db'
import { currentEngine } from '@/sync-runtime'
import { TripForm } from './trip-management'
import { ResponsiveOverlay } from '@/ui/responsive-overlay'
import { api } from '@/api/client'
import type { components } from '@/api/schema'
import { useSession } from '@/platform/session'
import { useOnline } from '@/ui/hooks'
import { Button } from '@/ui/components/button'
import { Card } from '@/ui/components/card'
import { errorMessage } from './auth-utils'
import { PackingReminder } from './packing-reminder'
import { LoadingList } from '@/ui/loading-list'
export function MyTrips() {
  const user = useSession((s) => s.currentUser)
  const online = useOnline()
  const status = useSession((s) => s.status)
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const trips = useLiveQuery(
    () => database(user!.id).trips.where('access').equals('ok').toArray(),
    [user!.id],
  )
  if (!trips)
    return (
      <main className="page">
        <LoadingList />
      </main>
    )
  return (
    <main className="page stack">
      <div>
        <p className="muted">你好，{user?.nickname}</p>
        <h1>我的行程</h1>
      </div>
      {trips.map((trip) => (
        <Card key={trip.id}>
          <PackingReminder trip={trip} />
          <Link to={`/trips/${trip.id}`}>
            <h2>{trip.name}</h2>
          </Link>
          <p>
            {trip.startDate} — {trip.endDate}
          </p>
          <p>{trip.role === 'owner' ? '所有者' : '成员'}</p>
        </Card>
      ))}
      {!trips.length && <p className="muted">下一段旅程，从这里开始</p>}
      <Button
        disabled={!online || status !== 'authenticated'}
        onClick={() => setOpen(true)}
      >
        新建行程
      </Button>
      <ResponsiveOverlay open={open} onOpenChange={setOpen} title="新建行程">
        <TripForm
          onSave={async (values) => {
            const { data } = await api.POST('/api/trips', { body: values })
            if (data) {
              await currentEngine()?.discover()
              // 等懒加载路由提交后再关闭，避免弹层回退覆盖尚未完成的导航。
              await navigate(`/trips/${data.id}`)
              setOpen(false)
            }
          }}
        />
      </ResponsiveOverlay>
    </main>
  )
}
export function TripPlaceholder({ title }: { title: string }) {
  return (
    <main className="page stack">
      <p className="muted">旅途空间</p>
      <h1>{title}</h1>
      <Card>
        <h2>为下一程做好准备</h2>
        <p className="muted">
          {title === '更多'
            ? '凭证、投票与行程管理集中在这里。'
            : `${title}功能正在准备中，敬请期待。`}
        </p>
      </Card>
      {title === '更多' && (
        <Card>
          {[
            ['documents', '凭证'],
            ['polls', '投票'],
            ['members', '成员'],
            ['settings', '设置'],
            ['history', '修改记录'],
          ].map(([path, label]) => (
            <Link
              className="list-row"
              style={{ display: 'flex' }}
              key={path}
              to={`../${path}`}
            >
              {label}
            </Link>
          ))}
        </Card>
      )}
    </main>
  )
}
export function JoinTrip() {
  const { token = '' } = useParams()
  const user = useSession((s) => s.currentUser)
  const status = useSession((s) => s.status)
  const online = useOnline()
  const navigate = useNavigate()
  const [preview, setPreview] = useState<
    components['schemas']['InvitePreview'] | null
  >(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const attempted = useRef(false)
  const next = `/join/${encodeURIComponent(token)}`
  useEffect(() => {
    void api
      .GET('/api/invites/{token}', { params: { path: { token } } })
      .then(({ data }) => setPreview(data ?? null))
      .catch((err) => setError(errorMessage(err)))
  }, [token])
  async function accept() {
    setBusy(true)
    try {
      const { data } = await api.POST('/api/invites/{token}/accept', {
        params: { path: { token } },
      })
      sessionStorage.removeItem('wp:join')
      if (data) {
        await currentEngine()?.discover()
        navigate(`/trips/${data.id}`, { replace: true })
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    if (
      user &&
      status === 'authenticated' &&
      preview?.valid &&
      online &&
      sessionStorage.getItem('wp:join') === token &&
      !attempted.current
    ) {
      attempted.current = true
      void accept()
    }
  })
  return (
    <main className="auth stack">
      <h1>行程邀请</h1>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {preview && (
        <>
          <h2>{preview.tripName}</h2>
          <p>{preview.ownerNickname} 邀请你一起出发</p>
          {!preview.valid ? (
            <p>邀请已失效</p>
          ) : user ? (
            <Button
              loading={busy}
              disabled={!online || status !== 'authenticated'}
              onClick={() => void accept()}
            >
              加入行程
            </Button>
          ) : (
            <div className="row">
              <Link
                to={`/login?next=${encodeURIComponent(next)}`}
                onClick={() => sessionStorage.setItem('wp:join', token)}
              >
                登录并加入
              </Link>
              <Link
                to={`/register?next=${encodeURIComponent(next)}`}
                onClick={() => sessionStorage.setItem('wp:join', token)}
              >
                注册并加入
              </Link>
            </div>
          )}
        </>
      )}
      {!online && <p>需要联网</p>}
    </main>
  )
}
