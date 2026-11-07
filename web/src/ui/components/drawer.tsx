import { Drawer as Primitive } from 'vaul'
export const Drawer = Primitive.Root
export const DrawerPortal = Primitive.Portal
export const DrawerTitle = Primitive.Title
export const DrawerDescription = Primitive.Description
export function DrawerOverlay() {
  return <Primitive.Overlay className="overlay-backdrop" />
}
export function DrawerContent(
  props: React.ComponentProps<typeof Primitive.Content>,
) {
  return (
    <Primitive.Content {...props} className="overlay-content drawer">
      <div className="drawer-handle" />
      {props.children}
    </Primitive.Content>
  )
}
