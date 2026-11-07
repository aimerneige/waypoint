import { create } from 'zustand'
import { z } from 'zod'
import { api, ApiError, sessionEvents } from '@/api/client'
import type { components } from '@/api/schema'
import { auth } from './auth'
import { deleteDatabase } from '@/data/db'
type User = components['schemas']['User']
const userSchema = z.object({
  id: z.string(),
  email: z.string(),
  nickname: z.string(),
  avatarUrl: z.string().nullable(),
  emailVerified: z.boolean(),
})
function cachedUser(): User | null {
  try {
    const parsed = userSchema.safeParse(
      JSON.parse(localStorage.getItem('wp:lastUser') ?? 'null'),
    )
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
const local = cachedUser()
export const useSession = create<{
  currentUser: User | null
  status: 'unknown' | 'authenticated' | 'anonymous' | 'expired'
}>(() => ({ currentUser: local, status: 'unknown' }))
sessionEvents.addEventListener('expired', () => {
  useSession.setState({
    status: useSession.getState().currentUser ? 'expired' : 'anonymous',
  })
})
export function saveUser(user: User) {
  localStorage.setItem('wp:lastUser', JSON.stringify(user))
  useSession.setState({ currentUser: user, status: 'authenticated' })
}
export async function loginSession(resp: components['schemas']['AuthResult']) {
  await auth.onLogin(resp)
  saveUser(resp.user)
  if (!localStorage.getItem('wp:persistRequested')) {
    localStorage.setItem('wp:persistRequested', '1')
    await navigator.storage?.persist?.().catch(() => false)
  }
}
export async function bootstrapSession() {
  try {
    const { data } = await api.GET('/api/me')
    if (data) saveUser(data)
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      useSession.setState({
        status: useSession.getState().currentUser ? 'expired' : 'anonymous',
      })
    else
      useSession.setState({
        status: useSession.getState().currentUser
          ? 'authenticated'
          : 'anonymous',
      })
  }
}
export async function logoutSession(
  onBeforeLogout: () => Promise<void> = async () => {},
) {
  await onBeforeLogout()
  try {
    await api.POST('/api/auth/logout')
  } catch (error) {
    // 已失效的会话无需再次撤销，仍允许用户退出本地账户。
    if (!(error instanceof ApiError && error.status === 401)) throw error
  }
  await clearSession()
}
export async function clearSession() {
  const user = useSession.getState().currentUser
  useSession.setState({ status: 'anonymous' })
  if (user) await deleteDatabase(user.id)
  await auth.onLogout()
  localStorage.removeItem('wp:lastUser')
  useSession.setState({ currentUser: null, status: 'anonymous' })
}
