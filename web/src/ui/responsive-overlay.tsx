import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from 'react'
import { useMedia } from './hooks'
import { overlayHistory } from './overlay-history'
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './components/dialog'
import {
  Drawer,
  NestedDrawer,
  DrawerPortal,
  DrawerOverlay,
  DrawerContent,
  DrawerTitle,
  DrawerDescription,
} from './components/drawer'
import { Button } from './components/button'
const OverlayDepth = createContext(0)
export function ResponsiveOverlay({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  fullHeight = false,
  fullscreen = false,
  headerActions,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  fullHeight?: boolean
  fullscreen?: boolean
  headerActions?: ReactNode
}) {
  const desktop = useMedia('(min-width: 640px)')
  const depth = useContext(OverlayDepth)
  const descriptionId = useId()
  const id = useRef<number | null>(null)
  const content = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const callback = useRef(onOpenChange)
  useEffect(() => {
    callback.current = onOpenChange
  }, [onOpenChange])
  useEffect(() => {
    if (open) {
      opener.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
      id.current = overlayHistory!.open(() => {
        id.current = null
        callback.current(false)
      })
    }
    return () => {
      if (id.current !== null) {
        overlayHistory!.close(id.current)
        id.current = null
      }
    }
  }, [open])
  function change(value: boolean) {
    if (!value && id.current !== null) overlayHistory!.close(id.current)
    else callback.current(value)
  }
  const dialog = desktop || fullscreen
  const Root = dialog ? Dialog : depth > 0 ? NestedDrawer : Drawer
  const Portal = dialog ? DialogPortal : DrawerPortal
  const Backdrop = dialog ? DialogOverlay : DrawerOverlay
  const Content = dialog ? DialogContent : DrawerContent
  const Title = dialog ? DialogTitle : DrawerTitle
  const Description = dialog ? DialogDescription : DrawerDescription
  return (
    <Root open={open} onOpenChange={change}>
      <Portal>
        <Backdrop style={{ zIndex: 30 + depth * 2 }} />
        <Content
          ref={content}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            content.current
              ?.querySelector<HTMLElement>(
                'input:not([disabled]), button:not([disabled]), a[href], [tabindex="0"]',
              )
              ?.focus()
          }}
          onCloseAutoFocus={(event) => {
            if (opener.current?.isConnected) {
              event.preventDefault()
              opener.current.focus()
            }
          }}
          aria-describedby={description ? descriptionId : undefined}
          data-overlay={desktop ? 'dialog' : 'drawer'}
          data-fullscreen={fullscreen || undefined}
          style={{
            zIndex: 31 + depth * 2,
            ...(!desktop && fullHeight
              ? { height: '96dvh', maxHeight: '96dvh' }
              : {}),
            ...(fullscreen
              ? {
                  inset: 0,
                  width: '100%',
                  height: '100dvh',
                  maxHeight: '100dvh',
                  transform: 'none',
                  borderRadius: 0,
                }
              : {}),
          }}
        >
          <div className="stack">
            <div className={fullscreen ? 'viewer-toolbar row' : undefined}>
              {fullscreen && (
                <Button
                  variant="ghost"
                  aria-label="关闭"
                  onClick={() => change(false)}
                >
                  ← 返回
                </Button>
              )}
              <Title asChild>
                <h2>{title}</h2>
              </Title>
              {headerActions}
            </div>
            {description && (
              <Description id={descriptionId}>{description}</Description>
            )}
            <OverlayDepth value={depth + 1}>{children}</OverlayDepth>
            <div className="row">
              {footer}
              {!fullscreen && (
                <Button variant="outline" onClick={() => change(false)}>
                  关闭
                </Button>
              )}
            </div>
          </div>
        </Content>
      </Portal>
    </Root>
  )
}
