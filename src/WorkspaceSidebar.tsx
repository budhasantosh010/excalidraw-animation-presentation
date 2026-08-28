import type { ReactNode } from 'react'

export function WorkspaceSidebar({
  children,
  collapsed,
  onCollapsedChange,
}: {
  children: ReactNode
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
}) {
  if (collapsed) {
    return (
      <button
        type="button"
        className="workspace-panel-reopen"
        aria-label="Open workspace panel"
        title="Open workspace panel"
        onClick={() => onCollapsedChange(false)}
      >
        <span aria-hidden="true">›</span>
      </button>
    )
  }

  return (
    <aside className="workspace-sidebar" aria-label="Project workspace">
      <button
        type="button"
        className="workspace-panel-collapse"
        aria-label="Collapse workspace panel"
        title="Collapse workspace panel"
        onClick={() => onCollapsedChange(true)}
      >
        <span aria-hidden="true">‹</span>
      </button>
      <div className="workspace-sidebar-content">{children}</div>
    </aside>
  )
}
