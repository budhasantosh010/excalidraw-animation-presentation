import type { CSSProperties } from 'react'
import type {
  McpUiDisplayMode,
  McpUiHostContext,
} from '@modelcontextprotocol/ext-apps'

import type { EditorSnapshot } from './Editor'

export type StudioPlaybackState = {
  currentStep: number
  isPlaying: boolean
  playbackSpeed: number
}

export type StudioSession = {
  snapshot: EditorSnapshot
  playback: StudioPlaybackState
  dirty: boolean
}

type StudioSessionAction =
  | { type: 'editor-change'; snapshot: EditorSnapshot }
  | { type: 'playback-change'; playback: StudioPlaybackState }

export type DisplayModeRequester = {
  requestDisplayMode: (request: {
    mode: McpUiDisplayMode
  }) => Promise<{ mode: McpUiDisplayMode }>
}

export type SafeAreaInsets = NonNullable<
  McpUiHostContext['safeAreaInsets']
>

export const createStudioSession = (
  snapshot: EditorSnapshot,
): StudioSession => ({
  snapshot,
  playback: {
    currentStep: 0,
    isPlaying: false,
    playbackSpeed: 1,
  },
  dirty: false,
})

export const updateStudioSession = (
  session: StudioSession,
  action: StudioSessionAction,
): StudioSession => {
  if (action.type === 'editor-change') {
    return {
      ...session,
      snapshot: action.snapshot,
      dirty: true,
    }
  }
  return {
    ...session,
    playback: action.playback,
  }
}

export const mergeHostContext = (
  current: McpUiHostContext,
  change: McpUiHostContext,
): McpUiHostContext => ({
  ...current,
  ...change,
})

export const requestStudioDisplayMode = async (
  app: DisplayModeRequester,
  mode: McpUiDisplayMode,
): Promise<McpUiDisplayMode> => {
  const result = await app.requestDisplayMode({ mode })
  return result.mode
}

export const requestPresentation = async (
  app: DisplayModeRequester,
  playback: StudioPlaybackState,
) => ({
  displayMode: await requestStudioDisplayMode(app, 'fullscreen'),
  presenting: true as const,
  playback,
})

export const shouldRequestInlineForKey = (
  key: string,
  displayMode: McpUiDisplayMode,
) => key === 'Escape' && displayMode === 'fullscreen'

export const getFullscreenLayout = (
  containerHeight: number | undefined,
): CSSProperties => ({
  position: 'fixed',
  inset: 0,
  width: '100%',
  height:
    containerHeight && containerHeight > 0
      ? `${containerHeight}px`
      : '100dvh',
  maxWidth: 'none',
  maxHeight: 'none',
  borderRadius: 0,
  overflow: 'hidden',
})

export const getSafeAreaVariables = (
  insets: SafeAreaInsets | undefined,
): CSSProperties =>
  ({
    '--studio-safe-top': `${insets?.top ?? 0}px`,
    '--studio-safe-right': `${insets?.right ?? 0}px`,
    '--studio-safe-bottom': `${insets?.bottom ?? 0}px`,
    '--studio-safe-left': `${insets?.left ?? 0}px`,
  }) as CSSProperties
