import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from 'react'
import { ArrowLeft } from 'lucide-react'
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
const OverlayState = createContext({ depth: 0, inDrawer: false })
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
  const { depth, inDrawer } = useContext(OverlayState)
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
  useEffect(() => {
    if (!open || !fullscreen) return
    const html = document.documentElement
    const body = document.body
    const prevHtml = html.style.overflow
    const prevBody = body.style.overflow
    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    return () => {
      html.style.overflow = prevHtml
      body.style.overflow = prevBody
    }
  }, [open, fullscreen])
  function change(value: boolean) {
    if (!value && id.current !== null) overlayHistory!.close(id.current)
    else callback.current(value)
  }
  const dialog = desktop || fullscreen
  const Root = dialog ? Dialog : inDrawer ? NestedDrawer : Drawer
  const Portal = dialog ? DialogPortal : DrawerPortal
  const Backdrop = dialog ? DialogOverlay : DrawerOverlay
  const Content = dialog ? DialogContent : DrawerContent
  const Title = dialog ? DialogTitle : DrawerTitle
  const Description = dialog ? DialogDescription : DrawerDescription
  const baseZ = fullscreen ? Math.max(50, 30 + depth * 2) : 30 + depth * 2
  const nextDepth = fullscreen ? Math.max(depth + 1, 15) : depth + 1
  return (
    <Root open={open} onOpenChange={change}>
      <Portal>
        <Backdrop style={{ zIndex: baseZ }} />
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
            zIndex: baseZ + 1,
            ...(!desktop && fullHeight && !fullscreen
              ? { height: '96dvh', maxHeight: '96dvh' }
              : {}),
            ...(fullscreen
              ? {
                  inset: 0,
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  width: '100vw',
                  height: '100dvh',
                  maxWidth: 'none',
                  maxHeight: '100dvh',
                  transform: 'none',
                  borderRadius: 0,
                }
              : {}),
          }}
        >
          {fullscreen ? (
            <div className="viewer-shell">
              <header className="viewer-toolbar">
                <Button
                  variant="ghost"
                  className="viewer-icon-btn"
                  aria-label="关闭"
                  onClick={() => change(false)}
                >
                  <ArrowLeft size={20} />
                </Button>
                <Title asChild>
                  <h2 className="viewer-title">{title}</h2>
                </Title>
                <div className="viewer-actions">{headerActions}</div>
              </header>
              {description && (
                <Description id={descriptionId}>{description}</Description>
              )}
              <div className="viewer-body">
                <OverlayState value={{ depth: nextDepth, inDrawer: false }}>
                  {children}
                </OverlayState>
              </div>
            </div>
          ) : (
            <div className="stack">
              <div>
                <Title asChild>
                  <h2>{title}</h2>
                </Title>
                {headerActions}
              </div>
              {description && (
                <Description id={descriptionId}>{description}</Description>
              )}
              <OverlayState
                value={{ depth: nextDepth, inDrawer: inDrawer || !dialog }}
              >
                {children}
              </OverlayState>
              <div className="row">
                {footer}
                <Button variant="outline" onClick={() => change(false)}>
                  关闭
                </Button>
              </div>
            </div>
          )}
        </Content>
      </Portal>
    </Root>
  )
}
