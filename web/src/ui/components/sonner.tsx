import { Toaster as Primitive, toast as baseToast } from 'sonner'
export function Toaster() {
  return (
    <Primitive
      position="bottom-center"
      toastOptions={{
        style: {
          background: 'var(--card)',
          color: 'var(--card-foreground)',
          border: '1px solid var(--border)',
          fontSize: '16px',
        },
        actionButtonStyle: {
          minWidth: '44px',
          minHeight: '44px',
          fontSize: '16px',
        },
      }}
    />
  )
}
export const toast = Object.assign(baseToast, {
  undoable(message: string, onUndo: () => void) {
    return baseToast(message, { action: { label: '撤销', onClick: onUndo } })
  },
})
