import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { DraggableControllerBar } from './DraggableControllerBar'
import type { ControllerPlacement } from './controllerPosition'

const placement: ControllerPlacement = {
  position: { x: 400, y: 500 },
  viewport: { width: 1200, height: 800 },
  safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  controllerSize: { width: 700, height: 60 },
  setPosition: vi.fn(),
  setControllerSize: vi.fn(),
  resetPosition: vi.fn(),
}

describe('draggable animation controller', () => {
  it('renders a compact draggable capsule while minimized', () => {
    const markup = renderToStaticMarkup(
      <DraggableControllerBar
        ariaLabel="Animation controls"
        className="animation-toolbar"
        collapsed
        leftInset={292}
        onCollapsedChange={() => undefined}
        placement={placement}
      >
        <span>Assign step</span>
      </DraggableControllerBar>,
    )

    expect(markup).toContain('Move animation controls')
    expect(markup).toContain('Expand animation controls')
    expect(markup).not.toContain('Assign step')
    expect(markup).toContain('max-width:calc(100vw - 316px)')
  })

  it('shows the complete controls and a minimize action while expanded', () => {
    const markup = renderToStaticMarkup(
      <DraggableControllerBar
        ariaLabel="Animation controls"
        className="animation-toolbar"
        collapsed={false}
        onCollapsedChange={() => undefined}
        placement={placement}
      >
        <span>Assign step</span>
      </DraggableControllerBar>,
    )

    expect(markup).toContain('Minimize animation controls')
    expect(markup).toContain('Assign step')
  })
})
