import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import type { components } from '@/api/schema'
import { api } from '@/api/client'
import { database } from '@/data/db'
import { useEntities } from '@/data/hooks'
import { useSession } from '@/platform/session'
import { share } from '@/platform'
import { currentEngine } from '@/sync-runtime'
import { useOnline } from '@/ui/hooks'
import { Button } from '@/ui/components/button'
import { Card } from '@/ui/components/card'
import { Avatar } from '@/ui/components/avatar'
import { ResponsiveOverlay } from '@/ui/responsive-overlay'
import { toast } from '@/ui/components/sonner'
import { errorMessage } from './auth-utils'
type TripInput = components['schemas']['TripBody']
export function TripForm({
  initial,
  onSave,
  disabled = false,
}: {
  initial?: TripInput
  onSave: (values: TripInput) => Promise<void>
  disabled?: boolean
}) {
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        setBusy(true)
        void onSave({
          name: String(data.get('name')),
          startDate: String(data.get('startDate')),
          endDate: String(data.get('endDate')),
          timezone: String(data.get('timezone')),
        })
          .catch((error) => toast.error(errorMessage(error)))
          .finally(() => setBusy(false))
      }}
    >
      <label>
        名称
        <input
          name="name"
          required
          maxLength={200}
          defaultValue={initial?.name}
          disabled={disabled}
        />
      </label>
      <label>
        开始日期
        <input
          type="date"
          name="startDate"
          required
          defaultValue={initial?.startDate}
          disabled={disabled}
        />
      </label>
      <label>
        结束日期
        <input
          type="date"
          name="endDate"
          required
          defaultValue={initial?.endDate}
          disabled={disabled}
        />
      </label>
      <label>
        时区
        <input
          name="timezone"
          list="timezones"
          required
          defaultValue={
            initial?.timezone ??
            Intl.DateTimeFormat().resolvedOptions().timeZone
          }
          disabled={disabled}
        />
      </label>
      <datalist id="timezones">
        {Intl.supportedValuesOf('timeZone').map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>
      <Button disabled={disabled} loading={busy}>
        保存行程
      </Button>
    </form>
  )
}
function useTrip() {
  const { tripId = '' } = useParams()
  const user = useSession((s) => s.currentUser)!
  const status = useSession((s) => s.status)
  const db = database(user.id)
  const trip = useLiveQuery(() => db.trips.get(tripId), [db, tripId])
  const online = useOnline()
  return {
    tripId,
    user,
    db,
    trip,
    disabled: !online || status !== 'authenticated',
  }
}
export function Members() {
  const { tripId, user, db, trip, disabled } = useTrip()
  const members = useEntities(db, tripId, 'member')
  const owner = trip?.role === 'owner'
  const [confirm, setConfirm] = useState<{
    title: string
    action: () => Promise<unknown>
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const invites =
    useLiveQuery(
      async () =>
        (await db.meta.get(`invites:${tripId}`))?.value as
          components['schemas']['Invite'][] | undefined,
      [db, tripId],
    ) ?? []
  const [hours, setHours] = useState('168')
  const navigate = useNavigate()
  const path = { tripId }
  async function loadInvites() {
    const { data } = await api.GET('/api/trips/{tripId}/invites', {
      params: { path },
    })
    await db.meta.put({ key: `invites:${tripId}`, value: data?.invites ?? [] })
  }
  useEffect(() => {
    if (owner && !disabled)
      void api
        .GET('/api/trips/{tripId}/invites', { params: { path: { tripId } } })
        .then(({ data }) =>
          db.meta.put({ key: `invites:${tripId}`, value: data?.invites ?? [] }),
        )
        .catch((error) => toast.error(errorMessage(error)))
  }, [db, tripId, owner, disabled])
  async function perform(action: () => Promise<unknown>) {
    setBusy(true)
    try {
      await action()
      await currentEngine()?.discover()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="page stack">
      <h1>成员</h1>
      {members.map((row) => {
        const member = row.view!.fields
        const id = row.entityId
        return (
          <Card key={id}>
            <div className="row">
              <Avatar
                name={String(member.nickname)}
                src={member.avatarUrl as string | null}
              />
              <strong>{String(member.nickname)}</strong>
              <span>
                {member.leftAt
                  ? '已退出成员'
                  : member.role === 'owner'
                    ? '所有者'
                    : '成员'}
              </span>
            </div>
            {owner && id !== user.id && !member.leftAt && (
              <div className="row">
                <Button
                  disabled={disabled || busy}
                  variant="outline"
                  onClick={() =>
                    setConfirm({
                      title: `移除 ${member.nickname}？`,
                      action: () =>
                        api.DELETE('/api/trips/{tripId}/members/{userId}', {
                          params: { path: { tripId, userId: id } },
                        }),
                    })
                  }
                >
                  移除成员
                </Button>
                <Button
                  disabled={disabled || busy}
                  variant="outline"
                  onClick={() =>
                    setConfirm({
                      title: `将所有权转让给 ${member.nickname}？`,
                      action: () =>
                        api.POST('/api/trips/{tripId}/transfer-owner', {
                          params: { path },
                          body: { userId: id },
                        }),
                    })
                  }
                >
                  转让所有者
                </Button>
              </div>
            )}
          </Card>
        )
      })}
      {!owner && (
        <Button
          disabled={disabled || busy}
          variant="outline"
          onClick={() =>
            setConfirm({
              title: '确认退出行程？',
              action: async () => {
                await api.POST('/api/trips/{tripId}/leave', {
                  params: { path },
                })
                await currentEngine()?.revoke(tripId, 'revoked')
                navigate('/')
              },
            })
          }
        >
          退出行程
        </Button>
      )}
      {owner && (
        <Card>
          <h2>邀请</h2>
          {!user.emailVerified ? (
            <>
              <p>请先验证邮箱</p>
              <Button
                disabled={disabled || busy}
                onClick={() =>
                  void perform(async () => {
                    await api.POST('/api/auth/resend-verification')
                    toast.success('验证邮件已发送')
                  })
                }
              >
                重发验证邮件
              </Button>
            </>
          ) : (
            <>
              <label>
                邀请有效期
                <select
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                >
                  <option value="24">1 天</option>
                  <option value="168">7 天</option>
                  <option value="720">30 天</option>
                  <option value="">永不</option>
                </select>
              </label>
              <Button
                disabled={disabled || busy}
                onClick={() =>
                  void perform(async () => {
                    await api.POST('/api/trips/{tripId}/invites', {
                      params: { path },
                      body: hours ? { expiresInHours: Number(hours) } : {},
                    })
                    await loadInvites()
                  })
                }
              >
                生成邀请链接
              </Button>
            </>
          )}
          {invites.map((invite) => {
            const url = `${location.origin}/join/${invite.token}`
            return (
              <div className="stack" key={invite.id}>
                <input aria-label="邀请链接" readOnly value={url} />
                <p>
                  {invite.revokedAt
                    ? '已作废'
                    : invite.expiresAt
                      ? `有效至 ${new Date(invite.expiresAt).toLocaleString()}`
                      : '永久有效'}
                </p>
                <div className="row">
                  <Button
                    variant="outline"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(url)
                        .then(() => toast.success('链接已复制'))
                        .catch((error) => toast.error(errorMessage(error)))
                    }
                  >
                    复制
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      void share
                        .share({ url })
                        .catch((error) => toast.error(errorMessage(error)))
                    }
                  >
                    分享
                  </Button>
                  <Button
                    variant="outline"
                    disabled={disabled || busy || !!invite.revokedAt}
                    onClick={() =>
                      void perform(async () => {
                        await api.DELETE(
                          '/api/trips/{tripId}/invites/{inviteId}',
                          { params: { path: { tripId, inviteId: invite.id } } },
                        )
                        await loadInvites()
                      })
                    }
                  >
                    作废
                  </Button>
                </div>
              </div>
            )
          })}
        </Card>
      )}
      <ResponsiveOverlay
        open={!!confirm}
        onOpenChange={(open) => {
          if (!open) setConfirm(null)
        }}
        title={confirm?.title ?? '确认'}
      >
        <Button
          loading={busy}
          disabled={disabled}
          onClick={() =>
            void perform(async () => {
              await confirm?.action()
              setConfirm(null)
            })
          }
        >
          确认
        </Button>
      </ResponsiveOverlay>
    </main>
  )
}
export function TripSettings() {
  const { tripId, trip, disabled } = useTrip()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  if (!trip) return <main className="page">正在读取行程…</main>
  return (
    <main className="page stack">
      <h1>设置</h1>
      <TripForm
        key={trip.id}
        initial={trip}
        disabled={disabled || trip.role !== 'owner'}
        onSave={async (body) => {
          await api.PATCH('/api/trips/{tripId}', {
            params: { path: { tripId } },
            body,
          })
          await currentEngine()?.sync(tripId)
          toast.success('行程已更新')
        }}
      />
      {trip.role === 'owner' && (
        <Button
          variant="outline"
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          删除行程
        </Button>
      )}
      <ResponsiveOverlay
        open={open}
        onOpenChange={setOpen}
        title="删除行程"
        description="此操作无法撤销。请输入行程名确认。"
      >
        <label>
          行程名称
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <Button
          disabled={disabled || name !== trip.name}
          loading={busy}
          onClick={() => {
            setBusy(true)
            void api
              .DELETE('/api/trips/{tripId}', { params: { path: { tripId } } })
              .then(async () => {
                await currentEngine()?.revoke(tripId, 'deleted')
                navigate('/')
              })
              .catch((error) => toast.error(errorMessage(error)))
              .finally(() => setBusy(false))
          }}
        >
          确认删除
        </Button>
      </ResponsiveOverlay>
    </main>
  )
}
