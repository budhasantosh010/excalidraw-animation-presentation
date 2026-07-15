import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import { describe, expect, it } from 'vitest'
import {
  assignStep,
  bumpAnimationElementVersion,
  compileAtStep,
  getAutoplayIntervalMs,
  getAnimationFrameChanges,
  getElementAnimation,
  getOrderBadgePosition,
  getSelectionClosure,
  getSettledAnimationFrameChanges,
  interpolatePathPoints,
  interpolateOpacity,
  resolveAnimationEffect,
} from './animation'

type FixtureOptions = {
  groupIds?: string[]
  boundElements?: Array<{ id: string; type: 'text' | 'arrow' }>
  containerId?: string | null
}

const element = (
  id: string,
  type: 'rectangle' | 'text' | 'image' | 'arrow' | 'line' | 'freedraw' =
    'rectangle',
  options: FixtureOptions = {},
): ExcalidrawElement =>
  ({
    id,
    type,
    isDeleted: false,
    groupIds: options.groupIds ?? [],
    boundElements: options.boundElements ?? null,
    containerId: options.containerId ?? null,
    customData: undefined,
    version: 1,
    versionNonce: 100,
    updated: 1,
    opacity: 100,
  }) as unknown as ExcalidrawElement

describe('animation scene compiler', () => {
  it('automatically chooses draw-on for strokes and visible entrances for content', () => {
    expect(resolveAnimationEffect(element('arrow', 'arrow'), 'auto')).toBe('draw')
    expect(resolveAnimationEffect(element('line', 'line'), 'auto')).toBe('draw')
    expect(resolveAnimationEffect(element('ink', 'freedraw'), 'auto')).toBe('draw')
    expect(resolveAnimationEffect(element('logo', 'image'), 'auto')).toBe('pop')
    expect(resolveAnimationEffect(element('caption', 'text'), 'auto')).toBe('fade')
    expect(resolveAnimationEffect(element('box'), 'auto')).toBe('fade')
    expect(resolveAnimationEffect(element('override', 'arrow'), 'appear')).toBe(
      'appear',
    )
  })

  it('reveals a multi-segment path by distance instead of point count', () => {
    const points: Array<[number, number]> = [
      [0, 0],
      [10, 0],
      [10, 10],
    ]

    expect(interpolatePathPoints(points, 0)).toEqual([
      [0, 0],
      [0, 0],
    ])
    expect(interpolatePathPoints(points, 0.75)).toEqual([
      [0, 0],
      [10, 0],
      [10, 5],
    ])
    expect(interpolatePathPoints(points, 1)).toEqual(points)
  })

  it('materializes draw-on frames and delays the arrowhead until the stroke completes', () => {
    const sourcePoints: Array<[number, number]> = [
      [0, 0],
      [10, 0],
      [10, 10],
    ]
    const arrow = {
      ...element('path', 'arrow'),
      points: sourcePoints,
      endArrowhead: 'arrow',
    } as unknown as ExcalidrawElement

    expect(getAnimationFrameChanges(arrow, 'draw', 0.75)).toMatchObject({
      points: [
        [0, 0],
        [10, 0],
        [10, 5],
      ],
      endArrowhead: null,
    })
    expect(getAnimationFrameChanges(arrow, 'draw', 1)).toMatchObject({
      points: sourcePoints,
      endArrowhead: 'arrow',
    })
  })

  it('materializes a visible fade frame from the element opacity', () => {
    const caption = {
      ...element('caption', 'text'),
      opacity: 80,
    } as ExcalidrawElement

    expect(getAnimationFrameChanges(caption, 'fade', 0.5)).toEqual({
      opacity: 40,
    })
  })

  it('materializes a centered pop frame for images', () => {
    const logo = {
      ...element('logo', 'image'),
      x: 100,
      y: 200,
      width: 200,
      height: 100,
      opacity: 100,
    } as ExcalidrawElement

    expect(getAnimationFrameChanges(logo, 'pop', 0)).toEqual({
      x: 114,
      y: 207,
      width: 172,
      height: 86,
      opacity: 0,
    })
    expect(getAnimationFrameChanges(logo, 'pop', 1)).toEqual({
      x: 100,
      y: 200,
      width: 200,
      height: 100,
      opacity: 100,
    })
  })

  it('converts playback speed into a bounded autoplay interval', () => {
    expect(getAutoplayIntervalMs(1)).toBe(900)
    expect(getAutoplayIntervalMs(2)).toBe(450)
    expect(getAutoplayIntervalMs(0)).toBe(1800)
  })

  it('settles an earlier step to its final frame before a later step animates', () => {
    const fadingBox = assignStep(
      [element('box')],
      ['box'],
      1,
      'scene-a',
      'fade',
    )[0]!

    expect(getSettledAnimationFrameChanges(fadingBox, 2)).toEqual({
      opacity: 100,
    })
    expect(getSettledAnimationFrameChanges(fadingBox, 1)).toBeUndefined()
  })

  it('bumps a retained element version so Excalidraw repaints it', () => {
    const source = element('retained')
    const bumped = bumpAnimationElementVersion(source)

    expect(bumped).not.toBe(source)
    expect(bumped.version).toBe(source.version + 1)
    expect(bumped.versionNonce).not.toBe(source.versionNonce)
  })

  it('tracks an order badge with the editor pan and zoom', () => {
    expect(
      getOrderBadgePosition(
        { x: 100, y: 200 },
        {
          scrollX: -20,
          scrollY: -30,
          zoom: 2,
          offsetLeft: 5,
          offsetTop: 7,
        },
      ),
    ).toEqual({ x: 165, y: 347 })
  })

  it('includes every live member of a selected group', () => {
    const first = element('first', 'rectangle', { groupIds: ['group-a'] })
    const second = element('second', 'rectangle', { groupIds: ['group-a'] })
    const outside = element('outside')
    const closure = getSelectionClosure(
      [first, second, outside],
      new Set([first.id]),
    )

    expect([...closure]).toEqual(expect.arrayContaining([first.id, second.id]))
    expect(closure.has(outside.id)).toBe(false)
  })

  it('keeps bound text and its container in one closure', () => {
    const container = element('container', 'rectangle', {
      boundElements: [{ id: 'label', type: 'text' }],
    })
    const label = element('label', 'text', { containerId: container.id })
    const closure = getSelectionClosure([container, label], [label.id])

    expect(closure.has(container.id)).toBe(true)
    expect(closure.has(label.id)).toBe(true)
  })

  it('assigns effect metadata without mutating source elements', () => {
    const source = element('source')
    const assigned = assignStep([source], [source.id], 3, 'scene-a', 'fade')

    expect(assigned[0]).not.toBe(source)
    expect(source.customData?.sanverseAnimation).toBeUndefined()
    expect(assigned[0]?.version).toBe(source.version + 1)
    expect(getElementAnimation(assigned[0]!)).toEqual({
      version: 1,
      sceneId: 'scene-a',
      step: 3,
      effect: 'fade',
    })
  })

  it('compiles only elements visible at the requested step', () => {
    const alwaysVisible = element('always')
    const staged = element('staged')
    const assigned = assignStep([alwaysVisible, staged], [staged.id], 2, 'scene-a')

    expect(compileAtStep(assigned, 1).map((item) => item.id)).toEqual([
      alwaysVisible.id,
    ])
    expect(compileAtStep(assigned, 2)).toHaveLength(2)
  })

  it('interpolates fade opacity with clamped progress', () => {
    expect(interpolateOpacity(80, 0)).toBe(0)
    expect(interpolateOpacity(80, 0.5)).toBe(40)
    expect(interpolateOpacity(80, 2)).toBe(80)
  })

  it('retains sanverse animation metadata through an .excalidraw-shaped JSON round-trip', () => {
    const source = element('source')
    const assigned = assignStep([source], [source.id], 4, 'scene-a', 'fade')
    const project = {
      type: 'excalidraw',
      version: 2,
      elements: assigned,
      appState: {},
      files: {},
    }
    const restored = JSON.parse(JSON.stringify(project)) as typeof project

    expect(restored.elements[0]?.customData?.sanverseAnimation).toEqual({
      version: 1,
      sceneId: 'scene-a',
      step: 4,
      effect: 'fade',
    })
  })
})
