import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Compass } from 'lucide-react'
import { api } from '@/api/client'
import { loginSession, useSession, saveUser } from '@/platform/session'
import { Button } from '@/ui/components/button'
import { Form, FormField } from '@/ui/components/form'
import { useOnline } from '@/ui/hooks'
import { toast } from '@/ui/toast'
import { email, password, nickname, safeNext, errorMessage } from './auth-utils'
type Kind = 'login' | 'register' | 'forgot-password' | 'reset-password'
const titles = {
  login: '欢迎回来',
  register: '创建账号',
  'forgot-password': '找回密码',
  'reset-password': '设置新密码',
}
const actions = {
  login: '登录',
  register: '注册',
  'forgot-password': '发送重置邮件',
  'reset-password': '重置密码',
}
export function AuthPage({ kind }: { kind: Kind }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const online = useOnline()
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const schema = z.object({
    email: kind !== 'reset-password' ? email : z.string(),
    nickname: kind === 'register' ? nickname : z.string(),
    password:
      kind === 'login'
        ? z.string().min(1, '请输入密码')
        : kind !== 'forgot-password'
          ? password
          : z.string(),
  })
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { email: '', nickname: '', password: '' },
  })
  const next = safeNext(params.get('next'))
  async function submit(values: Record<string, string>) {
    setError('')
    try {
      if (kind === 'login' || kind === 'register') {
        const result =
          kind === 'login'
            ? await api.POST('/api/auth/login', {
                body: {
                  email: values.email,
                  password: values.password,
                  tokenDelivery: 'cookie',
                },
              })
            : await api.POST('/api/auth/register', {
                body: {
                  email: values.email,
                  password: values.password,
                  nickname: values.nickname,
                  tokenDelivery: 'cookie',
                },
              })
        if (result.data) {
          await loginSession(result.data)
          navigate(next, { replace: true })
        }
      } else if (kind === 'forgot-password') {
        await api.POST('/api/auth/forgot-password', {
          body: { email: values.email },
        })
        setMessage('如果邮箱已注册，我们已发送密码重置邮件，请查收。')
      } else {
        const token = params.get('token')
        if (!token) {
          setError('缺少重置令牌，请重新申请')
          return
        }
        await api.POST('/api/auth/reset-password', {
          body: { token, newPassword: values.password },
        })
        toast.success('密码已重置，请重新登录')
        navigate('/login', { replace: true })
      }
    } catch (err) {
      setError(errorMessage(err))
    }
  }
  return (
    <main className="auth stack">
      <Link className="brand" to="/">
        <Compass />
        Waypoint
      </Link>
      <div>
        <h1>{titles[kind]}</h1>
        <p className="muted">和朋友一起，让每一程井井有条。</p>
      </div>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(submit)} noValidate>
          {kind === 'register' && (
            <FormField name="nickname" label="昵称" autoComplete="nickname" />
          )}
          {kind !== 'reset-password' && (
            <FormField
              name="email"
              label="邮箱"
              type="email"
              autoComplete="email"
            />
          )}
          {kind !== 'forgot-password' && (
            <FormField
              name="password"
              label={kind === 'reset-password' ? '新密码' : '密码'}
              type="password"
              autoComplete={
                kind === 'login' ? 'current-password' : 'new-password'
              }
            />
          )}{' '}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {message && <p role="status">{message}</p>}
          <Button loading={form.formState.isSubmitting} disabled={!online}>
            {actions[kind]}
          </Button>
          {!online && <p className="muted">需要联网</p>}
        </form>
      </Form>
      <div className="row">
        {kind !== 'login' && (
          <Link to={`/login?next=${encodeURIComponent(next)}`}>返回登录</Link>
        )}
        {kind === 'login' && (
          <>
            <Link to={`/register?next=${encodeURIComponent(next)}`}>
              创建账号
            </Link>
            <Link to="/forgot-password">忘记密码？</Link>
          </>
        )}
      </div>
    </main>
  )
}
export function VerifyEmail() {
  const [params] = useSearchParams()
  const [message, setMessage] = useState('正在验证邮箱…')
  const token = params.get('token')
  useEffect(() => {
    if (!token) return
    let active = true
    void api
      .POST('/api/auth/verify-email', { body: { token } })
      .then(async () => {
        if (!active) return
        setMessage('邮箱验证成功')
        if (useSession.getState().currentUser) {
          const { data } = await api.GET('/api/me')
          if (data) saveUser(data)
        }
      })
      .catch((err) => {
        if (active) setMessage(errorMessage(err))
      })
    return () => {
      active = false
    }
  }, [token])
  return (
    <main className="auth stack">
      <h1>邮箱验证</h1>
      <p role="status">{token ? message : '缺少验证令牌'}</p>
      <Link to="/account">返回账户</Link>
      <Link to="/login">前往登录</Link>
    </main>
  )
}
