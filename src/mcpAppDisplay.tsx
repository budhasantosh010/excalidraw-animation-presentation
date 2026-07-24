import type { ReactNode } from 'react'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { McpUiDisplayMode } from '@modelcontextprotocol/ext-apps'

import { compileAtStep } from './animation'
import type { EditorSnapshot } from './Editor'
import {
  getFullscreenLayout,
  getSafeAreaVariables,
  type SafeAreaInsets,
} from './mcpAppState'

const isVisibleElement = (
  element: ExcalidrawElement,
): element is ExcalidrawElement =>
  !element.isDeleted && element.type !== 'frame'

const elementPoints = (element: ExcalidrawElement) => {
  if (!('points' in element) || !Array.isArray(element.points)) return ''
  return element.points
    .map(([x, y]) => `${element.x + x},${element.y + y}`)
    .join(' ')
}

const PreviewElement = ({ element }: { element: ExcalidrawElement }) => {
  const common = {
    stroke: element.strokeColor || '#1b1c21',
    strokeWidth: Math.max(1, element.strokeWidth || 1),
    opacity: Math.max(0, Math.min(1, (element.opacity ?? 100) / 100)),
    fill:
      element.backgroundColor && element.backgroundColor !== 'transparent'
        ? element.backgroundColor
        : 'none',
  }
  if (element.type === 'rectangle' || element.type === 'image') {
    return (
      <rect
        {...common}
        x={element.x}
        y={element.y}
        width={element.width}
        height={element.height}
        rx={element.type === 'rectangle' ? 12 : 2}
      />
    )
  }
  if (element.type === 'ellipse') {
    return (
      <ellipse
        {...common}
        cx={element.x + element.width / 2}
        cy={element.y + element.height / 2}
        rx={Math.abs(element.width / 2)}
        ry={Math.abs(element.height / 2)}
      />
    )
  }
  if (element.type === 'diamond') {
    const midX = element.x + element.width / 2
    const midY = element.y + element.height / 2
    return (
      <polygon
        {...common}
        points={`${midX},${element.y} ${element.x + element.width},${midY} ${midX},${element.y + element.height} ${element.x},${midY}`}
      />
    )
  }
  if (element.type === 'text') {
    return (
      <text
        x={element.x}
        y={element.y + element.fontSize}
        fill={element.strokeColor || '#1b1c21'}
        fontFamily="system-ui, sans-serif"
        fontSize={element.fontSize}
        opacity={common.opacity}
      >
        {element.text}
      </text>
    )
  }
  if (
    element.type === 'line' ||
    element.type === 'arrow' ||
    element.type === 'freedraw'
  ) {
    return (
      <polyline
        points={elementPoints(element)}
        fill="none"
        stroke={common.stroke}
        strokeWidth={common.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={common.opacity}
        markerEnd={
          element.type === 'arrow' ? 'url(#preview-arrowhead)' : undefined
        }
      />
    )
  }
  return null
}

const getPreviewViewBox = (
  snapshot: EditorSnapshot,
  elements: readonly ExcalidrawElement[],
) => {
  const frame = snapshot.frameId
    ? snapshot.elements.find(
        (element) =>
          !element.isDeleted &&
          element.type === 'frame' &&
          element.id === snapshot.frameId,
      )
    : snapshot.elements.find(
        (element) => !element.isDeleted && element.type === 'frame',
      )
  if (frame) {
    return `${frame.x} ${frame.y} ${Math.max(1, frame.width)} ${Math.max(1, frame.height)}`
  }
  if (!elements.length) return '0 0 1600 900'
  const minX = Math.min(...elements.map((element) => element.x))
  const minY = Math.min(...elements.map((element) => element.y))
  const maxX = Math.max(
    ...elements.map((element) => element.x + element.width),
  )
  const maxY = Math.max(
    ...elements.map((element) => element.y + element.height),
  )
  const width = Math.max(1, maxX - minX)
  const height = Math.max(1, maxY - minY)
  const paddedWidth = Math.max(width + 80, (height + 80) * (16 / 9))
  const paddedHeight = paddedWidth * (9 / 16)
  return `${minX - (paddedWidth - width) / 2} ${minY - (paddedHeight - height) / 2} ${paddedWidth} ${paddedHeight}`
}

export function InlineAnimationPreview({
  snapshot,
  currentStep,
}: {
  snapshot: EditorSnapshot
  currentStep: number
}) {
  const visibleElements = compileAtStep(
    snapshot.elements,
    currentStep,
  ).filter(isVisibleElement)
  return (
    <svg
      data-animation-preview="true"
      viewBox={getPreviewViewBox(snapshot, visibleElements)}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`Animation preview at step ${currentStep}`}
    >
      <defs>
        <marker
          id="preview-arrowhead"
          markerWidth="10"
          markerHeight="10"
          refX="9"
          refY="3"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M0,0 L0,6 L9,3 z" fill="context-stroke" />
        </marker>
      </defs>
      {visibleElements.map((element) => (
        <PreviewElement key={element.id} element={element} />
      ))}
    </svg>
  )
}

type AnimationStudioSurfaceProps = {
  filename: string
  revision: number
  snapshot: EditorSnapshot
  displayMode: McpUiDisplayMode
  presenting: boolean
  currentStep: number
  stepCount: number
  isPlaying: boolean
  fullscreenAvailable: boolean
  safeAreaInsets?: SafeAreaInsets
  containerHeight?: number
  onTogglePlayback: () => void
  onPresent: () => void
  onRequestFullscreen: () => void
  onRequestInline: () => void
  renderEditor: () => ReactNode
  renderPresentation: () => ReactNode
}

export function AnimationStudioSurface({
  filename,
  revision,
  snapshot,
  displayMode,
  presenting,
  currentStep,
  stepCount,
  isPlaying,
  fullscreenAvailable,
  safeAreaInsets,
  containerHeight,
  onTogglePlayback,
  onPresent,
  onRequestFullscreen,
  onRequestInline,
  renderEditor,
  renderPresentation,
}: AnimationStudioSurfaceProps) {
  if (presenting) {
    return (
      <section
        className={`mcp-studio-shell mcp-studio-shell--${displayMode}`}
        style={{
          ...(displayMode === 'fullscreen'
            ? getFullscreenLayout(containerHeight)
            : undefined),
          ...getSafeAreaVariables(safeAreaInsets),
        }}
      >
        {renderPresentation()}
      </section>
    )
  }

  if (displayMode === 'fullscreen') {
    return (
      <main
        className="mcp-studio-shell mcp-studio-shell--fullscreen"
        style={{
          ...getFullscreenLayout(containerHeight),
          ...getSafeAreaVariables(safeAreaInsets),
        }}
      >
        <button
          className="mcp-studio-exit"
          type="button"
          onClick={onRequestInline}
        >
          Exit fullscreen
        </button>
        <div className="mcp-studio-editor-region">{renderEditor()}</div>
      </main>
    )
  }

  return (
    <main
      className="mcp-studio-preview"
      style={getSafeAreaVariables(safeAreaInsets)}
    >
      <header className="mcp-studio-preview__header">
        <div>
          <strong>{filename}</strong>
          <span>Revision {revision}</span>
        </div>
        <button
          className="mcp-studio-expand"
          type="button"
          disabled={!fullscreenAvailable}
          aria-disabled={!fullscreenAvailable}
          title={
            fullscreenAvailable
              ? 'Edit in fullscreen'
              : 'Fullscreen is unavailable in this ChatGPT host'
          }
          onClick={onRequestFullscreen}
        >
          {fullscreenAvailable ? 'Edit / Expand' : 'Fullscreen unavailable'}
        </button>
      </header>
      <div className="mcp-studio-preview__canvas">
        <InlineAnimationPreview
          snapshot={snapshot}
          currentStep={currentStep}
        />
      </div>
      <footer className="mcp-studio-preview__controls">
        <span>
          {currentStep} / {stepCount}
        </span>
        <button type="button" onClick={onTogglePlayback}>
          {isPlaying ? 'Pause' : 'Preview'}
        </button>
        <button type="button" onClick={onPresent}>
          Present
        </button>
      </footer>
    </main>
  )
}
