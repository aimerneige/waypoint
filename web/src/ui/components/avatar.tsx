import * as Primitive from '@radix-ui/react-avatar'
export function Avatar({ src, name }: { src?: string | null; name: string }) {
  return (
    <Primitive.Root className="inline-flex size-11 items-center justify-center overflow-hidden rounded-full bg-accent">
      <Primitive.Image src={src ?? undefined} alt={name} />
      <Primitive.Fallback>{name.slice(0, 1)}</Primitive.Fallback>
    </Primitive.Root>
  )
}
