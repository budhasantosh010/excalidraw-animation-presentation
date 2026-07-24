import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useApp } from '@modelcontextprotocol/ext-apps/react'
import type {
  McpUiDisplayMode,
  McpUiHostContext,
} from '@modelcontextprotocol/ext-apps'
import '@excalidraw/excalidraw/index.css'
import './App.css'

import {
  getAutoplayIntervalMs,
  getStepCount,
} from './animation'
import { Editor, type EditorSnapshot } from './Editor'
import {
  AnimationStudioSurface,
} from './mcpAppDisplay'
import {
  createStudioSession,
  mergeHostContext,
  requestPresentation,
  requestStudioDisplayMode,
  shouldRequestInlineForKey,
  updateStudioSession,
  type StudioPlaybackState,
  type StudioSession,
} from './mcpAppState'
import {
  parseMcpAppProject,
  type McpAppProject,
} from './mcpAppSnapshot'
import { Presentation } from './Presentation'
import { useControllerPlacement } from './useControllerPlacement'

const getFixedDimension = (
  dimensions: McpUiHostContext['containerDimensions'],
  key: 'height' | 'width',
) => {
  if (!dimensions || !(key in dimensions)) return undefined
  const value = (dimensions as Record<string, unknown>)[key]
  return typeof value === 'number' && value > 0 ? value : undefined
}

export function AnimationStudioApp() {
  const [project, setProject] = useState<McpAppProject | null>(null)
  const [session, setSession] = useState<StudioSession | null>(null)
  const [presentationSnapshot, setPresentationSnapshot] =
    useState<EditorSnapshot | null>(null)
  const [presenting, setPresenting] = useState(false)
  const [hostContext, setHostContext] = useState<McpUiHostContext>({
    displayMode: 'inline',
  })
  const [loadError, setLoadError] = useState<string | null>(null)
  const requestedFilename = useRef<string | undefined>(undefined)

  const { app, isConnected, error: connectionError } = useApp({
    appInfo: {
      name: 'Sanverse Animation Studio',
      version: '1.0.0',
    },
    capabilities: {
      availableDisplayModes: ['inline', 'fullscreen'],
    },
    onAppCreated: (createdApp) => {
      createdApp.ontoolinput = (input) => {
        const filename = input.arguments?.filename
        requestedFilename.current =
          typeof filename === 'string' ? filename : undefined
      }
      createdApp.ontoolresult = (result) => {
        try {
          const nextProject = parseMcpAppProject(
            result,
            requestedFilename.current,
          )
          setProject(nextProject)
          setSession(createStudioSession(nextProject.snapshot))
          setPresentationSnapshot(null)
          setPresenting(false)
          setLoadError(null)
        } catch (error) {
          setProject(null)
          setSession(null)
          setLoadError(
            error instanceof Error
              ? error.message
              : 'Project data could not be parsed.',
          )
        }
      }
      createdApp.onhostcontextchanged = (change) => {
        setHostContext((current) => mergeHostContext(current, change))
        if (change.displayMode === 'inline') {
          setPresenting(false)
        }
      }
    },
  })

  useEffect(() => {
    if (!app) return
    const initialContext = app.getHostContext()
    if (initialContext) {
      setHostContext((current) =>
        mergeHostContext(current, initialContext),
      )
    }
  }, [app])

  const displayMode: McpUiDisplayMode =
    hostContext.displayMode === 'fullscreen' ? 'fullscreen' : 'inline'
  const fullscreenAvailable = Boolean(
    hostContext.availableDisplayModes?.includes('fullscreen'),
  )
  const containerHeight = getFixedDimension(
    hostContext.containerDimensions,
    'height',
  )
  const containerWidth = getFixedDimension(
    hostContext.containerDimensions,
    'width',
  )
  const controllerPlacement = useControllerPlacement(
    {
      width: containerWidth,
      height: containerHeight,
    },
    hostContext.safeAreaInsets,
  )
  const stepCount = useMemo(
    () => getStepCount(session?.snapshot.elements ?? []),
    [session?.snapshot.elements],
  )

  useEffect(() => {
    const root = document.getElementById('root')
    if (displayMode === 'fullscreen') {
      const height = containerHeight
        ? `${containerHeight}px`
        : '100dvh'
      document.documentElement.style.height = height
      document.body.style.height = height
      if (root) root.style.height = height
      return
    }
    document.documentElement.style.height = ''
    document.body.style.height = ''
    if (root) root.style.height = ''
  }, [containerHeight, displayMode])

  const applyDisplayMode = useCallback(
    (mode: McpUiDisplayMode) => {
      setHostContext((current) => ({
        ...current,
        displayMode: mode,
      }))
    },
    [],
  )

  const requestMode = useCallback(
    async (mode: 'inline' | 'fullscreen') => {
      if (!app) return displayMode
      try {
        const confirmedMode = await requestStudioDisplayMode(app, mode)
        applyDisplayMode(confirmedMode)
        return confirmedMode
      } catch (error) {
        setLoadError(
          error instanceof Error
            ? error.message
            : `Could not request ${mode} mode.`,
        )
        return displayMode
      }
    },
    [app, applyDisplayMode, displayMode],
  )

  const handleRequestFullscreen = useCallback(() => {
    if (!fullscreenAvailable) return
    void requestMode('fullscreen')
  }, [fullscreenAvailable, requestMode])

  const handleRequestInline = useCallback(() => {
    setPresenting(false)
    void requestMode('inline')
  }, [requestMode])

  useEffect(() => {
    if (displayMode !== 'fullscreen' || presenting) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!shouldRequestInlineForKey(event.key, displayMode)) return
      const target = event.target
      if (
        target instanceof Element &&
        target.closest(
          'input, textarea, select, [contenteditable="true"]',
        )
      ) {
        return
      }
      event.preventDefault()
      handleRequestInline()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () =>
      window.removeEventListener('keydown', handleKeyDown, true)
  }, [displayMode, handleRequestInline, presenting])

  const setPlayback = useCallback(
    (playback: StudioPlaybackState) => {
      setSession((current) =>
        current
          ? updateStudioSession(current, {
              type: 'playback-change',
              playback,
            })
          : current,
      )
    },
    [],
  )

  useEffect(() => {
    if (
      !session?.playback.isPlaying ||
      presenting ||
      displayMode !== 'inline'
    ) {
      return
    }
    if (session.playback.currentStep >= stepCount) {
      setPlayback({
        ...session.playback,
        isPlaying: false,
      })
      return
    }
    const delay =
      session.playback.currentStep === 0
        ? 140
        : getAutoplayIntervalMs(session.playback.playbackSpeed)
    const timer = window.setTimeout(() => {
      setPlayback({
        ...session.playback,
        currentStep: Math.min(
          stepCount,
          session.playback.currentStep + 1,
        ),
      })
    }, delay)
    return () => window.clearTimeout(timer)
  }, [displayMode, presenting, session?.playback, setPlayback, stepCount])

  const handleTogglePreview = useCallback(() => {
    if (!session || !stepCount) return
    const atEnd = session.playback.currentStep >= stepCount
    setPlayback({
      ...session.playback,
      currentStep: atEnd ? 0 : session.playback.currentStep,
      isPlaying: !session.playback.isPlaying,
    })
  }, [session, setPlayback, stepCount])

  const openPresentation = useCallback(
    async (snapshot: EditorSnapshot) => {
      if (!app || !session) return
      setPresentationSnapshot(snapshot)
      if (fullscreenAvailable) {
        try {
          const result = await requestPresentation(
            app,
            session.playback,
          )
          applyDisplayMode(result.displayMode)
        } catch {
          applyDisplayMode('inline')
        }
      }
      setPresenting(true)
    },
    [
      app,
      applyDisplayMode,
      fullscreenAvailable,
      session,
    ],
  )

  const handlePresentFromPreview = useCallback(() => {
    if (session) void openPresentation(session.snapshot)
  }, [openPresentation, session])

  const handleEditorSnapshotChange = useCallback(
    (snapshot: EditorSnapshot) => {
      setSession((current) =>
        current
          ? updateStudioSession(current, {
              type: 'editor-change',
              snapshot,
            })
          : current,
      )
    },
    [],
  )

  const handlePresentationExit = useCallback(() => {
    setPresenting(false)
    if (displayMode === 'fullscreen') void requestMode('inline')
  }, [displayMode, requestMode])

  const visibleError = connectionError?.message ?? loadError
  if (visibleError) {
    return (
      <main role="alert" style={{ padding: 24, fontFamily: 'system-ui' }}>
        <h1>Animation Studio could not load this project</h1>
        <p>{visibleError}</p>
      </main>
    )
  }

  if (!isConnected || !project || !session) {
    return (
      <main role="status" style={{ padding: 24, fontFamily: 'system-ui' }}>
        <h1>Sanverse Animation Studio</h1>
        <p>
          {isConnected
            ? 'Waiting for the exact project snapshot and revision...'
            : 'Connecting to ChatGPT and loading the project...'}
        </p>
      </main>
    )
  }

  return (
    <AnimationStudioSurface
      filename={project.filename}
      revision={project.revision}
      snapshot={session.snapshot}
      displayMode={displayMode}
      presenting={presenting}
      currentStep={session.playback.currentStep}
      stepCount={stepCount}
      isPlaying={session.playback.isPlaying}
      fullscreenAvailable={fullscreenAvailable}
      safeAreaInsets={hostContext.safeAreaInsets}
      containerHeight={containerHeight}
      onTogglePlayback={handleTogglePreview}
      onPresent={handlePresentFromPreview}
      onRequestFullscreen={handleRequestFullscreen}
      onRequestInline={handleRequestInline}
      renderEditor={() => (
        <div className="editor-layer">
          <Editor
            controllerPlacement={controllerPlacement}
            key={`${project.filename}:${project.revision}`}
            initialSnapshot={session.snapshot}
            showAssetTools={false}
            onSnapshotChange={handleEditorSnapshotChange}
            onPresent={(snapshot) => void openPresentation(snapshot)}
          />
          <output
            className="mcp-studio-project-label"
            aria-live="polite"
          >
            {project.filename} · revision {project.revision}
          </output>
        </div>
      )}
      renderPresentation={() =>
        presentationSnapshot ? (
          <Presentation
            controllerPlacement={controllerPlacement}
            snapshot={presentationSnapshot}
            initialPlaybackState={session.playback}
            onPlaybackStateChange={setPlayback}
            onExit={handlePresentationExit}
          />
        ) : null
      }
    />
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('Animation Studio root element is missing.')
;(
  window as Window & { __SANVERSE_MCP_APP_MOUNTED__?: boolean }
).__SANVERSE_MCP_APP_MOUNTED__ = true
createRoot(root).render(<AnimationStudioApp />)
