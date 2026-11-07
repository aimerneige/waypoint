import { useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { useMedia } from './hooks'
import { Button } from './components/button'
import { Calendar } from './components/calendar'
import { formatDate } from '@/domain/format'
export function DateInput({
  value,
  onChange,
  min,
  max,
}: {
  value: string
  onChange: (v: string) => void
  min?: string
  max?: string
}) {
  const desktop = useMedia('(min-width: 640px)'),
    [open, setOpen] = useState(false)
  if (!desktop)
    return (
      <input
        required
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button type="button" variant="outline" aria-label="日期">
          {formatDate(value)}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="calendar-popover" sideOffset={8}>
          <Calendar
            mode="single"
            selected={new Date(`${value}T12:00:00`)}
            defaultMonth={new Date(`${value}T12:00:00`)}
            onSelect={(date) => {
              if (date) {
                onChange(
                  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
                )
                setOpen(false)
              }
            }}
            disabled={(date) =>
              (!!min && date < new Date(`${min}T00:00:00`)) ||
              (!!max && date > new Date(`${max}T23:59:59`))
            }
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
