import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { TimelinePanel } from './TimelinePanel'

const animated = {
  id: 'box',
  type: 'rectangle',
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  angle: 0,
  opacity: 100,
  isDeleted: false,
  groupIds: [],
  boundElements: null,
  version: 1,
  versionNonce: 2,
  updated: 1,
  customData: {
    sanverseAnimation: {
      version: 2,
      sceneId: 'scene-a',
      step: 1,
      effect: 'fade',
      timing: {
        durationMs: 1200,
        delayMs: 100,
        easing: 'ease-in-out',
        phase: 'entrance',
      },
    },
  },
} as unknown as ExcalidrawElement

describe('TimelinePanel', () => {
  it('renders compiled clips and precise inspector fields', () => {
    const markup = renderToStaticMarkup(
      <TimelinePanel
        elements={[animated]}
        selectedIds={['box']}
        onChange={() => undefined}
        onSelect={() => undefined}
      />,
    )

    expect(markup).toContain('Timeline')
    expect(markup).toContain('box')
    expect(markup).toContain('Duration')
    expect(markup).toContain('Delay')
    expect(markup).toContain('Easing')
    expect(markup).toContain('Phase')
    expect(markup).toContain('Transform')
    expect(markup).toContain('Animation group')
  })

  it('renders scene and camera controls for a selected frame', () => {
    const frame = {
      ...animated,
      id: 'frame-a',
      type: 'frame',
      name: 'Opening',
      customData: {
        sanverseScene: {
          version: 1,
          sceneId: 'scene-a',
          name: 'Opening',
          order: 0,
          durationMs: 5000,
          camera: [],
        },
      },
    } as unknown as ExcalidrawElement

    const markup = renderToStaticMarkup(
      <TimelinePanel
        elements={[frame]}
        selectedIds={['frame-a']}
        onChange={() => undefined}
        onSelect={() => undefined}
      />,
    )

    expect(markup).toContain('Scene settings')
    expect(markup).toContain('Scene name')
    expect(markup).toContain('Camera start')
    expect(markup).toContain('Camera end')
  })
})
