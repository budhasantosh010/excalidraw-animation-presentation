import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import { describe, expect, it } from 'vitest'

import {
  compileTimeline,
  getElementsAtTimelineTime,
  getAnimationDefinition,
  getTimelineScenes,
  sampleSceneCamera,
  sampleTimelineElement,
  getTimelineStepDuration,
  updateAnimationDefinition,
  updateSceneDefinition,
} from './timeline'

const element = (
  id: string,
  customData: Record<string, unknown>,
): ExcalidrawElement =>
  ({
    id,
    type: 'rectangle',
    x: 100,
    y: 200,
    width: 200,
    height: 100,
    angle: 0,
    opacity: 100,
    isDeleted: false,
    groupIds: [],
    boundElements: null,
    customData,
    version: 1,
    versionNonce: 10,
    updated: 1,
  }) as unknown as ExcalidrawElement

describe('timeline compatibility and compiler', () => {
  it('reads v1 animation metadata as a compatible timed entrance', () => {
    const source = element('legacy', {
      sanverseAnimation: {
        version: 1,
        sceneId: 'scene-a',
        step: 2,
        effect: 'fade',
      },
    })

    expect(getAnimationDefinition(source)).toMatchObject({
      version: 1,
      sceneId: 'scene-a',
      step: 2,
      effect: 'fade',
      timing: {
        durationMs: 650,
        delayMs: 0,
        easing: 'ease-out',
        phase: 'entrance',
      },
    })
  })

  it('upgrades only selected elements and preserves unknown animation metadata', () => {
    const source = element('box', {
      sanverseAnimation: {
        version: 1,
        sceneId: 'scene-a',
        step: 1,
        effect: 'pop',
        futureField: { keep: true },
      },
      unrelated: 'keep-me',
    })

    const [updated] = updateAnimationDefinition([source], ['box'], {
      durationMs: 1200,
      delayMs: 150,
      easing: 'ease-in-out',
      phase: 'emphasis',
      transform: { x: 80, y: -20, scale: 1.2, rotate: 15, opacity: 60 },
    })

    expect(updated).not.toBe(source)
    expect(updated?.customData?.unrelated).toBe('keep-me')
    expect(updated?.customData?.sanverseAnimation).toMatchObject({
      version: 2,
      sceneId: 'scene-a',
      step: 1,
      effect: 'pop',
      futureField: { keep: true },
      timing: {
        durationMs: 1200,
        delayMs: 150,
        easing: 'ease-in-out',
        phase: 'emphasis',
      },
      transform: { x: 80, y: -20, scale: 1.2, rotate: 15, opacity: 60 },
    })
  })

  it('compiles exact clip timing with deterministic stagger order', () => {
    const first = element('first', {
      sanverseAnimation: {
        version: 2,
        sceneId: 'scene-a',
        step: 2,
        effect: 'fade',
        timing: { durationMs: 500, delayMs: 100, easing: 'linear', phase: 'entrance' },
        group: { id: 'group-a', order: 0, intervalMs: 120, direction: 'forward' },
      },
    })
    const second = element('second', {
      sanverseAnimation: {
        version: 2,
        sceneId: 'scene-a',
        step: 2,
        effect: 'fade',
        timing: { durationMs: 500, delayMs: 100, easing: 'linear', phase: 'entrance' },
        group: { id: 'group-a', order: 1, intervalMs: 120, direction: 'forward' },
      },
    })

    const timeline = compileTimeline([first, second])
    expect(timeline.clips).toMatchObject([
      { elementId: 'first', startMs: 1000, endMs: 1500 },
      { elementId: 'second', startMs: 1120, endMs: 1620 },
    ])
    expect(getTimelineStepDuration(timeline, 2)).toBe(720)
  })

  it('samples movement, scale, rotation and opacity deterministically', () => {
    const source = element('motion', {
      sanverseAnimation: {
        version: 2,
        sceneId: 'scene-a',
        step: 1,
        effect: 'appear',
        timing: { durationMs: 1000, delayMs: 0, easing: 'linear', phase: 'entrance' },
        transform: { x: -100, y: 40, scale: 0.5, rotate: 20, opacity: 0 },
      },
    })
    const clip = compileTimeline([source]).clips[0]!

    expect(sampleTimelineElement(source, clip, 500)).toMatchObject({
      visible: true,
      changes: {
        x: 50,
        y: 220,
        width: 150,
        height: 75,
        angle: expect.closeTo(Math.PI / 18),
        opacity: 50,
      },
    })
  })

  it('hides an exit-phase element after its clip ends', () => {
    const source = element('exit', {
      sanverseAnimation: {
        version: 2,
        sceneId: 'scene-a',
        step: 1,
        effect: 'fade',
        timing: { durationMs: 400, delayMs: 0, easing: 'linear', phase: 'exit' },
      },
    })
    const clip = compileTimeline([source]).clips[0]!

    expect(sampleTimelineElement(source, clip, 500).visible).toBe(false)
  })

  it('treats ordered frames as scenes and clamps camera keyframes', () => {
    const frame = {
      ...element('frame-a', {
        sanverseScene: {
          version: 1,
          sceneId: 'scene-a',
          name: 'Opening',
          order: 2,
          durationMs: 5000,
          camera: [{ atMs: 200, zoom: 99, scrollX: -100, scrollY: 50 }],
        },
      }),
      type: 'frame',
      name: 'Frame fallback',
    } as unknown as ExcalidrawElement

    expect(getTimelineScenes([frame])).toEqual([
      {
        frameId: 'frame-a',
        sceneId: 'scene-a',
        name: 'Opening',
        order: 2,
        durationMs: 5000,
        camera: [{ atMs: 200, zoom: 4, scrollX: -100, scrollY: 50 }],
      },
    ])
  })

  it('updates frame scene metadata without changing Excalidraw grouping', () => {
    const frame = {
      ...element('frame-a', {}),
      type: 'frame',
      name: 'Frame fallback',
    } as unknown as ExcalidrawElement

    const [updated] = updateSceneDefinition([frame], 'frame-a', {
      name: 'Strategy',
      order: 3,
      durationMs: 8000,
      camera: [
        { atMs: 0, zoom: 1, scrollX: 0, scrollY: 0 },
        { atMs: 1000, zoom: 2, scrollX: -200, scrollY: 100 },
      ],
    })

    expect(updated?.groupIds).toEqual([])
    expect(updated?.customData?.sanverseScene).toMatchObject({
      version: 1,
      sceneId: 'frame-a',
      name: 'Strategy',
      order: 3,
      durationMs: 8000,
    })
  })

  it('interpolates the camera independently at an exact timestamp', () => {
    const scene = {
      frameId: 'frame-a',
      sceneId: 'scene-a',
      name: 'Opening',
      order: 0,
      durationMs: 1000,
      camera: [
        { atMs: 0, zoom: 1, scrollX: 0, scrollY: 0 },
        { atMs: 1000, zoom: 2, scrollX: -200, scrollY: 100 },
      ],
    }

    expect(sampleSceneCamera(scene, 500)).toEqual({
      zoom: 1.5,
      scrollX: -100,
      scrollY: 50,
    })
  })

  it('scrubs to the same deterministic element state at an exact timestamp', () => {
    const source = element('scrub', {
      sanverseAnimation: {
        version: 2,
        sceneId: 'scene-a',
        step: 1,
        effect: 'appear',
        timing: { durationMs: 1000, delayMs: 0, easing: 'linear', phase: 'entrance' },
        transform: { x: -100, opacity: 0 },
      },
    })

    const first = getElementsAtTimelineTime([source], 500)
    const second = getElementsAtTimelineTime([source], 500)

    expect(first).toEqual(second)
    expect(first[0]).toMatchObject({ id: 'scrub', x: 50, opacity: 50 })
    expect(getElementsAtTimelineTime([source], -1)).toEqual([])
  })
})
