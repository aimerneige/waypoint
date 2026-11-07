import * as Primitive from '@radix-ui/react-switch'
export function Switch(props: React.ComponentProps<typeof Primitive.Root>) {
  return (
    <Primitive.Root
      {...props}
      className="flex min-h-11 min-w-11 items-center rounded-full bg-muted p-2 data-[state=checked]:bg-primary"
    >
      <Primitive.Thumb className="size-6 rounded-full bg-background transition-transform data-[state=checked]:translate-x-3" />
    </Primitive.Root>
  )
}
