import { afterEach, expect, it, vi } from 'vitest'
import { apiFetch, ApiError } from './client'
afterEach(() => vi.unstubAllGlobals())
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
it('obtains missing CSRF, retries csrf_invalid once, preserves body', async () => {
  vi.stubGlobal('document', { cookie: '' })
  const calls: Request[] = []
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input)
    calls.push(request.clone())
    if (request.url.endsWith('/csrf'))
      return json({ token: calls.length === 1 ? 'first' : 'refreshed' })
    if (calls.length === 2)
      return json({ error: { code: 'csrf_invalid', message: '校验失败' } }, 403)
    return json({ message: 'ok' })
  })
  // csrf endpoint uses the Web relative API URL.
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) =>
    fetch(
      typeof input === 'string' ? new URL(input, 'http://localhost') : input,
    ),
  )
  await apiFetch(
    new Request('http://localhost/api/auth/login', {
      method: 'POST',
      body: '{"email":"test@example.com"}',
    }),
  )
  expect(calls).toHaveLength(4)
  expect(calls[1].headers.get('X-CSRF-Token')).toBe('first')
  expect(calls[3].headers.get('X-CSRF-Token')).toBe('refreshed')
  expect(await calls[1].text()).toBe(await calls[3].text())
})
it('does not retry other errors and returns typed errors', async () => {
  vi.stubGlobal('document', { cookie: 'wp_csrf=existing' })
  const fetch = vi.fn(async () =>
    json({ error: { code: 'forbidden', message: '没有权限' } }, 403),
  )
  vi.stubGlobal('fetch', fetch)
  await expect(
    apiFetch(
      new Request('http://localhost/api/me', { method: 'PATCH', body: '{}' }),
    ),
  ).rejects.toMatchObject({
    code: 'forbidden',
    status: 403,
    message: '没有权限',
  })
  expect(fetch).toHaveBeenCalledTimes(1)
})
it('limits CSRF retry to one attempt', async () => {
  vi.stubGlobal('document', { cookie: 'wp_csrf=old' })
  const fetch = vi.fn(async (input: RequestInfo | URL) =>
    String(input).includes('/csrf')
      ? json({ token: 'new' })
      : json({ error: { code: 'csrf_invalid', message: '校验失败' } }, 403),
  )
  vi.stubGlobal('fetch', fetch)
  await expect(
    apiFetch(new Request('http://localhost/api/me', { method: 'PATCH' })),
  ).rejects.toBeInstanceOf(ApiError)
  expect(fetch).toHaveBeenCalledTimes(3)
})
it('GET does not fetch CSRF and propagates caller cancellation', async () => {
  const controller = new AbortController()
  controller.abort()
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    expect((input as Request).headers.has('X-CSRF-Token')).toBe(false)
    ;(input as Request).signal.throwIfAborted()
    return json({})
  })
  vi.stubGlobal('fetch', fetch)
  await expect(
    apiFetch(
      new Request('http://localhost/api/me', { signal: controller.signal }),
    ),
  ).rejects.toMatchObject({ name: 'AbortError' })
  expect(fetch).toHaveBeenCalledTimes(1)
})
