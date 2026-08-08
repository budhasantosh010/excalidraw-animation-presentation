import { describe, expect, it } from 'vitest'

import { R2AnimationStore, type R2BucketLike } from './cloud-storage.ts'

const storyboard = {
  projectName: 'Cloud demo',
  scenes: [
    {
      sceneId: 'scene-1',
      title: 'Cloud scene',
      elements: [
        {
          id: 'title',
          type: 'text',
          x: 120,
          y: 100,
          width: 420,
          height: 70,
          text: 'Stored in R2',
          animation: { step: 1, effect: 'fade' },
        },
      ],
    },
  ],
} as const

class MemoryBucket implements R2BucketLike {
  readonly objects = new Map<string, { value: string; etag: string }>()
  conflictNextConditionalWrite = false
  private revision = 0

  async get(key: string) {
    const object = this.objects.get(key)
    return object === undefined
      ? null
      : { etag: object.etag, text: async () => object.value }
  }

  async put(
    key: string,
    value: string,
    options?: {
      onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string }
    },
  ) {
    if (this.conflictNextConditionalWrite && options?.onlyIf?.etagMatches) {
      const current = this.objects.get(key)
      if (current) {
        this.objects.set(key, {
          value: current.value,
          etag: `external-${++this.revision}`,
        })
      }
      this.conflictNextConditionalWrite = false
    }

    const current = this.objects.get(key)
    const condition = options?.onlyIf
    if (
      condition?.etagMatches !== undefined &&
      current?.etag !== condition.etagMatches
    ) {
      return null
    }
    if (
      condition?.etagDoesNotMatch === '*' &&
      current !== undefined
    ) {
      return null
    }

    const stored = { value, etag: `etag-${++this.revision}` }
    this.objects.set(key, stored)
    return { etag: stored.etag }
  }

  async list(options?: { cursor?: string }) {
    const keys = [...this.objects.keys()].sort()
    const offset = Number(options?.cursor ?? 0)
    const page = keys.slice(offset, offset + 1)
    const nextOffset = offset + page.length
    return {
      objects: page.map((key) => ({ key })),
      truncated: nextOffset < keys.length,
      cursor: nextOffset < keys.length ? String(nextOffset) : undefined,
    }
  }
}

describe('R2 animation storage', () => {
  it('creates, reads, lists, validates, and revises durable animations', async () => {
    const bucket = new MemoryBucket()
    const store = new R2AnimationStore(bucket)

    const first = await store.create(storyboard, 'first.excalidraw')
    await store.create(storyboard, 'second.excalidraw')

    expect(first).toMatchObject({
      status: 'created',
      filename: 'first.excalidraw',
      validationStatus: 'valid',
      revision: 1,
      stepCount: 1,
    })
    expect(await store.list()).toEqual([
      'first.excalidraw',
      'second.excalidraw',
    ])
    expect(await store.validate('first.excalidraw')).toMatchObject({
      valid: true,
      sceneCount: 1,
      elementCount: 1,
    })

    await store.revise('first.excalidraw', [
      {
        type: 'change_text',
        elementId: 'title',
        text: 'Updated in the cloud',
      },
    ])

    const revised = await store.read('first.excalidraw')
    expect(
      revised.elements.find((element) => element.id === 'title')?.text,
    ).toBe('Updated in the cloud')
  })

  it('rejects traversal and missing animation files', async () => {
    const store = new R2AnimationStore(new MemoryBucket())

    await expect(
      store.create(storyboard, '../escape.excalidraw'),
    ).rejects.toThrow(/filename/i)
    await expect(store.read('missing.excalidraw')).rejects.toThrow(/not found/i)
  })

  it('rejects duplicate creation without overwriting the existing animation', async () => {
    const store = new R2AnimationStore(new MemoryBucket())
    await store.create(storyboard, 'duplicate.excalidraw')

    await expect(
      store.create(
        { ...storyboard, projectName: 'Replacement' },
        'duplicate.excalidraw',
      ),
    ).rejects.toThrow(/already exists|conflict/i)

    const existing = await store.read('duplicate.excalidraw')
    expect(existing.elements.find((element) => element.id === 'title')?.text).toBe(
      'Stored in R2',
    )
  })

  it('rejects a revision when the R2 object changes after it was read', async () => {
    const bucket = new MemoryBucket()
    const store = new R2AnimationStore(bucket)
    await store.create(storyboard, 'concurrent.excalidraw')
    bucket.conflictNextConditionalWrite = true

    await expect(
      store.revise('concurrent.excalidraw', [
        { type: 'change_text', elementId: 'title', text: 'Stale update' },
      ]),
    ).rejects.toThrow(/changed|conflict/i)

    const existing = await store.read('concurrent.excalidraw')
    expect(existing.elements.find((element) => element.id === 'title')?.text).toBe(
      'Stored in R2',
    )
  })

  it('persists step, effect, and position revisions', async () => {
    const store = new R2AnimationStore(new MemoryBucket())
    await store.create(storyboard, 'revisions.excalidraw')

    await store.revise('revisions.excalidraw', [
      { type: 'set_animation_step', elementId: 'title', step: 4 },
      { type: 'set_animation_effect', elementId: 'title', effect: 'pop' },
      { type: 'move_element', elementId: 'title', x: 640, y: 320 },
    ])

    const document = await store.read('revisions.excalidraw')
    const title = document.elements.find((element) => element.id === 'title')
    expect(title).toMatchObject({ x: 640, y: 320 })
    expect(title?.customData.sanverseAnimation).toMatchObject({
      step: 4,
      effect: 'pop',
    })
  })

  it('rejects invalid cloud revision values without overwriting the project', async () => {
    const store = new R2AnimationStore(new MemoryBucket())
    await store.create(storyboard, 'invalid-revision.excalidraw')

    await expect(
      store.revise('invalid-revision.excalidraw', [
        { type: 'set_animation_step', elementId: 'title', step: 0 },
      ]),
    ).rejects.toThrow(/step/i)

    const document = await store.read('invalid-revision.excalidraw')
    const title = document.elements.find((element) => element.id === 'title')
    expect(title?.customData.sanverseAnimation.step).toBe(1)
  })
})
