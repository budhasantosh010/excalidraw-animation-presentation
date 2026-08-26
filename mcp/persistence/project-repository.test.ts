import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  parsePersistedProjectJson,
  type AssetHash,
  type PersistedProjectRecord,
  type WorkspaceId,
} from './contracts.ts'
import { openPersistenceDatabase, type PersistenceDatabase } from './database.ts'
import {
  createProjectRepository,
  type ProjectRepositoryDependencies,
} from './project-repository.ts'
import {
  PersistenceAssetReferenceError,
  PersistenceConflictError,
  PersistenceNameConflictError,
  PersistenceNotFoundError,
} from './repository-errors.ts'
import { createWorkspaceRepository } from './workspace-repository.ts'

const roots: string[] = []
const stores: PersistenceDatabase[] = []

const readFixture = (name: string) =>
  parsePersistedProjectJson(
    readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'),
  )

const ordinaryFixture = readFixture('ordinary-non-animated.json')
const connectedFixture = readFixture('v1-independent-connected-steps.json')

const projectIds = [
  'prj_10000000000000000000000000000001',
  'prj_10000000000000000000000000000002',
  'prj_10000000000000000000000000000003',
  'prj_10000000000000000000000000000004',
]
const revisionIds = [
  'rev_10000000000000000000000000000001',
  'rev_10000000000000000000000000000002',
  'rev_10000000000000000000000000000003',
  'rev_10000000000000000000000000000004',
  'rev_10000000000000000000000000000005',
]
const trashIds = [
  'trash_10000000000000000000000000000001',
  'trash_10000000000000000000000000000002',
]

const createTestContext = async (
  timestamps = [
    '2026-08-25T01:00:00.000Z',
    '2026-08-25T02:00:00.000Z',
    '2026-08-25T03:00:00.000Z',
    '2026-08-25T04:00:00.000Z',
    '2026-08-25T05:00:00.000Z',
    '2026-08-25T06:00:00.000Z',
  ],
) => {
  const root = await mkdtemp(join(tmpdir(), 'sanverse-repository-'))
  roots.push(root)
  const store = await openPersistenceDatabase({
    databasePath: join(root, 'projects.sqlite'),
  })
  stores.push(store)

  const workspaceRepository = createWorkspaceRepository(store.database, {
    createId: () => 'ws_10000000000000000000000000000001',
    now: () => '2026-08-25T00:00:00.000Z',
  })
  const workspace = workspaceRepository.create({ name: 'Production' })
  let projectIndex = 0
  let revisionIndex = 0
  let trashIndex = 0
  let timestampIndex = 0
  const dependencies: ProjectRepositoryDependencies = {
    createProjectId: () => projectIds[projectIndex++]!,
    createRevisionId: () => revisionIds[revisionIndex++]!,
    createTrashId: () => trashIds[trashIndex++]!,
    now: () => timestamps[timestampIndex++]!,
  }
  return {
    store,
    workspace,
    repository: createProjectRepository(store.database, dependencies),
  }
}

afterEach(async () => {
  for (const store of stores.splice(0)) store.close()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const createFromFixture = (
  repository: ReturnType<typeof createProjectRepository>,
  workspaceId: WorkspaceId,
  fixture: PersistedProjectRecord,
  name = fixture.name,
) =>
  repository.create({
    workspaceId,
    name,
    source: fixture.revision.source,
    label: fixture.revision.label,
    snapshot: fixture.snapshot,
    extension: fixture.extension,
    assetHashes: fixture.assetHashes,
  })

describe('project and revision repository', () => {
  it('creates revision 1 and round-trips an ordinary canonical snapshot', async () => {
    const { repository, workspace } = await createTestContext()

    const created = createFromFixture(repository, workspace.id, ordinaryFixture)

    expect(created).toMatchObject({
      schemaVersion: 1,
      workspaceId: workspace.id,
      name: ordinaryFixture.name,
      revision: {
        number: 1,
        source: 'import',
        label: 'Sanitized fixture',
        createdAt: '2026-08-25T01:00:00.000Z',
      },
      trash: { state: 'active' },
      createdAt: '2026-08-25T01:00:00.000Z',
      updatedAt: '2026-08-25T01:00:00.000Z',
    })
    expect(repository.get(created.projectId)).toEqual(created)
    expect(created.snapshot).toEqual(ordinaryFixture.snapshot)
    expect(created.extension).toEqual(ordinaryFixture.extension)
  })

  it('writes immutable revisions and preserves independent steps for connected elements', async () => {
    const { repository, store, workspace } = await createTestContext()
    const created = createFromFixture(repository, workspace.id, connectedFixture)
    const changedSnapshot = structuredClone(created.snapshot)
    changedSnapshot.appState = {
      ...changedSnapshot.appState,
      viewBackgroundColor: '#f8f9fa',
    }

    const updated = repository.update(created.projectId, {
      expectedRevision: 1,
      source: 'manual',
      label: 'Background updated',
      snapshot: changedSnapshot,
      extension: created.extension,
      assetHashes: created.assetHashes,
    })

    expect(updated.revision).toMatchObject({ number: 2, source: 'manual' })
    expect(updated.updatedAt).toBe('2026-08-25T02:00:00.000Z')
    expect(
      updated.snapshot.elements.map((element) => ({
        id: element.id,
        animation: element.customData?.sanverseAnimation,
      })),
    ).toEqual(
      connectedFixture.snapshot.elements.map((element) => ({
        id: element.id,
        animation: element.customData?.sanverseAnimation,
      })),
    )
    const oldRevision = repository.get(created.projectId, { revisionNumber: 1 })
    expect(oldRevision.snapshot).toEqual(connectedFixture.snapshot)
    expect(oldRevision.revision.number).toBe(1)
    expect(
      store.database
        .prepare('SELECT revision_number FROM revisions WHERE project_id = ? ORDER BY revision_number')
        .pluck()
        .all(created.projectId),
    ).toEqual([1, 2])
  })

  it('rejects stale writes atomically without inserting a partial revision', async () => {
    const { repository, store, workspace } = await createTestContext()
    const created = createFromFixture(repository, workspace.id, ordinaryFixture)
    repository.update(created.projectId, {
      expectedRevision: 1,
      source: 'manual',
      snapshot: created.snapshot,
      extension: created.extension,
      assetHashes: [],
    })

    expect(() =>
      repository.update(created.projectId, {
        expectedRevision: 1,
        source: 'manual',
        snapshot: created.snapshot,
        extension: created.extension,
        assetHashes: [],
      }),
    ).toThrow(PersistenceConflictError)
    expect(
      store.database.prepare('SELECT COUNT(*) FROM revisions WHERE project_id = ?').pluck().get(created.projectId),
    ).toBe(2)
    expect(repository.get(created.projectId).revision.number).toBe(2)
  })

  it('lists and searches deterministically within one workspace', async () => {
    const { repository, workspace } = await createTestContext()
    createFromFixture(repository, workspace.id, ordinaryFixture, 'Zeta Board')
    createFromFixture(repository, workspace.id, ordinaryFixture, 'alpha plan')
    createFromFixture(repository, workspace.id, ordinaryFixture, 'Beta Alpha')

    expect(repository.list({ workspaceId: workspace.id }).map(({ name }) => name)).toEqual([
      'alpha plan',
      'Beta Alpha',
      'Zeta Board',
    ])
    expect(
      repository.list({ workspaceId: workspace.id, query: '  ALPHA ' }).map(({ name }) => name),
    ).toEqual(['alpha plan', 'Beta Alpha'])
    expect(
      repository.list({ workspaceId: workspace.id, query: '   ' }).map(({ name }) => name),
    ).toEqual(['alpha plan', 'Beta Alpha', 'Zeta Board'])
  })

  it('trashes once, excludes by default, and restores the same project', async () => {
    const { repository, store, workspace } = await createTestContext()
    const created = createFromFixture(repository, workspace.id, ordinaryFixture)

    const trashed = repository.trash(created.projectId)

    expect(trashed.trash).toEqual({
      state: 'trashed',
      id: 'trash_10000000000000000000000000000001',
      trashedAt: '2026-08-25T02:00:00.000Z',
    })
    expect(() => repository.get(created.projectId)).toThrow(PersistenceNotFoundError)
    expect(repository.list({ workspaceId: workspace.id })).toEqual([])
    expect(repository.get(created.projectId, { includeTrashed: true })).toEqual(trashed)
    expect(repository.list({ workspaceId: workspace.id, includeTrashed: true })).toHaveLength(1)
    expect(repository.trash(created.projectId, { includeAlreadyTrashed: true })).toEqual(trashed)
    expect(store.database.prepare('SELECT COUNT(*) FROM trash').pluck().get()).toBe(1)

    const restored = repository.restore(created.projectId)
    expect(restored.trash).toEqual({ state: 'active' })
    expect(repository.get(created.projectId)).toEqual(restored)
    expect(store.database.prepare('SELECT COUNT(*) FROM trash').pluck().get()).toBe(0)
  })

  it('rejects updates to a trashed project without creating a revision', async () => {
    const { repository, store, workspace } = await createTestContext()
    const created = createFromFixture(repository, workspace.id, ordinaryFixture)
    repository.trash(created.projectId)

    expect(() =>
      repository.update(created.projectId, {
        expectedRevision: 1,
        source: 'autosave',
        snapshot: connectedFixture.snapshot,
        extension: connectedFixture.extension,
      }),
    ).toThrow(PersistenceConflictError)
    expect(
      store.database
        .prepare('SELECT COUNT(*) FROM revisions WHERE project_id = ?')
        .pluck()
        .get(created.projectId),
    ).toBe(1)
  })

  it('enforces canonical project-name uniqueness with no partial project', async () => {
    const { repository, store, workspace } = await createTestContext()
    createFromFixture(repository, workspace.id, ordinaryFixture, 'Client Board')

    expect(() =>
      createFromFixture(repository, workspace.id, ordinaryFixture, ' client   board '),
    ).toThrow(PersistenceNameConflictError)
    expect(store.database.prepare('SELECT COUNT(*) FROM projects').pluck().get()).toBe(1)
    expect(store.database.prepare('SELECT COUNT(*) FROM revisions').pluck().get()).toBe(1)
  })

  it('validates all JSON before commit and rejects unknown workspaces', async () => {
    const { repository, store, workspace } = await createTestContext()
    const invalidSnapshot = structuredClone(ordinaryFixture.snapshot) as PersistedProjectRecord['snapshot']
    invalidSnapshot.appState = { value: new Date() } as never

    expect(() =>
      repository.create({
        workspaceId: workspace.id,
        name: 'Invalid JSON',
        source: 'manual',
        snapshot: invalidSnapshot,
        extension: { version: 1 },
        assetHashes: [],
      }),
    ).toThrow(/json|plain/i)
    expect(() =>
      repository.create({
        workspaceId: 'ws_ffffffffffffffffffffffffffffffff' as WorkspaceId,
        name: 'Missing workspace',
        source: 'manual',
        snapshot: ordinaryFixture.snapshot,
        extension: ordinaryFixture.extension,
        assetHashes: [],
      }),
    ).toThrow(PersistenceNotFoundError)
    expect(store.database.prepare('SELECT COUNT(*) FROM projects').pluck().get()).toBe(0)
  })

  it('links only pre-existing assets and fails missing asset references atomically', async () => {
    const { repository, store, workspace } = await createTestContext()
    const existingHash = 'a'.repeat(64) as AssetHash
    const missingHash = 'b'.repeat(64) as AssetHash
    store.database
      .prepare('INSERT INTO assets (hash, mime_type, byte_size, storage_path, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(existingHash, 'image/png', 10, 'assets/aa/file.png', '2026-08-25T00:00:00.000Z')

    const withAsset = repository.create({
      workspaceId: workspace.id,
      name: 'Asset board',
      source: 'manual',
      snapshot: ordinaryFixture.snapshot,
      extension: ordinaryFixture.extension,
      assetHashes: [existingHash],
    })
    expect(repository.get(withAsset.projectId).assetHashes).toEqual([existingHash])

    expect(() =>
      repository.create({
        workspaceId: workspace.id,
        name: 'Missing asset board',
        source: 'manual',
        snapshot: ordinaryFixture.snapshot,
        extension: ordinaryFixture.extension,
        assetHashes: [missingHash],
      }),
    ).toThrow(PersistenceAssetReferenceError)
    expect(store.database.prepare('SELECT COUNT(*) FROM projects').pluck().get()).toBe(1)
    expect(store.database.prepare('SELECT COUNT(*) FROM revisions').pluck().get()).toBe(1)
  })

  it('keeps exact asset membership per immutable revision and updates current links atomically', async () => {
    const { repository, store, workspace } = await createTestContext()
    const firstHash = 'a'.repeat(64) as AssetHash
    const secondHash = 'b'.repeat(64) as AssetHash
    const missingHash = 'c'.repeat(64) as AssetHash
    const addAsset = store.database.prepare(
      'INSERT INTO assets (hash, mime_type, byte_size, storage_path, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    addAsset.run(firstHash, 'image/png', 10, 'assets/aa/first.png', '2026-08-25T00:00:00.000Z')
    addAsset.run(secondHash, 'image/png', 20, 'assets/bb/second.png', '2026-08-25T00:00:00.000Z')
    const created = repository.create({
      workspaceId: workspace.id,
      name: 'Revision assets',
      source: 'manual',
      snapshot: ordinaryFixture.snapshot,
      extension: ordinaryFixture.extension,
      assetHashes: [firstHash],
    })

    const updated = repository.update(created.projectId, {
      expectedRevision: created.revision.number,
      source: 'manual',
      snapshot: connectedFixture.snapshot,
      extension: connectedFixture.extension,
      assetHashes: [secondHash],
    })

    expect(updated.assetHashes).toEqual([secondHash])
    expect(repository.get(created.projectId, { revisionNumber: 1 }).assetHashes).toEqual([firstHash])
    expect(repository.get(created.projectId, { revisionNumber: 2 }).assetHashes).toEqual([secondHash])
    expect(
      store.database.prepare('SELECT asset_hash FROM project_assets WHERE project_id = ? ORDER BY asset_hash').pluck().all(created.projectId),
    ).toEqual([secondHash])
    expect(
      store.database.prepare('SELECT COUNT(*) FROM revision_assets WHERE revision_id IN (?, ?)').pluck().get(created.revision.id, updated.revision.id),
    ).toBe(2)

    expect(() =>
      repository.update(created.projectId, {
        expectedRevision: updated.revision.number,
        source: 'manual',
        snapshot: updated.snapshot,
        extension: updated.extension,
        assetHashes: [missingHash],
      }),
    ).toThrow(PersistenceAssetReferenceError)
    expect(repository.get(created.projectId).revision.number).toBe(2)
  })
})
