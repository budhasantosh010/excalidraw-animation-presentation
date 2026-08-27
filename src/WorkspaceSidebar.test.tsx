import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  getEditorControllerLeftInset,
  getWorkspaceSidebarWidth,
} from './workspaceLayout'
import { WorkspaceSidebar } from './WorkspaceSidebar'

describe('collapsible workspace sidebar', () => {
  it('keeps the sidebar and its collapse control reachable on narrow viewports', () => {
    expect(getWorkspaceSidebarWidth(1200)).toBe(292)
    expect(getWorkspaceSidebarWidth(640)).toBe(220)
    expect(getWorkspaceSidebarWidth(240)).toBe(196)
  })

  it('releases the sidebar inset while presentation is active', () => {
    expect(
      getEditorControllerLeftInset({
        presentationActive: true,
        sidebarCollapsed: false,
        sidebarWidth: 292,
      }),
    ).toBe(0)
    expect(
      getEditorControllerLeftInset({
        presentationActive: false,
        sidebarCollapsed: false,
        sidebarWidth: 292,
      }),
    ).toBe(292)
  })

  it('shows workspace content and a collapse action while expanded', () => {
    const markup = renderToStaticMarkup(
      <WorkspaceSidebar collapsed={false} onCollapsedChange={() => undefined}>
        <span>Projects</span>
      </WorkspaceSidebar>,
    )

    expect(markup).toContain('Projects')
    expect(markup).toContain('Collapse workspace panel')
    expect(markup).not.toContain('Open workspace panel')
  })

  it('returns the canvas width and leaves a reachable reopen action', () => {
    const markup = renderToStaticMarkup(
      <WorkspaceSidebar collapsed onCollapsedChange={() => undefined}>
        <span>Projects</span>
      </WorkspaceSidebar>,
    )

    expect(markup).not.toContain('Projects')
    expect(markup).toContain('Open workspace panel')
  })
})
