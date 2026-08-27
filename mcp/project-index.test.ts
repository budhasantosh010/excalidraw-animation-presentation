import { describe, expect, it } from 'vitest'

import {
  applyRevisionOperations,
  buildAnimationDocument,
  type ExcalidrawDocument,
} from './animation-tools.ts'
import { buildMutationReceipt, buildProjectIndex } from './project-index.ts'

const project = () => buildAnimationDocument({
  projectName: 'Index test',
  scenes: [
    {
      sceneId: 'scene-1',
      title: 'Pricing',
      elements: [
        {
          id: 'card-1',
          type: 'rectangle',
          x: 100,
          y: 100,
          width: 300,
          height: 160,
          text: 'Price',
          animation: { step: 1, effect: 'pop' },
        },
      ],
    },
    {
      sceneId: 'scene-2',
      title: 'Result',
      elements: [
        {
          id: 'result-1',
          type: 'ellipse',
          x: 200,
          y: 200,
          width: 200,
          height: 120,
          text: 'Outcome',
          animation: { step: 2, effect: 'fade' },
        },
      ],
    },
  ],
})

describe('semantic project index', () => {
  it('finds a drawable container by the text in its bound label', () => {
    const index = buildProjectIndex(
      project(),
      { filename: 'index.excalidraw', projectId: 'prj_1', revision: 4 },
      { query: 'Price', limit: 10 },
    )

    expect(index.elements.map((element) => element.id)).toEqual([
      'card-1',
      'card-1__label',
    ])
    expect(index.elements[0]).toMatchObject({
      id: 'card-1',
      text: 'Price',
      boundElementIds: ['card-1__label'],
    })
  })

  it('returns revision-bound pages and rejects a stale cursor', () => {
    const snapshot = project()
    const first = buildProjectIndex(
      snapshot,
      { filename: 'index.excalidraw', revision: 4 },
      { limit: 2 },
    )
    expect(first.pagination).toMatchObject({ returned: 2, total: 4, limit: 2 })
    expect(first.pagination.nextCursor).toEqual(expect.any(String))

    const second = buildProjectIndex(
      snapshot,
      { filename: 'index.excalidraw', revision: 4 },
      { limit: 2, cursor: first.pagination.nextCursor },
    )
    expect(second.elements.map((element) => element.id)).toEqual([
      'result-1',
      'result-1__label',
    ])
    expect(second.pagination).not.toHaveProperty('nextCursor')

    expect(() => buildProjectIndex(
      snapshot,
      { filename: 'index.excalidraw', revision: 5 },
      { limit: 2, cursor: first.pagination.nextCursor },
    )).toThrow(/stale|cursor/i)

    expect(() => buildProjectIndex(
      snapshot,
      { filename: 'other.excalidraw', revision: 4 },
      { limit: 2, cursor: first.pagination.nextCursor },
    )).toThrow(/stale|cursor/i)

    expect(() => buildProjectIndex(
      snapshot,
      { filename: 'index.excalidraw', revision: 4 },
      { query: 'Outcome', limit: 2, cursor: first.pagination.nextCursor },
    )).toThrow(/stale|cursor/i)

    const changed = applyRevisionOperations(snapshot, [
      { type: 'move_element', elementId: 'card-1', x: 999, y: 100 },
    ])
    expect(() => buildProjectIndex(
      changed,
      { filename: 'index.excalidraw', revision: 4 },
      { limit: 2, cursor: first.pagination.nextCursor },
    )).toThrow(/stale|cursor/i)
  })

  it('exposes timing, grouping, scene, camera, and relationship summaries', () => {
    const revised = applyRevisionOperations(project(), [
      {
        type: 'set_animation_timing',
        elementId: 'card-1',
        durationMs: 1200,
        delayMs: 200,
        easing: 'ease-in-out',
        transform: { x: 80, scale: 1.2, rotate: 15, opacity: 60 },
      },
      {
        type: 'set_animation_group',
        elementId: 'card-1',
        groupId: 'cards',
        order: 1,
        intervalMs: 180,
      },
      {
        type: 'set_scene',
        elementId: 'frame_scene-1',
        name: 'Pricing scene',
        durationMs: 6000,
      },
      {
        type: 'set_camera_track',
        elementId: 'frame_scene-1',
        camera: [
          { atMs: 0, zoom: 1, scrollX: 0, scrollY: 0 },
          { atMs: 1000, zoom: 1.4, scrollX: -100, scrollY: -50 },
        ],
      },
    ]) as ExcalidrawDocument

    const index = buildProjectIndex(
      revised,
      { filename: 'index.excalidraw', revision: 2 },
      { elementIds: ['card-1'] },
    )

    expect(index.elements[0]).toMatchObject({
      id: 'card-1',
      sceneId: 'scene-1',
      animation: {
        timing: { durationMs: 1200, delayMs: 200, easing: 'ease-in-out' },
        transform: { x: 80, scale: 1.2, rotate: 15, opacity: 60 },
        group: { id: 'cards', order: 1, intervalMs: 180 },
      },
    })
    expect(index.scenes[0]).toMatchObject({
      id: 'scene-1',
      name: 'Pricing scene',
      durationMs: 6000,
      camera: [
        { atMs: 0, zoom: 1 },
        { atMs: 1000, zoom: 1.4 },
      ],
    })
  })

  it('reports the scene for an affected element beyond the inspection page limit', () => {
    const before = buildAnimationDocument({
      projectName: 'Large receipt',
      scenes: [{
        sceneId: 'scene-1',
        title: 'Large',
        elements: Array.from({ length: 205 }, (_, index) => ({
          id: `box-${index}`,
          type: 'rectangle',
          x: index * 10,
          y: 0,
          width: 8,
          height: 8,
          animation: { step: 1, effect: 'appear' },
        })),
      }],
    })
    const after = applyRevisionOperations(before, [
      { type: 'delete_element', elementId: 'box-204' },
    ])

    const receipt = buildMutationReceipt(before, after, 1, {
      filename: 'large.excalidraw',
      projectId: 'prj_large',
      previousRevision: 1,
      revision: 2,
    })

    expect(receipt.deletedElementIds).toEqual(['box-204'])
    expect(receipt.affectedSceneIds).toEqual(['scene-1'])
    expect(receipt.affectedElements).toEqual([])
    expect(receipt.previousContentFingerprint).not.toBe(receipt.contentFingerprint)
  })
})
