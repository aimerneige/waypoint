import { expect, test } from 'vitest'
import { cn } from './utils'

test('conditional styles and Tailwind overrides compose correctly', () => {
  expect(cn('px-2 text-base', { hidden: false }, 'px-4')).toBe('text-base px-4')
})
