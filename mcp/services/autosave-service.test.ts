import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  parseAssetHash,
  parsePersistedProjectJson,
  type PersistedProjectRecord,
} from '../persistence/contracts.ts'
import {
  openPersistenceDatabase,
  type PersistenceDatabase,
} from '../persistence/database.ts'
import { createProjectRepository } from '../persistence/project-repository.ts'
import { PersistenceAssetReferenceError } from '../persistence/repository-errors.ts'
import { createWorkspaceRepository } from '../persistence/workspace-repository.ts'
import {
  AutosaveConflictError,
  computeAutosaveContentHash,
  createAutosaveService,
} from './autosave-service.ts'

const fixture = parsePersistedProjectJson(
  readFileSync(
    new URL('../fixtures/v1-independent-connected-steps.json', import.meta.url),
    'utf8',
  ),
)

const roots: string[] = []
const stores: PersistenceDatabase[] = []

const makeId = (prefix: 'prj' | 'rev', value: number) =>
  `${prefix}_${value.toString(16).padStart(32, '0')}`

const createContext = async () => {
  const root = await mkdtemp(join(tmpdir(), 'sanverse-autosave-'))
  roots.push(root)
  const store = await openPersistenceDatabase({
    databasePath: join(root, 'projects.sqlite'),
  })
  stores.push(store)
  const workspaces = createWorkspaceRepository(store.database, {
    createId: () => 'ws_a0000000000000000000000000000001',
    now: () => '2026-08-26T00:00:00.000Z',
  })
  const workspace = workspaces.create({ name: 'Production' })
  let projectId = 1
  let revisionId = 1
  let timestamp = 0
  const projects = createProjectRepository(store.database, {
    createProjectId: () => makeId('prj', projectId++),
    createRevisionId: () => makeId('rev', revisionId++),
    now: () =>
      new Date(Date.UTC(2026, 7, 26, 1 + timestamp++)).toISOString(),
  })
  const createProject = (name: string) =>
    projects.create({
      workspaceId: workspace.id,
      name,
      source: 'import',
      label: 'Imported baseline',
      snapshot: fixture.snapshot,
      extension: fixture.extension,
      assetHashes: fixture.assetHashes,
    })
  return { store, projects, createProject }
}

const edited = (project: PersistedProjectRecord, marker: string) => ({
  projectId: project.projectId,
  expectedRevision: project.revision.number,
  snapshot: {
    ...structuredClone(project.snapshot),
    appState: { ...project.snapshot.appState, name: marker },
  },
  extension: structuredClone(project.extension),
  assetHashes: [...project.assetHashes],
})

afterEach(async () => {
  vi.useRealTimers()
  for (const store of stores.splice(0)) store.close()
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe('autosave service', () => {
  it('debounces per project, coalesces the newest edit, and isolates projects', async () => {
    vi.useFakeTimers()
    const { store, projects, createProject } = await createContext()
    const first = createProject('First')
    const second = createProject('Second')
    const service = createAutosaveService({
      database: store.database,
      projects,
      debounceMs: 100,
    })

    service.schedule(edited(first, 'obsolete'))
    service.schedule(edited(first, 'newest'))
    service.schedule(edited(second, 'independent'))
    await vi.advanceTimersByTimeAsync(99)
    expect(projects.get(first.projectId).revision.number).toBe(1)
    expect(projects.get(second.projectId).revision.number).toBe(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(projects.get(first.projectId).snapshot.appState).toMatchObject({
      name: 'newest',
    })
    expect(projects.get(second.projectId).snapshot.appState).toMatchObject({
      name: 'independent',
    })
    expect(projects.get(first.projectId).revision.number).toBe(2)
    expect(projects.get(second.projectId).revision.number).toBe(2)
  })

  it('skips identical canonical content without revision or timestamp churn', async () => {
    const { store, projects, createProject } = await createContext()
    const project = createProject('No churn')
    const service = createAutosaveService({ database: store.database, projects })

    service.schedule({
      projectId: project.projectId,
      expectedRevision: project.revision.number,
      snapshot: structuredClone(project.snapshot),
      extension: structuredClone(project.extension),
      assetHashes: [...project.assetHashes],
    })
    const [result] = await service.flush()

    expect(result).toMatchObject({ status: 'unchanged' })
    expect(projects.get(project.projectId)).toEqual(project)
    expect(
      store.database
        .prepare('SELECT COUNT(*) FROM revisions WHERE project_id = ?')
        .pluck()
        .get(project.projectId),
    ).toBe(1)
  })

  it('returns a typed conflict, inserts nothing, and retains recovery state', async () => {
    const { store, projects, createProject } = await createContext()
    const original = createProject('Conflict')
    const service = createAutosaveService({ database: store.database, projects })
    service.schedule(edited(original, 'stale edit'))
    projects.update(original.projectId, {
      expectedRevision: 1,
      source: 'manual',
      label: 'New manual state',
      snapshot: edited(original, 'durable manual').snapshot,
      extension: original.extension,
      assetHashes: original.assetHashes,
    })

    const [result] = await service.flush()

    expect(result).toMatchObject({
      status: 'conflict',
      expectedRevision: 1,
      currentRevision: 2,
    })
    expect(result && 'error' in result ? result.error : null).toBeInstanceOf(
      AutosaveConflictError,
    )
    expect(projects.get(original.projectId).snapshot.appState).toMatchObject({
      name: 'durable manual',
    })
    expect(
      store.database
        .prepare('SELECT COUNT(*) FROM revisions WHERE project_id = ?')
        .pluck()
        .get(original.projectId),
    ).toBe(2)
    expect(service.getRecoveryState(original.projectId)?.snapshot.appState).toMatchObject(
      { name: 'stale edit' },
    )
  })

  it('creates one unlabeled autosave revision and preserves named manual revisions', async () => {
    const { store, projects, createProject } = await createContext()
    const original = createProject('History')
    const manual = projects.update(original.projectId, {
      expectedRevision: 1,
      source: 'manual',
      label: 'Approved composition',
      snapshot: edited(original, 'manual').snapshot,
      extension: original.extension,
      assetHashes: original.assetHashes,
    })
    const service = createAutosaveService({ database: store.database, projects })
    service.schedule(edited(manual, 'autosaved'))

    const [result] = await service.flush()
    const current = projects.get(original.projectId)

    expect(result).toMatchObject({ status: 'saved' })
    expect(current.revision).toMatchObject({
      number: 3,
      source: 'autosave',
      label: null,
    })
    expect(projects.get(original.projectId, { revisionNumber: 2 }).revision).toMatchObject(
      { source: 'manual', label: 'Approved composition' },
    )
  })

  it('detaches queued inputs and validates snapshot and asset membership immediately', async () => {
    const { store, projects, createProject } = await createContext()
    const project = createProject('Detached')
    const service = createAutosaveService({ database: store.database, projects })
    const input = edited(project, 'queued value')
    service.schedule(input)
    input.snapshot.appState.name = 'mutated later'
    await service.flush()

    expect(projects.get(project.projectId).snapshot.appState).toMatchObject({
      name: 'queued value',
    })
    expect(() =>
      service.schedule({ ...edited(projects.get(project.projectId), 'bad'), snapshot: {} }),
    ).toThrow(/snapshot/i)
    expect(() =>
      service.schedule({
        ...edited(projects.get(project.projectId), 'asset change'),
        assetHashes: ['a'.repeat(64)],
      }),
    ).toThrow(PersistenceAssetReferenceError)
  })

  it('updates autosave_state consistently with the durable autosave revision', async () => {
    const { store, projects, createProject } = await createContext()
    const project = createProject('State')
    const service = createAutosaveService({ database: store.database, projects })
    const pending = edited(project, 'stateful')
    service.schedule(pending)
    await service.flush()

    const durable = projects.get(project.projectId)
    const row = store.database
      .prepare(
        `SELECT durable_revision_number, content_hash, snapshot_json, updated_at
         FROM autosave_state WHERE project_id = ?`,
      )
      .get(project.projectId) as {
      durable_revision_number: number
      content_hash: string
      snapshot_json: string
      updated_at: string
    }
    expect(row.durable_revision_number).toBe(durable.revision.number)
    expect(row.content_hash).toBe(
      computeAutosaveContentHash({
        snapshot: durable.snapshot,
        extension: durable.extension,
        assetHashes: durable.assetHashes,
      }),
    )
    expect(JSON.parse(row.snapshot_json)).toEqual(durable.snapshot)
    expect(row.updated_at).toBe(durable.updatedAt)
  })

  it('reconciles autosave_state to an identical newer durable revision without creating another revision', async () => {
    const { store, projects, createProject } = await createContext()
    const original = createProject('Reconcile state')
    const service = createAutosaveService({ database: store.database, projects })
    service.schedule(edited(original, 'autosave revision'))
    await service.flush()
    const autosaved = projects.get(original.projectId)
    const manual = projects.update(original.projectId, {
      expectedRevision: autosaved.revision.number,
      source: 'manual',
      label: 'Approved current state',
      snapshot: edited(autosaved, 'manual revision').snapshot,
      extension: autosaved.extension,
      assetHashes: autosaved.assetHashes,
    })

    service.schedule({
      projectId: manual.projectId,
      expectedRevision: manual.revision.number,
      snapshot: structuredClone(manual.snapshot),
      extension: structuredClone(manual.extension),
      assetHashes: [...manual.assetHashes],
    })
    const [result] = await service.flush()

    expect(result).toMatchObject({ status: 'unchanged' })
    const row = store.database
      .prepare(
        `SELECT durable_revision_number, content_hash, snapshot_json, updated_at
         FROM autosave_state WHERE project_id = ?`,
      )
      .get(manual.projectId) as {
      durable_revision_number: number
      content_hash: string
      snapshot_json: string
      updated_at: string
    }
    expect(row).toEqual({
      durable_revision_number: 3,
      content_hash: computeAutosaveContentHash({
        snapshot: manual.snapshot,
        extension: manual.extension,
        assetHashes: manual.assetHashes,
      }),
      snapshot_json: JSON.stringify(manual.snapshot),
      updated_at: manual.updatedAt,
    })
    expect(projects.get(manual.projectId).revision.number).toBe(3)
    expect(
      store.database
        .prepare('SELECT COUNT(*) FROM revisions WHERE project_id = ?')
        .pluck()
        .get(manual.projectId),
    ).toBe(3)
  })

  it('canonicalizes reordered identical asset membership before persisting', async () => {
    const { store, projects } = await createContext()
    const firstHash = parseAssetHash('a'.repeat(64))
    const secondHash = parseAssetHash('b'.repeat(64))
    const insertAsset = store.database.prepare(
      `INSERT INTO assets (hash, mime_type, byte_size, storage_path, created_at)
       VALUES (?, 'image/png', 1, ?, '2026-08-26T00:30:00.000Z')`,
    )
    insertAsset.run(firstHash, 'assets/aa/first.png')
    insertAsset.run(secondHash, 'assets/bb/second.png')
    const workspaceId = store.database
      .prepare('SELECT id FROM workspaces LIMIT 1')
      .pluck()
      .get() as PersistedProjectRecord['workspaceId']
    const project = projects.create({
      workspaceId,
      name: 'Asset order',
      source: 'import',
      snapshot: fixture.snapshot,
      extension: fixture.extension,
      assetHashes: [firstHash, secondHash],
    })
    const service = createAutosaveService({ database: store.database, projects })
    service.schedule({
      ...edited(project, 'asset order changed'),
      assetHashes: [secondHash, firstHash],
    })

    const [result] = await service.flush()

    expect(result).toMatchObject({ status: 'saved' })
    expect(projects.get(project.projectId).assetHashes).toEqual([
      firstHash,
      secondHash,
    ])
  })

  it('flushes cleanly on shutdown and isolates thumbnail and callback failures', async () => {
    vi.useFakeTimers()
    const { store, projects, createProject } = await createContext()
    const project = createProject('Shutdown')
    const scheduleThumbnail = vi.fn(() => {
      throw new Error('renderer unavailable')
    })
    const service = createAutosaveService({
      database: store.database,
      projects,
      debounceMs: 100,
      thumbnailScheduler: { schedule: scheduleThumbnail },
      onError: () => {
        throw new Error('diagnostic callback failed')
      },
    })
    service.schedule(edited(project, 'shutdown flush'))

    const results = await service.shutdown()

    expect(results).toEqual([expect.objectContaining({ status: 'saved' })])
    expect(projects.get(project.projectId).revision.number).toBe(2)
    expect(scheduleThumbnail).toHaveBeenCalledOnce()
    await vi.runAllTimersAsync()
    expect(projects.get(project.projectId).revision.number).toBe(2)
    expect(() => service.schedule(edited(projects.get(project.projectId), 'closed'))).toThrow(
      /shut down/i,
    )
  })

  it('contains unexpected persistence errors without unhandled rejections', async () => {
    const { store, projects, createProject } = await createContext()
    const project = createProject('Error isolation')
    const brokenProjects = {
      ...projects,
      update: () => {
        throw new Error('disk failure')
      },
    }
    const errors: unknown[] = []
    const service = createAutosaveService({
      database: store.database,
      projects: brokenProjects,
      onError: (error) => errors.push(error),
    })
    service.schedule(edited(project, 'pending recovery'))

    await expect(service.flush()).resolves.toEqual([
      expect.objectContaining({ status: 'error' }),
    ])
    expect(errors).toHaveLength(1)
    expect(service.getRecoveryState(project.projectId)).toBeDefined()
  })

  it('consumes rejecting asynchronous diagnostic callbacks without blocking autosave', async () => {
    const { store, projects, createProject } = await createContext()
    const project = createProject('Async diagnostic isolation')
    const brokenProjects = {
      ...projects,
      update: () => {
        throw new Error('disk failure')
      },
    }
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    try {
      const service = createAutosaveService({
        database: store.database,
        projects: brokenProjects,
        onError: async () => {
          await Promise.resolve()
          throw new Error('async diagnostic failure')
        },
      })
      service.schedule(edited(project, 'pending recovery'))

      await expect(service.flush()).resolves.toEqual([
        expect.objectContaining({ status: 'error' }),
      ])
      await new Promise<void>((resolve) => setImmediate(resolve))

      expect(unhandled).toEqual([])
      expect(service.getRecoveryState(project.projectId)).toBeDefined()
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
})
