import createClient from 'openapi-fetch'
import type { paths } from './schema'
import { auth } from '@/platform/auth'

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}
const baseUrl = import.meta.env.VITE_API_BASE_URL ?? ''
export const sessionEvents = new EventTarget()
function csrfCookie() {
  return document.cookie
    .split('; ')
    .find((v) => v.startsWith('wp_csrf='))
    ?.slice(8)
}
async function csrf(signal: AbortSignal) {
  const response = await fetch(`${baseUrl}/api/auth/csrf`, {
    credentials: 'include',
    signal,
  })
  if (!response.ok)
    throw new ApiError(
      'csrf_unavailable',
      '请求校验暂不可用，请稍后再试',
      response.status,
    )
  const body: { token: string } = await response.json()
  return body.token
}
export const apiFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init)
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(15000)])
  const headers = new Headers(request.headers)
  for (const [key, value] of Object.entries(await auth.getAuthHeaders()))
    headers.set(key, value)
  const write = !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
  if (write && auth.mode === 'cookie')
    headers.set('X-CSRF-Token', csrfCookie() ?? (await csrf(signal)))
  const backup = request.clone()
  let response = await fetch(
    new Request(request, { headers, signal, credentials: 'include' }),
  )
  if (write && response.status === 403 && auth.mode === 'cookie') {
    const body = await response
      .clone()
      .json()
      .catch(() => null)
    if (body?.error?.code === 'csrf_invalid') {
      headers.set('X-CSRF-Token', await csrf(signal))
      response = await fetch(
        new Request(backup, { headers, signal, credentials: 'include' }),
      )
    }
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    if (response.status === 401 && body?.error?.code === 'unauthorized')
      sessionEvents.dispatchEvent(new Event('expired'))
    throw new ApiError(
      body?.error?.code ?? 'request_failed',
      body?.error?.message ?? '请求失败，请稍后再试',
      response.status,
    )
  }
  return response
}

export const api = createClient<paths>({
  baseUrl,
  fetch: apiFetch,
})
