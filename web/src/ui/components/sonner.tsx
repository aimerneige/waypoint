import { Toaster as Primitive } from 'sonner'
import { useEffect, useState } from 'react'
export function Toaster() {
  const [overlay, setOverlay] = useState(false)
  useEffect(() => {
    const update = () =>
      setOverlay(!!document.querySelector('[data-overlay][data-state="open"]'))
    const observer = new MutationObserver(update)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-state'],
    })
    update()
    return () => observer.disconnect()
  }, [])
  return (
    <Primitive
      position={overlay ? 'top-center' : 'bottom-center'}
      toastOptions={{
        style: {
          background: 'var(--card)',
          color: 'var(--card-foreground)',
          border: '1px solid var(--border)',
          fontSize: '16px',
        },
        actionButtonStyle: {
          background: 'var(--primary)',
          color: 'var(--primary-foreground)',
          minWidth: '44px',
          minHeight: '44px',
          fontSize: '16px',
        },
      }}
    />
  )
}
