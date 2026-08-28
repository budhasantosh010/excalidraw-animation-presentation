import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildAnimationDocument } from '../mcp/animation-tools.ts'
import { workspaceApi } from './workspaceApi.ts'

class MemoryStorage {
  private readonly values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
  clear() { this.values.clear() }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  get length() { return this.values.size }
}

class MemoryLocks {
  private queue = Promise.resolve()
  request<Result>(_name: string, callback: () => Promise<Result>) {
    const result = this.queue.then(callback)
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }
}

describe('browser workspace API', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage())
    vi.stubGlobal('navigator', { locks: new MemoryLocks() })
  })

  it('persists projects, revisions, lifecycle actions, and workspace isolation locally', async () => {
    const bootstrap = await workspaceApi.bootstrap()
    expect(bootstrap.selectedWorkspaceId).toMatch(/^ws_/)
    const secondWorkspace = await workspaceApi.createWorkspace('Second')
    const snapshot = buildAnimationDocument({
      projectName: 'Browser project',
      scenes: [{
        sceneId: 'scene-1',
        title: 'Browser',
        elements: [{
          id: 'shape',
          type: 'rectangle',
          x: 10,
          y: 20,
          width: 100,
          height: 80,
          animation: { step: 1, effect: 'pop' },
        }],
      }],
    })
    const created = await workspaceApi.createProject({
      workspaceId: bootstrap.selectedWorkspaceId!,
      name: 'Browser project',
      snapshot,
      extension: { version: 1, timeline: { version: 2 } },
    })

    const revised = structuredClone(snapshot)
    revised.elements.find(({ id }) => id === 'shape')!.x = 500
    const saved = await workspaceApi.action(created.projectId, {
      action: 'save',
      expectedRevision: 1,
      snapshot: revised,
      extension: created.extension,
    })
    expect(saved.revision.number).toBe(2)
    expect(await workspaceApi.listRevisions(created.projectId)).toEqual([
      expect.objectContaining({ revisionNumber: 2, isCurrent: true }),
      expect.objectContaining({ revisionNumber: 1, isCurrent: false }),
    ])

    const copy = await workspaceApi.action(created.projectId, {
      action: 'duplicate',
      name: 'Copy',
      targetWorkspaceId: secondWorkspace.id,
    })
    expect(copy.projectId).not.toBe(created.projectId)
    expect(await workspaceApi.listProjects(secondWorkspace.id)).toEqual([
      expect.objectContaining({ name: 'Copy' }),
    ])

    await workspaceApi.action(created.projectId, { action: 'trash' })
    expect(await workspaceApi.listProjects(bootstrap.selectedWorkspaceId!)).toEqual([])
    await workspaceApi.action(created.projectId, { action: 'restore-trash' })
    const restored = await workspaceApi.action(created.projectId, {
      action: 'restore-revision',
      revisionNumber: 1,
    })
    expect(restored.revision.number).toBe(3)
    expect(restored.snapshot.elements.find(({ id }) => id === 'shape')?.x).toBe(10)
  })

  it('bounds autosave history by count and serialized browser-storage bytes', async () => {
    const bootstrap = await workspaceApi.bootstrap()
    const snapshot = buildAnimationDocument({
      projectName: 'Bounded browser project',
      scenes: [{
        sceneId: 'scene-1',
        title: 'Bounded',
        elements: [{
          id: 'copy',
          type: 'text',
          x: 0,
          y: 0,
          width: 800,
          height: 100,
          text: 'initial',
          animation: { step: 1, effect: 'fade' },
        }],
      }],
    })
    let current = await workspaceApi.createProject({
      workspaceId: bootstrap.selectedWorkspaceId!,
      name: 'Bounded browser project',
      snapshot,
      extension: { version: 1 },
    })

    for (let revision = 0; revision < 60; revision += 1) {
      const next = structuredClone(current.snapshot)
      const element = next.elements.find(({ id }) => id === 'copy')!
      element.text = `${revision}:${'x'.repeat(100_000)}`
      current = await workspaceApi.action(current.projectId, {
        action: 'save',
        expectedRevision: current.revision.number,
        snapshot: next,
        extension: current.extension,
      })
    }

    expect((await workspaceApi.listRevisions(current.projectId)).length).toBeLessThan(52)
    const raw = localStorage.getItem('sanverse-browser-workspaces-v1')!
    expect(new TextEncoder().encode(raw).byteLength).toBeLessThanOrEqual(4 * 1024 * 1024)
  })

  it('serializes concurrent tab-style saves before checking revisions', async () => {
    const bootstrap = await workspaceApi.bootstrap()
    const snapshot = buildAnimationDocument({
      projectName: 'Concurrent browser project',
      scenes: [{
        sceneId: 'scene-1',
        title: 'Concurrent',
        elements: [{
          id: 'shape',
          type: 'rectangle',
          x: 10,
          y: 20,
          width: 100,
          height: 80,
          animation: { step: 1, effect: 'pop' },
        }],
      }],
    })
    const created = await workspaceApi.createProject({
      workspaceId: bootstrap.selectedWorkspaceId!,
      name: 'Concurrent browser project',
      snapshot,
      extension: { version: 1 },
    })
    const first = structuredClone(snapshot)
    first.elements[0]!.x = 111
    const second = structuredClone(snapshot)
    second.elements[0]!.x = 222

    const results = await Promise.allSettled([
      workspaceApi.action(created.projectId, {
        action: 'save',
        expectedRevision: 1,
        snapshot: first,
        extension: created.extension,
      }),
      workspaceApi.action(created.projectId, {
        action: 'save',
        expectedRevision: 1,
        snapshot: second,
        extension: created.extension,
      }),
    ])

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1)
    expect((await workspaceApi.getProject(created.projectId)).revision.number).toBe(2)
  })
})
