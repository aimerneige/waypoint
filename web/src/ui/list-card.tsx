import type { ReactNode } from 'react'
export function ListCard({
  title,
  status,
  menu,
  secondary,
  description,
  children,
}: {
  title: ReactNode
  status?: ReactNode
  menu?: ReactNode
  secondary?: ReactNode
  description?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="list-card">
      <div className="list-card-title">
        <div className="list-card-heading">{title}</div>
        {status && <span className="badge">{status}</span>}
        {menu}
      </div>
      {secondary && <div className="list-card-secondary">{secondary}</div>}
      {description && (
        <div className="list-card-description">{description}</div>
      )}
      {children}
    </div>
  )
}
