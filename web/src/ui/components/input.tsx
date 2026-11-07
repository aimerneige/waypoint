import type { ComponentProps } from 'react'
import { cn } from '../lib/utils'
export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn('min-h-11 text-base', className)} {...props} />
}
