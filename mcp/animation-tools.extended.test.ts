import { describe, expect, it } from 'vitest'

import {
  applyRevisionOperations,
  buildAnimationDocument,
  validateAnimationDocument,
} from './animation-tools.ts'

const document = () => buildAnimationDocument({
  projectName: 'Full control',
  scenes: [{
    sceneId: 'scene-a',
    title: 'Opening',
    elements: [
      {
        id: 'box',
        type: 'rectangle',
        x: 100,
        y: 100,
        width: 240,
        height: 120,
        animation: { step: 1, effect: 'pop' },
      },
    ],
  }],
})

describe('full MCP drawing and animation revisions', () => {
  it('updates geometry styles timing grouping scenes and camera atomically', () => {
    const revised = applyRevisionOperations(document(), [
      {
        type: 'update_element',
        elementId: 'box',
        patch: { x: 180, strokeColor: '#ff0000', opacity: 80 },
      },
      {
        type: 'set_animation_timing',
        elementId: 'box',
        durationMs: 1200,
        delayMs: 200,
        easing: 'ease-in-out',
        phase: 'emphasis',
        transform: { x: 80, scale: 1.2, rotate: 15, opacity: 60 },
      },
      {
        type: 'set_animation_group',
        elementId: 'box',
        groupId: 'group-a',
        order: 1,
        intervalMs: 150,
        direction: 'reverse',
      },
      {
        type: 'set_scene',
        elementId: 'frame_scene-a',
        name: 'Strategy',
        order: 2,
        durationMs: 6000,
      },
      {
        type: 'set_camera_track',
        elementId: 'frame_scene-a',
        camera: [
          { atMs: 0 },
          { atMs: 1000, zoom: 1.5, scrollX: -100, scrollY: 50 },
        ],
      },
    ])

    const box = revised.elements.find((element) => element.id === 'box')!
    const frame = revised.elements.find((element) => element.id === 'frame_scene-a')!
    expect(box).toMatchObject({ x: 180, strokeColor: '#ff0000', opacity: 80 })
    expect(box.customData.sanverseAnimation).toMatchObject({
      version: 2,
      timing: {
        durationMs: 1200,
        delayMs: 200,
        easing: 'ease-in-out',
        phase: 'emphasis',
      },
      group: {
        id: 'group-a',
        order: 1,
        intervalMs: 150,
        direction: 'reverse',
      },
    })
    expect(frame.customData.sanverseScene).toMatchObject({
      name: 'Strategy',
      order: 2,
      durationMs: 6000,
      camera: [
        { atMs: 0, zoom: 1, scrollX: 0, scrollY: 0 },
        { atMs: 1000, zoom: 1.5, scrollX: -100, scrollY: 50 },
      ],
    })
    expect(validateAnimationDocument(revised).valid).toBe(true)
  })

  it('duplicates reorders and deletes without mutating the input document', () => {
    const original = document()
    const revised = applyRevisionOperations(original, [
      { type: 'duplicate_element', elementId: 'box', newElementId: 'box-copy', x: 500, y: 100 },
      { type: 'reorder_element', elementId: 'box-copy', index: 0 },
      { type: 'delete_element', elementId: 'box' },
    ])

    expect(original.elements.find((element) => element.id === 'box')?.isDeleted).toBe(false)
    expect(revised.elements[0]?.id).toBe('box-copy')
    expect(revised.elements.find((element) => element.id === 'box')?.isDeleted).toBe(true)
  })

  it('rejects invalid operations without changing the source', () => {
    const original = document()
    expect(() => applyRevisionOperations(original, [
      { type: 'update_element', elementId: 'box', patch: { opacity: 1000 } },
    ])).toThrow(/opacity/i)
    expect(original.elements.find((element) => element.id === 'box')?.opacity).toBe(100)
  })
})
