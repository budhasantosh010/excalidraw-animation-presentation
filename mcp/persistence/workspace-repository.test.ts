import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'

import {
  createWorkspaceRepository,
} from './workspace-repository.ts'
import {
  PersistenceNameConflictError,
  PersistenceNotFoundError,
} from './repository-errors.ts'

const databases: Database.Database[] = []

const createTestRepository = (
  ids = ['ws_00000000000000000000000000000001'],
  timestamps = ['2026-08-25T01:00:00.000Z'],
) => {
  const database = new Database(':memory:')
  databases.push(database)
  database.exec(`
    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT
    ) STRICT;
  `)
  let idIndex = 0
  let timestampIndex = 0
  return createWorkspaceRepository(database, {
    createId: () => ids[idIndex++]!,
    now: () => timestamps[timestampIndex++]!,
  })
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

describe('workspace repository', () => {
  it('creates and reads a workspace with a normalized name and generated contract-valid ID', () => {
    const repository = createTestRepository()

    const created = repository.create({ name: '  Client   Studio  ' })

    expect(created).toEqual({
      id: 'ws_00000000000000000000000000000001',
      name: 'Client Studio',
      createdAt: '2026-08-25T01:00:00.000Z',
      updatedAt: '2026-08-25T01:00:00.000Z',
      archivedAt: null,
    })
    expect(repository.get(created.id)).toEqual(created)
  })

  it('renames and archives a workspace with injected timestamps', () => {
    const repository = createTestRepository(
      ['ws_00000000000000000000000000000001'],
      [
        '2026-08-25T01:00:00.000Z',
        '2026-08-25T02:00:00.000Z',
        '2026-08-25T03:00:00.000Z',
        '2026-08-25T04:00:00.000Z',
      ],
    )
    const created = repository.create({ name: 'Studio' })

    const renamed = repository.update(created.id, { name: '  Client   Work ' })
    const archived = repository.update(created.id, { archived: true })
    const restored = repository.update(created.id, { archived: false })

    expect(renamed).toMatchObject({
      name: 'Client Work',
      updatedAt: '2026-08-25T02:00:00.000Z',
      archivedAt: null,
    })
    expect(archived).toMatchObject({
      name: 'Client Work',
      updatedAt: '2026-08-25T03:00:00.000Z',
      archivedAt: '2026-08-25T03:00:00.000Z',
    })
    expect(restored).toMatchObject({
      updatedAt: '2026-08-25T04:00:00.000Z',
      archivedAt: null,
    })
  })

  it('enforces canonical workspace-name uniqueness and exposes a typed conflict', () => {
    const repository = createTestRepository(
      [
        'ws_00000000000000000000000000000001',
        'ws_00000000000000000000000000000002',
      ],
      [
        '2026-08-25T01:00:00.000Z',
        '2026-08-25T02:00:00.000Z',
      ],
    )
    repository.create({ name: 'Client Studio' })

    expect(() => repository.create({ name: ' client   studio ' })).toThrow(
      PersistenceNameConflictError,
    )
    expect(repository.list()).toHaveLength(1)
  })

  it('lists deterministically and excludes archived workspaces unless requested', () => {
    const repository = createTestRepository(
      [
        'ws_00000000000000000000000000000003',
        'ws_00000000000000000000000000000002',
        'ws_00000000000000000000000000000001',
      ],
      [
        '2026-08-25T01:00:00.000Z',
        '2026-08-25T01:00:00.000Z',
        '2026-08-25T01:00:00.000Z',
        '2026-08-25T02:00:00.000Z',
      ],
    )
    const zeta = repository.create({ name: 'Zeta' })
    repository.create({ name: 'alpha' })
    repository.create({ name: 'Beta' })
    repository.update(zeta.id, { archived: true })

    expect(repository.list().map(({ name }) => name)).toEqual(['alpha', 'Beta'])
    expect(
      repository.list({ includeArchived: true }).map(({ name }) => name),
    ).toEqual(['alpha', 'Beta', 'Zeta'])
  })

  it('fails with a typed not-found error and rejects empty canonical names', () => {
    const repository = createTestRepository()

    expect(() =>
      repository.get('ws_ffffffffffffffffffffffffffffffff' as never),
    ).toThrow(PersistenceNotFoundError)
    expect(() => repository.create({ name: '   ' })).toThrow(/workspace name/i)
  })
})
