import * as DialogPrimitive from '@radix-ui/react-dialog'
export const Dialog = DialogPrimitive.Root
export const DialogPortal = DialogPrimitive.Portal
export const DialogTitle = DialogPrimitive.Title
export const DialogDescription = DialogPrimitive.Description
export const DialogClose = DialogPrimitive.Close
export function DialogOverlay() {
  return <DialogPrimitive.Overlay className="overlay-backdrop" />
}
export function DialogContent(
  props: React.ComponentProps<typeof DialogPrimitive.Content>,
) {
  return (
    <DialogPrimitive.Content {...props} className="overlay-content dialog" />
  )
}
