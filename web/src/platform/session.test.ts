// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api, ApiError, sessionEvents } from '@/api/client'
import { database, deleteDatabase } from '@/data/db'
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
it('cleans local data before logout and allows offline logout', async () => {
  saveUser(user)
  const cacheDelete = vi.fn(async () => true)
  vi.stubGlobal('caches', {
    keys: async () => ['waypoint-credentials-user-1-files', 'other-cache'],
    delete: cacheDelete,
  })
  vi.spyOn(api, 'POST').mockImplementation(async () => {
    expect(localStorage.getItem('wp:lastUser')).toBeNull()
    expect(useSession.getState().currentUser).toBeNull()
    throw new TypeError('offline')
  })
  await logoutSession()
  expect(cacheDelete).toHaveBeenCalledExactlyOnceWith(
    'waypoint-credentials-user-1-files',
  )
})
it('clears only the logged-out database and can reopen it on the next login', async () => {
  saveUser(user)
  const own = database(user.id)
  const other = database('other-user')
  await own.meta.put({ key: 'test', value: 'private' })
  await other.meta.put({ key: 'test', value: 'other' })
  vi.spyOn(api, 'POST').mockRejectedValue(new ApiError('unauthorized', '', 401))
  await logoutSession()
  const reopened = database(user.id)
  expect(reopened.name).toBe('waypoint-u-user-1')
  expect(await reopened.meta.get('test')).toBeUndefined()
  expect((await other.meta.get('test'))?.value).toBe('other')
  await deleteDatabase(user.id)
  await deleteDatabase('other-user')
})
