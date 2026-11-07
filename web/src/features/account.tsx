import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { database } from '@/data/db'
import { useNavigate } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useSession, saveUser, logoutSession } from '@/platform/session'
import { api } from '@/api/client'
import { errorMessage, nickname, password } from './auth-utils'
import { Form, FormField } from '@/ui/components/form'
import { Button } from '@/ui/components/button'
import { Card } from '@/ui/components/card'
import { Avatar } from '@/ui/components/avatar'
import { Alert } from '@/ui/components/alert'
import { ResponsiveOverlay } from '@/ui/responsive-overlay'
import { useOnline } from '@/ui/hooks'
import { applyTheme, type Theme } from '@/ui/theme/tokens'
import { toast } from '@/ui/components/sonner'
export function Account({
  onBeforeLogout,
}: {
  onBeforeLogout?: () => Promise<void>
}) {
  const user = useSession((s) => s.currentUser)!
  const expired = useSession((s) => s.status === 'expired')
  const online = useOnline()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmLogout, setConfirmLogout] = useState(false)
  const pending = useLiveQuery(
    () => database(user.id).outbox.count(),
    [user.id],
  )
  async function logout() {
    await perform(async () => {
      await logoutSession(onBeforeLogout)
      navigate('/login', { replace: true })
    })
  }
  const profile = useForm({
    resolver: zodResolver(z.object({ nickname })),
    defaultValues: { nickname: user.nickname },
  })
  const passwords = useForm({
    resolver: zodResolver(
      z.object({
        oldPassword: z.string().min(1, '请输入原密码'),
        newPassword: password,
      }),
    ),
    defaultValues: { oldPassword: '', newPassword: '' },
  })
  async function perform(action: () => Promise<void>) {
    setBusy(true)
    try {
      await action()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  const disabled = !online || expired
  return (
    <main className="page stack" style={{ maxWidth: 640 }}>
      <h1>账户</h1>
      <div className="row">
        <Avatar name={user.nickname} src={user.avatarUrl} />
        <div>
          <strong>{user.nickname}</strong>
          <p className="muted">{user.email}</p>
        </div>
      </div>
      {!online && <Alert>需要联网</Alert>}
      {!user.emailVerified && (
        <Alert>
          邮箱尚未验证，请查收验证邮件。
          <Button
            variant="outline"
            disabled={disabled}
            loading={busy}
            onClick={() =>
              void perform(async () => {
                await api.POST('/api/auth/resend-verification')
                toast.success('验证邮件已发送')
              })
            }
          >
            重发验证邮件
          </Button>
        </Alert>
      )}
      <Card>
        <h2>个人资料</h2>
        <Form {...profile}>
          <form
            onSubmit={profile.handleSubmit((values) =>
              perform(async () => {
                const { data } = await api.PATCH('/api/me', { body: values })
                if (data) saveUser(data)
                toast.success('昵称已更新')
              }),
            )}
          >
            <FormField name="nickname" label="昵称" />
            <Button
              disabled={disabled}
              loading={profile.formState.isSubmitting}
            >
              保存昵称
            </Button>
          </form>
        </Form>
      </Card>
      <Card>
        <h2>外观</h2>
        <label htmlFor="theme">主题</label>
        <select
          id="theme"
          defaultValue={localStorage.getItem('wp:theme') ?? 'system'}
          onChange={(e) => applyTheme(e.target.value as Theme)}
        >
          <option value="system">跟随系统</option>
          <option value="light">亮色</option>
          <option value="dark">暗色</option>
        </select>
      </Card>
      <Button
        variant="outline"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        修改密码
      </Button>
      <ResponsiveOverlay
        open={open}
        onOpenChange={setOpen}
        title="修改密码"
        description="修改后其他设备将退出登录。"
      >
        <Form {...passwords}>
          <form
            onSubmit={passwords.handleSubmit((values) =>
              perform(async () => {
                await api.POST('/api/auth/change-password', { body: values })
                setOpen(false)
                passwords.reset()
                toast.success('密码已修改，其他设备已退出登录')
              }),
            )}
          >
            <FormField
              name="oldPassword"
              label="原密码"
              type="password"
              autoComplete="current-password"
            />
            <FormField
              name="newPassword"
              label="新密码"
              type="password"
              autoComplete="new-password"
            />
            <Button loading={busy} disabled={disabled}>
              确认修改
            </Button>
          </form>
        </Form>
      </ResponsiveOverlay>
      <Button
        variant="outline"
        disabled={!online || pending === undefined}
        loading={busy}
        onClick={() => {
          if (pending) setConfirmLogout(true)
          else void logout()
        }}
      >
        退出登录
      </Button>
      <ResponsiveOverlay
        open={confirmLogout}
        onOpenChange={setConfirmLogout}
        title="退出登录"
        description={`还有 ${pending} 条未同步修改，退出将清空本地数据。`}
      >
        <Button loading={busy} onClick={() => void logout()}>
          确认退出登录
        </Button>
      </ResponsiveOverlay>
    </main>
  )
}
