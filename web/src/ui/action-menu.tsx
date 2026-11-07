import { useState } from 'react'
import * as Dropdown from '@radix-ui/react-dropdown-menu'
import { Ellipsis } from 'lucide-react'
import { useMedia } from './hooks'
import { ResponsiveOverlay } from './responsive-overlay'
import { toast } from '@/ui/toast'
export type Action = {
  label: string
  onSelect: () => void | Promise<void>
  disabled?: boolean
  danger?: boolean
}
export function ActionMenu({
  label,
  actions,
}: {
  label: string
  actions: Action[]
}) {
  const [open, setOpen] = useState(false),
    desktop = useMedia('(min-width: 640px)')
  const run = (action: Action) => {
    setOpen(false)
    Promise.resolve()
      .then(action.onSelect)
      .catch((e) => toast.error(String(e)))
  }
  const trigger = (
    <button
      type="button"
      className="action-trigger"
      aria-label={label}
      onClick={() => setOpen(true)}
    >
      <Ellipsis size={22} />
    </button>
  )
  if (!desktop)
    return (
      <>
        {trigger}
        <ResponsiveOverlay open={open} onOpenChange={setOpen} title={label}>
          <div className="action-items">
            {actions.map((a) => (
              <button
                type="button"
                key={a.label}
                disabled={a.disabled}
                className={a.danger ? 'error' : ''}
                onClick={() => run(a)}
              >
                {a.label}
              </button>
            ))}
          </div>
        </ResponsiveOverlay>
      </>
    )
  return (
    <Dropdown.Root open={open} onOpenChange={setOpen}>
      <Dropdown.Trigger asChild>{trigger}</Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          className="action-items dropdown-menu"
          align="end"
          sideOffset={4}
        >
          {actions.map((a) => (
            <Dropdown.Item
              key={a.label}
              disabled={a.disabled}
              className={a.danger ? 'error' : ''}
              onSelect={() => run(a)}
            >
              {a.label}
            </Dropdown.Item>
          ))}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  )
}
