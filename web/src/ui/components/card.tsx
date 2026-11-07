import type { HTMLAttributes } from 'react'
import { cn } from '../lib/utils'
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('card', className)} {...props} />
}
export function CardHeader(props: HTMLAttributes<HTMLDivElement>) {
  return <div className="mb-5" {...props} />
}
export function CardTitle(props: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 {...props} />
}
export function CardContent(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} />
}
