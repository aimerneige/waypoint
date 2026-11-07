import * as Primitive from '@radix-ui/react-dropdown-menu'
export const DropdownMenu = Primitive.Root
export const DropdownMenuTrigger = Primitive.Trigger
export function DropdownMenuContent(
  props: React.ComponentProps<typeof Primitive.Content>,
) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        {...props}
        className="rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-lg"
      />
    </Primitive.Portal>
  )
}
export function DropdownMenuItem(
  props: React.ComponentProps<typeof Primitive.Item>,
) {
  return (
    <Primitive.Item
      {...props}
      className="flex min-h-11 min-w-11 cursor-pointer items-center rounded-md px-3 outline-none focus:bg-accent"
    />
  )
}
