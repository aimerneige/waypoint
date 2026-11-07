export function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md bg-accent px-2 py-1 text-accent-foreground">
      {children}
    </span>
  )
}
