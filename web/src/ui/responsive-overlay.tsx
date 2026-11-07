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
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
}) {
  const desktop = useMedia('(min-width: 640px)')
  const depth = useContext(OverlayDepth)
  const descriptionId = useId()
  const id = useRef<number | null>(null)
  const callback = useRef(onOpenChange)
  useEffect(() => {
    callback.current = onOpenChange
  }, [onOpenChange])
  useEffect(() => {
    if (open)
      id.current = overlayHistory!.open(() => {
        id.current = null
        callback.current(false)
      })
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
  const Root = desktop ? Dialog : depth > 0 ? NestedDrawer : Drawer
  const Portal = desktop ? DialogPortal : DrawerPortal
  const Backdrop = desktop ? DialogOverlay : DrawerOverlay
  const Content = desktop ? DialogContent : DrawerContent
  const Title = desktop ? DialogTitle : DrawerTitle
  const Description = desktop ? DialogDescription : DrawerDescription
  return (
    <Root open={open} onOpenChange={change}>
      <Portal>
        <Backdrop style={{ zIndex: 30 + depth * 2 }} />
        <Content
          aria-describedby={description ? descriptionId : undefined}
          data-overlay={desktop ? 'dialog' : 'drawer'}
          style={{ zIndex: 31 + depth * 2 }}
        >
          <div className="stack">
            <Title asChild>
              <h2>{title}</h2>
            </Title>
            {description && (
              <Description id={descriptionId}>{description}</Description>
            )}
            <OverlayDepth value={depth + 1}>{children}</OverlayDepth>
            <div className="row">
              {footer}
              <Button variant="outline" onClick={() => change(false)}>
                关闭
              </Button>
            </div>
          </div>
        </Content>
      </Portal>
    </Root>
  )
}
