import { z } from 'zod'
import { ApiError } from '@/api/client'
z.config({ jitless: true })
export const email = z.email('请输入有效的邮箱地址')
export const password = z
  .string()
  .min(8, '密码至少 8 个字符')
  .max(1024, '密码最多 1024 个字符')
export const nickname = z
  .string()
  .trim()
  .min(1, '请输入昵称')
  .max(100, '昵称最多 100 个字符')
export function safeNext(value: string | null) {
  return value &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !/[\\\r\n\t]/.test(value)
    ? value
    : '/'
}
export function errorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 429) return '请稍后再试'
    if (error.code === 'account_locked') return '账号暂时锁定，请十五分钟后重试'
    const messages: Record<string, string> = {
      invalid_credentials: '邮箱或密码错误',
      email_exists: '该邮箱已注册',
      invalid_token: '链接无效或已过期，请重新申请',
      csrf_invalid: '请求校验失败，请重试',
      unauthorized: '登录已失效，请重新登录',
    }
    return messages[error.code] ?? error.message
  }
  return '网络连接失败，请检查网络后重试'
}
