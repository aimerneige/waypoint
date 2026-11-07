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

export async function apiUpload(
  path: string,
  file: Blob,
  progress: (percent: number) => void,
): Promise<{ sha256: string }> {
  const headers = await auth.getAuthHeaders()
  if (auth.mode === 'cookie')
    headers['X-CSRF-Token'] =
      csrfCookie() ?? (await csrf(AbortSignal.timeout(15000)))
  const send = () =>
    new Promise<{ sha256: string }>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('PUT', `${baseUrl}${path}`)
      xhr.withCredentials = true
      xhr.timeout = 120000
      xhr.setRequestHeader('Content-Type', file.type)
      for (const [key, value] of Object.entries(headers))
        xhr.setRequestHeader(key, value)
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable)
          progress(Math.min(99, Math.round((event.loaded / event.total) * 100)))
      }
      xhr.onerror = () => reject(new TypeError('文件上传网络错误'))
      xhr.ontimeout = () => reject(new TypeError('文件上传超时'))
      xhr.onabort = () => reject(new TypeError('文件上传已中断'))
      xhr.onload = () => {
        let body: {
          sha256?: string
          error?: { code: string; message: string }
        } = {}
        try {
          body = JSON.parse(xhr.responseText)
        } catch {
          /* 非 JSON 错误交给状态码处理。 */
        }
        if (xhr.status >= 200 && xhr.status < 300 && body.sha256)
          resolve({ sha256: body.sha256 })
        else {
          if (xhr.status === 401)
            sessionEvents.dispatchEvent(new Event('expired'))
          reject(
            new ApiError(
              body.error?.code ?? 'upload_failed',
              body.error?.message ?? '上传失败，请重试',
              xhr.status,
            ),
          )
        }
      }
      xhr.send(file)
    })
  try {
    return await send()
  } catch (error) {
    if (!(
      error instanceof ApiError &&
      error.code === 'csrf_invalid' &&
      auth.mode === 'cookie'
    ))
      throw error
    headers['X-CSRF-Token'] = await csrf(AbortSignal.timeout(15000))
    return send()
  }
}
