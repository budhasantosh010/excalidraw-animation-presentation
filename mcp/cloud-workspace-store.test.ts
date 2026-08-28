import { describe, expect, it } from 'vitest'

import { buildAnimationDocument } from './animation-tools.ts'
import type { R2BucketLike } from './cloud-storage.ts'
import { R2WorkspaceStore } from './cloud-workspace-store.ts'

class MemoryBucket implements R2BucketLike {
  readonly objects = new Map<string, { value: string; etag: string; customMetadata?: Record<string, string> }>()
  conflictNextConditionalWrite = false
  readonly getKeys: string[] = []
  private revision = 0

  async get(key: string) {
    this.getKeys.push(key)
    const object = this.objects.get(key)
    return object
      ? { etag: object.etag, text: async () => object.value }
      : null
  }

  async put(
    key: string,
    value: string,
    options?: {
      customMetadata?: Record<string, string>
      onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string }
    },
  ) {
    if (this.conflictNextConditionalWrite && options?.onlyIf?.etagMatches) {
      const current = this.objects.get(key)
      if (current) {
        this.objects.set(key, {
          value: current.value,
          etag: `external-${++this.revision}`,
          customMetadata: current.customMetadata,
        })
      }
      this.conflictNextConditionalWrite = false
    }
    const current = this.objects.get(key)
    if (
      options?.onlyIf?.etagMatches !== undefined &&
      current?.etag !== options.onlyIf.etagMatches
    ) return null
    if (options?.onlyIf?.etagDoesNotMatch === '*' && current) return null
    const stored = {
      value,
      etag: `etag-${++this.revision}`,
      customMetadata: options?.customMetadata,
    }
    this.objects.set(key, stored)
    return { etag: stored.etag }
  }

  async list(options?: { cursor?: string; prefix?: string; include?: ['customMetadata'] }) {
    const keys = [...this.objects.keys()]
      .filter((key) => key.startsWith(options?.prefix ?? ''))
      .sort()
    return {
      objects: keys.map((key) => ({
        key,
        ...(options?.include?.includes('customMetadata')
          ? { customMetadata: this.objects.get(key)?.customMetadata }
          : {}),
      })),
      truncated: false,
    }
  }
}

const snapshot = () => buildAnimationDocument({
  projectName: 'Durable cloud project',
  scenes: [{
    sceneId: 'scene-1',
    title: 'Cloud',
    elements: [{
      id: 'shape',
      type: 'rectangle',
      x: 100,
      y: 120,
      width: 320,
      height: 180,
      text: 'Cloud',
      animation: { step: 1, effect: 'pop' },
    }],
  }],
})

describe('R2 workspace storage', () => {
  it('persists workspaces, projects, optimistic revisions, and history', async () => {
    const bucket = new MemoryBucket()
    const store = new R2WorkspaceStore(bucket)
    const workspace = await store.ensureDefaultWorkspace()
    const project = await store.createProject({
      workspaceId: workspace.id,
      name: 'Launch animation',
      source: 'mcp',
      label: 'Created by ChatGPT',
      snapshot: snapshot(),
      extension: { version: 1, timeline: { version: 2 } },
      assetHashes: [],
    })

    expect(await store.listWorkspaces()).toEqual([workspace])
    expect(await store.listProjects({ workspaceId: workspace.id })).toEqual([
      expect.objectContaining({
        projectId: project.projectId,
        name: 'Launch animation',
        currentRevision: 1,
      }),
    ])
    expect(bucket.getKeys.filter((key) => key.includes('/projects/'))).toEqual([])

    const revisedSnapshot = structuredClone(project.snapshot)
    revisedSnapshot.elements.find(({ id }) => id === 'shape')!.x = 900
    const revised = await store.updateProject(project.projectId, {
      expectedRevision: 1,
      source: 'mcp',
      label: 'Revised by ChatGPT',
      snapshot: revisedSnapshot,
      extension: project.extension,
      assetHashes: [],
    })
    expect(revised.revision.number).toBe(2)
    expect(
      (await store.getProject(project.projectId, { revision: 1 })).snapshot
        .elements.find(({ id }) => id === 'shape')?.x,
    ).toBe(100)
    expect(await store.listRevisions(project.projectId)).toEqual([
      expect.objectContaining({ revisionNumber: 2, isCurrent: true }),
      expect.objectContaining({ revisionNumber: 1, isCurrent: false }),
    ])
  })

  it('supports rename, duplicate, trash, restore, and revision restore', async () => {
    const store = new R2WorkspaceStore(new MemoryBucket())
    const workspace = await store.ensureDefaultWorkspace()
    const project = await store.createProject({
      workspaceId: workspace.id,
      name: 'Original',
      source: 'manual',
      label: 'Created',
      snapshot: snapshot(),
      extension: { version: 1 },
      assetHashes: [],
    })
    const revisionTwo = structuredClone(project.snapshot)
    revisionTwo.elements.find(({ id }) => id === 'shape')!.x = 500
    await store.updateProject(project.projectId, {
      expectedRevision: 1,
      source: 'manual',
      label: null,
      snapshot: revisionTwo,
      extension: project.extension,
      assetHashes: [],
    })

    expect((await store.renameProject(project.projectId, 'Renamed')).name)
      .toBe('Renamed')
    const duplicate = await store.duplicateProject(project.projectId, {
      name: 'Copy',
    })
    expect(duplicate.projectId).not.toBe(project.projectId)
    expect(duplicate.revision.number).toBe(1)
    expect((await store.trashProject(project.projectId)).trash.state).toBe('trashed')
    expect((await store.restoreProject(project.projectId)).trash.state).toBe('active')
    const restored = await store.restoreRevision(project.projectId, 1)
    expect(restored.revision.number).toBe(3)
    expect(restored.snapshot.elements.find(({ id }) => id === 'shape')?.x)
      .toBe(100)
  })

  it('rejects stale conditional updates without overwriting newer data', async () => {
    const bucket = new MemoryBucket()
    const store = new R2WorkspaceStore(bucket)
    const workspace = await store.ensureDefaultWorkspace()
    const project = await store.createProject({
      workspaceId: workspace.id,
      name: 'Conflict',
      source: 'manual',
      label: null,
      snapshot: snapshot(),
      extension: { version: 1 },
      assetHashes: [],
    })
    bucket.conflictNextConditionalWrite = true
    await expect(store.renameProject(project.projectId, 'Stale rename'))
      .rejects.toThrow(/changed|conflict/i)
    expect((await store.getProject(project.projectId)).name).toBe('Conflict')
  })

  it('isolates namespaces and bounds retained full-snapshot history', async () => {
    const bucket = new MemoryBucket()
    const first = new R2WorkspaceStore(bucket, 'web/first', {
      maxProjectBytes: 20_000,
    })
    const second = new R2WorkspaceStore(bucket, 'web/second')
    const firstWorkspace = await first.ensureDefaultWorkspace()
    const secondWorkspace = await second.ensureDefaultWorkspace()
    const created = await first.createProject({
      workspaceId: firstWorkspace.id,
      name: 'Private project',
      source: 'manual',
      label: null,
      snapshot: snapshot(),
      extension: { version: 1 },
      assetHashes: [],
    })

    expect(await second.listProjects({ workspaceId: secondWorkspace.id })).toEqual([])

    let current = created
    for (let index = 0; index < 51; index += 1) {
      current = await first.updateProject(created.projectId, {
        expectedRevision: current.revision.number,
        source: 'autosave',
        label: null,
        snapshot: current.snapshot,
        extension: current.extension,
        assetHashes: current.assetHashes,
      })
    }
    const revisions = await first.listRevisions(created.projectId)
    expect(revisions.length).toBeLessThan(20)
    expect(revisions[0]).toMatchObject({ revisionNumber: 52, isCurrent: true })
    await expect(first.getProject(created.projectId, { revision: 1 }))
      .rejects.toThrow(/not found/i)
  })
})
