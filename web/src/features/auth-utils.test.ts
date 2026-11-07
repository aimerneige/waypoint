import { expect, it } from 'vitest'
import { safeNext, errorMessage } from './auth-utils'
import { ApiError } from '@/api/client'
it('allows only local relative redirect paths', () => {
  for (const value of [
    null,
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '/\n/evil.example',
    '/\t/evil.example',
    'javascript:alert(1)',
  ])
    expect(safeNext(value)).toBe('/')
  expect(safeNext('/join/token?source=invite')).toBe(
    '/join/token?source=invite',
  )
})
it('maps throttling and account locking separately', () => {
  expect(
    errorMessage(new ApiError('rate_limited', 'request failed', 429)),
  ).toBe('请稍后再试')
  expect(
    errorMessage(new ApiError('account_locked', 'request failed', 401)),
  ).toContain('账号暂时锁定')
})
