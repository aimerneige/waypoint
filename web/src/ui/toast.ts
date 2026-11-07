import { toast as baseToast } from 'sonner'
export const toast = Object.assign(baseToast, {
  undoable(message: string, onUndo: () => void) {
    return baseToast(message, { action: { label: '撤销', onClick: onUndo } })
  },
})
