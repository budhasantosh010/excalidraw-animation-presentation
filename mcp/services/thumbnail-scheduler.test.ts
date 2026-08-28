import { describe, expect, it, vi } from 'vitest'

import { parseProjectId, parseRevisionNumber } from '../persistence/contracts.ts'
import {
  createThumbnailScheduler,
  type ThumbnailJob,
} from './thumbnail-scheduler.ts'

const projectId = parseProjectId('prj_90000000000000000000000000000001')

const job = (revisionNumber: number): ThumbnailJob => ({
  projectId,
  revisionNumber: parseRevisionNumber(revisionNumber),
  snapshot: {
    type: 'excalidraw' as const,
    version: 2,
    source: 'local',
    elements: [],
    appState: {},
    files: {},
  },
})

describe('thumbnail scheduler', () => {
  it('returns immediately and renders asynchronously', async () => {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const render = vi.fn(() => blocked)
    const scheduler = createThumbnailScheduler({ render })

    expect(scheduler.schedule(job(1))).toBeUndefined()
    expect(render).not.toHaveBeenCalled()

    await Promise.resolve()
    expect(render).toHaveBeenCalledOnce()
    release()
    await scheduler.whenIdle()
  })

  it('coalesces queued obsolete revisions per project', async () => {
    let releaseFirst!: () => void
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const rendered: number[] = []
    const render = vi.fn(async (input: ReturnType<typeof job>) => {
      rendered.push(input.revisionNumber)
      if (input.revisionNumber === 1) await first
    })
    const scheduler = createThumbnailScheduler({ render })

    scheduler.schedule(job(1))
    await Promise.resolve()
    scheduler.schedule(job(2))
    scheduler.schedule(job(3))
    releaseFirst()
    await scheduler.whenIdle()

    expect(rendered).toEqual([1, 3])
  })

  it('does not let an older queued revision displace a newer revision', async () => {
    let releaseFirst!: () => void
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const rendered: number[] = []
    const scheduler = createThumbnailScheduler({
      render: async (input) => {
        rendered.push(input.revisionNumber)
        if (input.revisionNumber === 1) await first
      },
    })

    scheduler.schedule(job(1))
    await Promise.resolve()
    scheduler.schedule(job(3))
    scheduler.schedule(job(2))
    releaseFirst()
    await scheduler.whenIdle()

    expect(rendered).toEqual([1, 3])
  })

  it('isolates renderer failures and continues with the newest queued revision', async () => {
    const failures: unknown[] = []
    const rendered: number[] = []
    const render = vi.fn(async (input: ReturnType<typeof job>) => {
      rendered.push(input.revisionNumber)
      if (input.revisionNumber === 1) throw new Error('renderer unavailable')
    })
    const scheduler = createThumbnailScheduler({
      render,
      onError: (error) => failures.push(error),
    })

    scheduler.schedule(job(1))
    await Promise.resolve()
    scheduler.schedule(job(2))
    await scheduler.whenIdle()

    expect(rendered).toEqual([1, 2])
    expect(failures).toHaveLength(1)
    expect(failures[0]).toBeInstanceOf(Error)
  })
})
