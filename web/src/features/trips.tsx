import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Compass } from 'lucide-react'
import { api } from '@/api/client'
import type { components } from '@/api/schema'
import { useSession } from '@/platform/session'
import { useOnline } from '@/ui/hooks'
import { Button } from '@/ui/components/button'
import { Card } from '@/ui/components/card'
import { errorMessage } from './auth-utils'
export function MyTrips() {
  const user = useSession((s) => s.currentUser)
  return (
    <main className="page stack">
      <div>
        <p className="muted">你好，{user?.nickname}</p>
        <h1>我的行程</h1>
      </div>
      <Card>
        <div
          className="stack"
          style={{ textAlign: 'center', padding: '40px 0' }}
        >
          <Compass
            size={48}
            style={{ margin: 'auto', color: 'var(--primary)' }}
          />
          <h2>下一段旅程，从这里开始</h2>
          <p className="muted">
            行程管理即将上线。你的旅途，即使离线也能随时查看。
          </p>
        </div>
      </Card>
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
        <p className="muted">{title}功能正在准备中，敬请期待。</p>
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
      if (data) navigate(`/trips/${data.id}`, { replace: true })
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
