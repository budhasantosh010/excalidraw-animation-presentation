export const WORKSPACE_SIDEBAR_WIDTH = 292
const WORKSPACE_SIDEBAR_COMPACT_WIDTH = 220
const WORKSPACE_SIDEBAR_COMPACT_BREAKPOINT = 780
const WORKSPACE_SIDEBAR_CONTROL_CLEARANCE = 44

export const getWorkspaceSidebarWidth = (viewportWidth: number) => {
  const safeViewportWidth = Number.isFinite(viewportWidth)
    ? Math.max(0, viewportWidth)
    : WORKSPACE_SIDEBAR_WIDTH
  const preferredWidth =
    safeViewportWidth <= WORKSPACE_SIDEBAR_COMPACT_BREAKPOINT
      ? WORKSPACE_SIDEBAR_COMPACT_WIDTH
      : WORKSPACE_SIDEBAR_WIDTH

  return Math.max(
    0,
    Math.min(preferredWidth, safeViewportWidth - WORKSPACE_SIDEBAR_CONTROL_CLEARANCE),
  )
}

export const getEditorControllerLeftInset = ({
  presentationActive,
  sidebarCollapsed,
  sidebarWidth,
}: {
  presentationActive: boolean
  sidebarCollapsed: boolean
  sidebarWidth: number
}) => (presentationActive || sidebarCollapsed ? 0 : sidebarWidth)
