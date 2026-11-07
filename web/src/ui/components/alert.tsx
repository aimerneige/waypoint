export function Alert({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="banner rounded-md">
      {children}
    </div>
  )
}
