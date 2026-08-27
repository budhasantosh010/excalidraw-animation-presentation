import type { ReactNode } from 'react'

type SequencePanelProps = {
  children: ReactNode
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
}

export function SequencePanel({
  children,
  collapsed,
  onCollapsedChange,
}: SequencePanelProps) {
  if (collapsed) {
    return (
      <button
        className="sequence-panel-reopen"
        type="button"
        aria-label="Open sequence panel"
        onClick={() => onCollapsedChange(false)}
      >
        Steps
        <span aria-hidden="true">+</span>
      </button>
    )
  }

  return (
    <aside className="sequence-panel" aria-label="Reveal sequence">
      <div className="sequence-panel-header">
        <strong>Sequence</strong>
        <button
          type="button"
          aria-label="Minimize sequence panel"
          onClick={() => onCollapsedChange(true)}
        >
          −
        </button>
      </div>
      {children}
    </aside>
  )
}
