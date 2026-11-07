import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/ui/lib/utils'
import { LoaderCircle } from 'lucide-react'

const buttonVariants = cva(
  'inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md px-4 py-2 text-base font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:opacity-90',
        outline: 'border border-border bg-background hover:bg-accent',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

function Button({
  className,
  variant,
  asChild = false,
  loading = false,
  children,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    loading?: boolean
  }) {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, className }))}
      {...props}
      disabled={loading || props.disabled}
      aria-busy={loading || undefined}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading && (
            <LoaderCircle
              className="animate-spin"
              size={18}
              aria-hidden="true"
            />
          )}
          {children}
        </>
      )}
    </Comp>
  )
}

export { Button }
