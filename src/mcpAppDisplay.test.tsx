import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { EditorSnapshot } from './Editor'
import {
  AnimationStudioSurface,
} from './mcpAppDisplay'
import {
  createStudioSession,
  getFullscreenLayout,
  getSafeAreaVariables,
  mergeHostContext,
  requestPresentation,
  requestStudioDisplayMode,
  shouldRequestInlineForKey,
  updateStudioSession,
  type DisplayModeRequester,
} from './mcpAppState'

const snapshot = {
  elements: [
    {
      id: 'shape',
      type: 'rectangle',
      x: 100,
      y: 100,
      width: 320,
      height: 180,
      isDeleted: false,
      customData: {
        sanverseAnimation: {
          version: 1,
          sceneId: 'scene-1',
          step: 1,
          effect: 'pop',
        },
      },
    },
  ],
  appState: {},
  files: {},
  frameId: null,
} as unknown as EditorSnapshot

const surfaceProps = {
  filename: 'demo.excalidraw',
  revision: 4,
  snapshot,
  currentStep: 1,
  stepCount: 3,
  isPlaying: false,
  fullscreenAvailable: true,
  safeAreaInsets: { top: 10, right: 12, bottom: 14, left: 16 },
  containerHeight: 900,
  onTogglePlayback: () => undefined,
  onPresent: () => undefined,
  onRequestFullscreen: () => undefined,
  onRequestInline: () => undefined,
}

describe('MCP App two-mode display', () => {
  it('renders a compact populated preview inline without mounting the editor', () => {
    const renderEditor = vi.fn(() => <div data-testid="full-editor" />)
    const markup = renderToStaticMarkup(
      <AnimationStudioSurface
        {...surfaceProps}
        displayMode="inline"
        presenting={false}
        renderEditor={renderEditor}
        renderPresentation={() => <div data-testid="presentation" />}
      />,
    )

    expect(markup).toContain('demo.excalidraw')
    expect(markup).toContain('Revision 4')
    expect(markup).toContain('1 / 3')
    expect(markup).toContain('Edit / Expand')
    expect(markup).toContain('data-animation-preview="true"')
    expect(markup).not.toContain('data-testid="full-editor"')
    expect(renderEditor).not.toHaveBeenCalled()
  })

  it('mounts the complete editor only in confirmed fullscreen mode', () => {
    const renderEditor = vi.fn(() => <div data-testid="full-editor" />)
    const markup = renderToStaticMarkup(
      <AnimationStudioSurface
        {...surfaceProps}
        displayMode="fullscreen"
        presenting={false}
        renderEditor={renderEditor}
        renderPresentation={() => <div data-testid="presentation" />}
      />,
    )

    expect(markup).toContain('data-testid="full-editor"')
    expect(renderEditor).toHaveBeenCalledOnce()
    expect(markup).not.toContain('data-animation-preview="true"')
  })

  it('uses the host response as the display-mode source of truth', async () => {
    const requester: DisplayModeRequester = {
      requestDisplayMode: vi
        .fn()
        .mockResolvedValue({ mode: 'inline' }),
    }

    await expect(
      requestStudioDisplayMode(requester, 'fullscreen'),
    ).resolves.toBe('inline')
    expect(requester.requestDisplayMode).toHaveBeenCalledWith({
      mode: 'fullscreen',
    })
  })

  it('merges changing host dimensions and display context', () => {
    const merged = mergeHostContext(
      {
        displayMode: 'inline',
        availableDisplayModes: ['inline', 'fullscreen'],
        containerDimensions: { width: 520, height: 390 },
      },
      {
        displayMode: 'fullscreen',
        containerDimensions: { width: 1440, height: 900 },
      },
    )

    expect(merged).toMatchObject({
      displayMode: 'fullscreen',
      availableDisplayModes: ['inline', 'fullscreen'],
      containerDimensions: { width: 1440, height: 900 },
    })
  })

  it('uses explicit host height and safe-area variables in fullscreen', () => {
    expect(getFullscreenLayout(900)).toMatchObject({
      position: 'fixed',
      inset: 0,
      width: '100%',
      height: '900px',
      maxWidth: 'none',
      maxHeight: 'none',
      borderRadius: 0,
      overflow: 'hidden',
    })
    expect(
      getSafeAreaVariables({
        top: 10,
        right: 12,
        bottom: 14,
        left: 16,
      }),
    ).toEqual({
      '--studio-safe-top': '10px',
      '--studio-safe-right': '12px',
      '--studio-safe-bottom': '14px',
      '--studio-safe-left': '16px',
    })
  })

  it('requests inline mode for Escape only while fullscreen', () => {
    expect(shouldRequestInlineForKey('Escape', 'fullscreen')).toBe(true)
    expect(shouldRequestInlineForKey('Escape', 'inline')).toBe(false)
    expect(shouldRequestInlineForKey('Enter', 'fullscreen')).toBe(false)
  })

  it('preserves edited scene and playback state across mode changes', () => {
    const editedSnapshot = {
      ...snapshot,
      elements: [
        ...snapshot.elements,
        { ...snapshot.elements[0], id: 'new-shape', x: 520 },
      ],
      appState: {
        selectedElementIds: { 'new-shape': true },
      },
    } as unknown as EditorSnapshot
    let session = createStudioSession(snapshot)

    session = updateStudioSession(session, {
      type: 'editor-change',
      snapshot: editedSnapshot,
    })
    session = updateStudioSession(session, {
      type: 'playback-change',
      playback: { currentStep: 2, isPlaying: true, playbackSpeed: 1.5 },
    })

    expect(session.snapshot).toBe(editedSnapshot)
    expect(session.dirty).toBe(true)
    expect(session.playback).toEqual({
      currentStep: 2,
      isPlaying: true,
      playbackSpeed: 1.5,
    })
  })

  it('requests fullscreen for Present but still presents if declined', async () => {
    const requester: DisplayModeRequester = {
      requestDisplayMode: vi
        .fn()
        .mockResolvedValue({ mode: 'inline' }),
    }
    const playback = {
      currentStep: 2,
      isPlaying: false,
      playbackSpeed: 1,
    }

    await expect(requestPresentation(requester, playback)).resolves.toEqual({
      displayMode: 'inline',
      presenting: true,
      playback,
    })
  })
})
