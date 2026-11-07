import { Drawer as Primitive } from 'vaul'
export const Drawer = Primitive.Root
export const NestedDrawer = Primitive.NestedRoot
export const DrawerPortal = Primitive.Portal
export const DrawerTitle = Primitive.Title
export const DrawerDescription = Primitive.Description
export function DrawerOverlay(
  props: React.ComponentProps<typeof Primitive.Overlay>,
) {
  return <Primitive.Overlay {...props} className="overlay-backdrop" />
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
