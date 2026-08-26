import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { parsePersistedProjectJson } from '../persistence/contracts.ts'
import {
  openPersistenceDatabase,
  type PersistenceDatabase,
} from '../persistence/database.ts'
import { createProjectRepository } from '../persistence/project-repository.ts'
import { PersistenceConflictError } from '../persistence/repository-errors.ts'
import { createWorkspaceRepository } from '../persistence/workspace-repository.ts'
import { createRevisionHistoryService } from './revision-history-service.ts'

const ordinary = parsePersistedProjectJson(
  readFileSync(
    new URL('../fixtures/ordinary-non-animated.json', import.meta.url),
    'utf8',
  ),
)
const animated = parsePersistedProjectJson(
  readFileSync(
    new URL('../fixtures/v1-independent-connected-steps.json', import.meta.url),
    'utf8',
  ),
)

const roots: string[] = []
const stores: PersistenceDatabase[] = []

const setup = async (maxAutosaveRevisions = 20) => {
  const root = await mkdtemp(join(tmpdir(), 'sanverse-revision-history-'))
  roots.push(root)
  const store = await openPersistenceDatabase({
    databasePath: join(root, 'projects.sqlite'),
  })
  stores.push(store)
  const workspaces = createWorkspaceRepository(store.database, {
    createId: () => 'ws_30000000000000000000000000000001',
    now: () => '2026-08-26T00:00:00.000Z',
  })
  const workspace = workspaces.create({ name: 'History' })
  let revisionId = 0
  let minute = 0
  const projects = createProjectRepository(store.database, {
    createProjectId: () => 'prj_30000000000000000000000000000001',
    createRevisionId: () =>
      `rev_${(++revisionId).toString(16).padStart(32, '0')}`,
    now: () => `2026-08-26T00:${String(++minute).padStart(2, '0')}:00.000Z`,
  })
  const project = projects.create({
    workspaceId: workspace.id,
    name: 'Versioned board',
    source: 'import',
    label: 'Original',
    snapshot: ordinary.snapshot,
    extension: ordinary.extension,
  })
  return {
    store,
    projects,
    project,
    history: createRevisionHistoryService({
      database: store.database,
      projects,
      maxAutosaveRevisions,
    }),
  }
}

afterEach(async () => {
  for (const store of stores.splice(0)) store.close()
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe('revision history service', () => {
  it('lists newest-first revision metadata with useful project summaries', async () => {
    const { projects, project, history } = await setup()
    const second = projects.update(project.projectId, {
      expectedRevision: 1,
      source: 'autosave',
      snapshot: animated.snapshot,
      extension: animated.extension,
    })
    projects.update(project.projectId, {
      expectedRevision: second.revision.number,
      source: 'manual',
      label: 'Approved',
      snapshot: ordinary.snapshot,
      extension: ordinary.extension,
    })

    expect(history.list(project.projectId)).toEqual([
      expect.objectContaining({
        revisionNumber: 3,
        source: 'manual',
        label: 'Approved',
        isCurrent: true,
        elementCount: ordinary.snapshot.elements.length,
      }),
      expect.objectContaining({
        revisionNumber: 2,
        source: 'autosave',
        isCurrent: false,
        animatedElementCount: 2,
        stepCount: 2,
      }),
      expect.objectContaining({
        revisionNumber: 1,
        source: 'import',
        label: 'Original',
      }),
    ])
  })

  it('restores an earlier snapshot as a new revision without mutating newer history', async () => {
    const { projects, project, history } = await setup()
    const second = projects.update(project.projectId, {
      expectedRevision: 1,
      source: 'manual',
      label: 'Animated',
      snapshot: animated.snapshot,
      extension: animated.extension,
    })

    const restored = history.restore(project.projectId, 1)

    expect(restored.revision).toMatchObject({
      number: 3,
      source: 'restore',
      label: 'Restored revision 1',
    })
    expect(restored.snapshot).toEqual(project.snapshot)
    expect(projects.get(project.projectId, { revisionNumber: 2 }).snapshot).toEqual(second.snapshot)
    expect(history.list(project.projectId).map(({ revisionNumber }) => revisionNumber)).toEqual([3, 2, 1])
    expect(() => history.restore(project.projectId, 3)).toThrow(
      PersistenceConflictError,
    )
  })

  it('prunes only old unnamed autosaves while retaining current previous named and durable revisions', async () => {
    const { store, projects, project, history } = await setup(1)
    let current = project
    for (let index = 0; index < 5; index += 1) {
      current = projects.update(project.projectId, {
        expectedRevision: current.revision.number,
        source: 'autosave',
        label: index === 1 ? 'Named autosave' : null,
        snapshot: index % 2 === 0 ? animated.snapshot : ordinary.snapshot,
        extension: index % 2 === 0 ? animated.extension : ordinary.extension,
      })
    }
    store.database.prepare(
      `INSERT INTO autosave_state
         (project_id, durable_revision_number, content_hash, snapshot_json, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(project.projectId, 4, 'hash', '{}', '2026-08-26T00:10:00.000Z')

    expect(history.pruneAutosaves(project.projectId)).toEqual([2])
    expect(history.list(project.projectId).map(({ revisionNumber }) => revisionNumber)).toEqual([6, 5, 4, 3, 1])
    expect(projects.get(project.projectId).revision.number).toBe(6)
  })
})
