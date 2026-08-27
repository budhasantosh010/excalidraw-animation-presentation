import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  parseAssetHash,
  parsePersistedProjectJson,
  parseProjectId,
  parseRevisionId,
  parseWorkspaceId,
} from '../persistence/contracts.ts'
import { openPersistenceDatabase, type PersistenceDatabase } from '../persistence/database.ts'
import { createProjectRepository } from '../persistence/project-repository.ts'
import {
  PersistenceConfirmationError,
  PersistenceConflictError,
  PersistenceNameConflictError,
  PersistenceNotFoundError,
} from '../persistence/repository-errors.ts'
import { createWorkspaceRepository } from '../persistence/workspace-repository.ts'
import { createProjectFileService } from './project-file-service.ts'

const roots: string[] = []
const stores: PersistenceDatabase[] = []

const fixture = parsePersistedProjectJson(
  readFileSync(
    new URL('../fixtures/v1-independent-connected-steps.json', import.meta.url),
    'utf8',
  ),
)

const projectIds = Array.from({ length: 8 }, (_, index) =>
  parseProjectId(`prj_${String(index + 1).padStart(32, '0')}`),
)
const revisionIds = Array.from({ length: 8 }, (_, index) =>
  parseRevisionId(`rev_${String(index + 1).padStart(32, '0')}`),
)

const createContext = async () => {
  const root = await mkdtemp(join(tmpdir(), 'sanverse-file-operations-'))
  roots.push(root)
  const store = await openPersistenceDatabase({
    databasePath: join(root, 'projects.sqlite'),
  })
  stores.push(store)

  let projectIndex = 0
  let revisionIndex = 0
  let timestampIndex = 0
  const timestamps = Array.from(
    { length: 16 },
    (_, index) => `2026-08-26T${String(index + 1).padStart(2, '0')}:00:00.000Z`,
  )
  const projectRepository = createProjectRepository(store.database, {
    createProjectId: () => projectIds[projectIndex++]!,
    createRevisionId: () => revisionIds[revisionIndex++]!,
    createTrashId: () => `trash_${String(projectIndex).padStart(32, '0')}`,
    now: () => timestamps[timestampIndex++]!,
  })
  let workspaceIndex = 0
  const workspaceRepository = createWorkspaceRepository(store.database, {
    createId: () =>
      parseWorkspaceId(`ws_${String(++workspaceIndex).padStart(32, '0')}`),
    now: () => '2026-08-26T00:00:00.000Z',
  })
  const source = workspaceRepository.create({ name: 'Source' })
  const target = workspaceRepository.create({ name: 'Target' })
  const scheduleThumbnail = vi.fn()
  const service = createProjectFileService({
    database: store.database,
    projects: projectRepository,
    now: () => timestamps[timestampIndex++]!,
    thumbnailScheduler: { schedule: scheduleThumbnail },
  })
  return {
    store,
    source,
    target,
    projectRepository,
    service,
    scheduleThumbnail,
  }
}

afterEach(async () => {
  for (const store of stores.splice(0)) store.close()
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

const createProject = (
  context: Awaited<ReturnType<typeof createContext>>,
  name = 'Connected concept',
  assetHashes = fixture.assetHashes,
) =>
  context.projectRepository.create({
    workspaceId: context.source.id,
    name,
    source: fixture.revision.source,
    label: fixture.revision.label,
    snapshot: fixture.snapshot,
    extension: fixture.extension,
    assetHashes,
  })

describe('project file operations', () => {
  it('renames an active project canonically without creating a content revision', async () => {
    const context = await createContext()
    const original = createProject(context)

    const renamed = context.service.rename(original.projectId, {
      name: '  Client   Storyboard  ',
    })

    expect(renamed.name).toBe('Client Storyboard')
    expect(renamed.revision).toEqual(original.revision)
    expect(renamed.snapshot).toEqual(original.snapshot)
    expect(
      context.store.database
        .prepare('SELECT COUNT(*) FROM revisions WHERE project_id = ?')
        .pluck()
        .get(original.projectId),
    ).toBe(1)
  })

  it('rejects a canonical rename collision without partial metadata changes', async () => {
    const context = await createContext()
    const original = createProject(context, 'Original')
    createProject(context, 'Client Board')

    expect(() =>
      context.service.rename(original.projectId, { name: ' client   board ' }),
    ).toThrow(PersistenceNameConflictError)
    expect(context.projectRepository.get(original.projectId).name).toBe('Original')
  })

  it('duplicates the exact current snapshot extension and asset links as revision 1', async () => {
    const context = await createContext()
    const hash = parseAssetHash('a'.repeat(64))
    context.store.database
      .prepare(
        'INSERT INTO assets (hash, mime_type, byte_size, storage_path, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(hash, 'image/png', 4, 'aa/aa/asset', '2026-08-26T00:00:00.000Z')
    const original = createProject(context, 'Connected source', [hash])

    const duplicate = context.service.duplicate(original.projectId, {
      name: 'Connected copy',
      targetWorkspaceId: context.target.id,
    })

    expect(duplicate.projectId).not.toBe(original.projectId)
    expect(duplicate.revision.id).not.toBe(original.revision.id)
    expect(duplicate.revision.number).toBe(1)
    expect(duplicate.workspaceId).toBe(context.target.id)
    expect(duplicate.snapshot).toEqual(original.snapshot)
    expect(duplicate.extension).toEqual(original.extension)
    expect(duplicate.assetHashes).toEqual([hash])
    expect(context.projectRepository.get(original.projectId)).toEqual(original)
    expect(context.scheduleThumbnail).toHaveBeenCalledOnce()
    expect(context.scheduleThumbnail).toHaveBeenCalledWith({
      projectId: duplicate.projectId,
      revisionNumber: duplicate.revision.number,
      snapshot: duplicate.snapshot,
    })
  })

  it('rejects a duplicate name collision without creating project revision or asset links', async () => {
    const context = await createContext()
    const original = createProject(context, 'Original')
    createProject(context, 'Existing')
    const before = {
      projects: context.store.database.prepare('SELECT COUNT(*) FROM projects').pluck().get(),
      revisions: context.store.database.prepare('SELECT COUNT(*) FROM revisions').pluck().get(),
      links: context.store.database.prepare('SELECT COUNT(*) FROM project_assets').pluck().get(),
    }

    expect(() =>
      context.service.duplicate(original.projectId, { name: ' existing ' }),
    ).toThrow(PersistenceNameConflictError)
    expect({
      projects: context.store.database.prepare('SELECT COUNT(*) FROM projects').pluck().get(),
      revisions: context.store.database.prepare('SELECT COUNT(*) FROM revisions').pluck().get(),
      links: context.store.database.prepare('SELECT COUNT(*) FROM project_assets').pluck().get(),
    }).toEqual(before)
    expect(context.scheduleThumbnail).not.toHaveBeenCalled()
  })

  it('moves an active project while preserving revisions content and asset links exactly', async () => {
    const context = await createContext()
    const original = createProject(context)
    const revisionRowsBefore = context.store.database
      .prepare('SELECT * FROM revisions WHERE project_id = ? ORDER BY revision_number')
      .all(original.projectId)
    const linksBefore = context.store.database
      .prepare('SELECT * FROM project_assets WHERE project_id = ? ORDER BY asset_hash')
      .all(original.projectId)

    const moved = context.service.move(original.projectId, {
      targetWorkspaceId: context.target.id,
    })

    expect(moved.workspaceId).toBe(context.target.id)
    expect(moved.revision).toEqual(original.revision)
    expect(moved.snapshot).toEqual(original.snapshot)
    expect(
      context.store.database
        .prepare('SELECT * FROM revisions WHERE project_id = ? ORDER BY revision_number')
        .all(original.projectId),
    ).toEqual(revisionRowsBefore)
    expect(
      context.store.database
        .prepare('SELECT * FROM project_assets WHERE project_id = ? ORDER BY asset_hash')
        .all(original.projectId),
    ).toEqual(linksBefore)
  })

  it('rejects a target workspace collision atomically', async () => {
    const context = await createContext()
    const moving = createProject(context, 'Same name')
    context.projectRepository.create({
      workspaceId: context.target.id,
      name: 'same   name',
      source: fixture.revision.source,
      snapshot: fixture.snapshot,
      extension: fixture.extension,
    })

    expect(() =>
      context.service.move(moving.projectId, {
        targetWorkspaceId: context.target.id,
      }),
    ).toThrow(PersistenceNameConflictError)
    expect(context.projectRepository.get(moving.projectId).workspaceId).toBe(
      context.source.id,
    )
  })

  it.each(['rename', 'move', 'duplicate'] as const)(
    'rejects %s while the project is trashed',
    async (operation) => {
      const context = await createContext()
      const original = createProject(context)
      context.projectRepository.trash(original.projectId)

      const action =
        operation === 'rename'
          ? () => context.service.rename(original.projectId, { name: 'Nope' })
          : operation === 'move'
            ? () =>
                context.service.move(original.projectId, {
                  targetWorkspaceId: context.target.id,
                })
            : () =>
                context.service.duplicate(original.projectId, {
                  name: 'Nope copy',
                })

      expect(action).toThrow(PersistenceConflictError)
    },
  )

  it('requires exact project-bound confirmation and trashed state for permanent delete', async () => {
    const context = await createContext()
    const original = createProject(context)
    const otherId = projectIds[7]!

    expect(() =>
      context.service.permanentlyDelete(original.projectId, {
        confirmationProjectId: otherId,
      }),
    ).toThrow(PersistenceConfirmationError)
    expect(() =>
      context.service.permanentlyDelete(original.projectId, {
        confirmationProjectId: original.projectId,
      }),
    ).toThrow(PersistenceConflictError)
    expect(context.projectRepository.get(original.projectId)).toEqual(original)
  })

  it('permanently deletes only a confirmed trashed project and retains shared assets', async () => {
    const context = await createContext()
    const hash = parseAssetHash('b'.repeat(64))
    context.store.database
      .prepare(
        'INSERT INTO assets (hash, mime_type, byte_size, storage_path, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(hash, 'image/png', 4, 'bb/bb/asset', '2026-08-26T00:00:00.000Z')
    const deleted = createProject(context, 'Delete me', [hash])
    const retained = createProject(context, 'Keep me', [hash])
    context.projectRepository.trash(deleted.projectId)

    expect(
      context.service.permanentlyDelete(deleted.projectId, {
        confirmationProjectId: deleted.projectId,
      }),
    ).toEqual({ projectId: deleted.projectId, deleted: true })

    expect(() =>
      context.projectRepository.get(deleted.projectId, { includeTrashed: true }),
    ).toThrow(PersistenceNotFoundError)
    for (const table of ['projects', 'revisions', 'trash', 'project_assets']) {
      expect(
        context.store.database
          .prepare(`SELECT COUNT(*) FROM ${table} WHERE ${table === 'projects' ? 'id' : 'project_id'} = ?`)
          .pluck()
          .get(deleted.projectId),
      ).toBe(0)
    }
    expect(context.projectRepository.get(retained.projectId).assetHashes).toEqual([hash])
    expect(
      context.store.database.prepare('SELECT COUNT(*) FROM assets WHERE hash = ?').pluck().get(hash),
    ).toBe(1)
  })
})
