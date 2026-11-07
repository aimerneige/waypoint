// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api, ApiError, sessionEvents } from '@/api/client'
import {
  bootstrapSession,
  saveUser,
  useSession,
  logoutSession,
  loginSession,
} from './session'
const user = {
  id: 'user-1',
  email: 'test@example.com',
  nickname: '旅人',
  avatarUrl: null,
  emailVerified: true,
}
beforeEach(() => {
  localStorage.clear()
  useSession.setState({ currentUser: null, status: 'unknown' })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
it('retains local user on network errors', async () => {
  saveUser(user)
  vi.spyOn(api, 'GET').mockRejectedValue(new TypeError('offline'))
  await bootstrapSession()
  expect(useSession.getState()).toMatchObject({
    currentUser: user,
    status: 'authenticated',
  })
  expect(JSON.parse(localStorage.getItem('wp:lastUser')!)).toEqual(user)
})
it('keeps cached data read-only after 401 and becomes anonymous without a cache', async () => {
  vi.spyOn(api, 'GET').mockRejectedValue(
    new ApiError('unauthorized', '登录失效', 401),
  )
  saveUser(user)
  await bootstrapSession()
  expect(useSession.getState()).toMatchObject({
    currentUser: user,
    status: 'expired',
  })
  useSession.setState({ currentUser: null })
  await bootstrapSession()
  expect(useSession.getState().status).toBe('anonymous')
})
it('marks an active session expired on authenticated API failures', () => {
  saveUser(user)
  sessionEvents.dispatchEvent(new Event('expired'))
  expect(useSession.getState()).toMatchObject({
    currentUser: user,
    status: 'expired',
  })
})
it('does not discard a session when the logout hook fails', async () => {
  saveUser(user)
  const post = vi.spyOn(api, 'POST')
  await expect(
    logoutSession(async () => {
      throw new Error('pending work')
    }),
  ).rejects.toThrow('pending work')
  expect(post).not.toHaveBeenCalled()
  expect(useSession.getState().currentUser).toEqual(user)
})
it('requests persistent storage only once after login', async () => {
  const persist = vi.fn(async () => true)
  vi.stubGlobal('navigator', { storage: { persist } })
  await loginSession({ user })
  await loginSession({ user })
  expect(persist).toHaveBeenCalledTimes(1)
})
it('allows local logout of an already expired session', async () => {
  saveUser(user)
  vi.spyOn(api, 'POST').mockRejectedValue(
    new ApiError('unauthorized', '登录失效', 401),
  )
  await logoutSession()
  expect(useSession.getState()).toMatchObject({
    currentUser: null,
    status: 'anonymous',
  })
  expect(localStorage.getItem('wp:lastUser')).toBeNull()
})
