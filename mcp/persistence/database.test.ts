import { access, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'

import {
  CURRENT_SCHEMA_VERSION,
  PersistenceMigrationError,
  openPersistenceDatabase,
  type PersistenceMigration,
} from './database.ts'

const temporaryDirectories: string[] = []

const createDatabasePath = async (nested = false) => {
  const root = await mkdtemp(join(tmpdir(), 'sanverse-persistence-'))
  temporaryDirectories.push(root)
  return nested ? join(root, 'nested', 'storage', 'projects.sqlite') : join(root, 'projects.sqlite')
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  )
})

const tableNames = (database: Database.Database) =>
  database
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => (row as { name: string }).name)

describe('persistence database migrations', () => {
  it('creates parent directories and opens the current schema with WAL and foreign keys', async () => {
    const databasePath = await createDatabasePath(true)

    const store = await openPersistenceDatabase({ databasePath })

    expect(store.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(store.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION)
    expect(store.backups).toEqual([])
    expect(store.database.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(store.database.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(tableNames(store.database)).toEqual([
      'assets',
      'autosave_state',
      'project_assets',
      'projects',
      'revisions',
      'schema_migrations',
      'trash',
      'workspaces',
    ])
    await expect(access(dirname(databasePath))).resolves.toBeUndefined()

    store.close()
  })

  it('backs up an existing database before a pending migration', async () => {
    const databasePath = await createDatabasePath()
    const legacy = new Database(databasePath)
    legacy.exec('CREATE TABLE legacy_marker (value TEXT NOT NULL); INSERT INTO legacy_marker VALUES (\'keep-me\')')
    legacy.close()

    const store = await openPersistenceDatabase({ databasePath })

    expect(store.backups).toHaveLength(1)
    expect(store.backups[0]).toMatchObject({
      fromVersion: 0,
      toVersion: 1,
      path: `${databasePath}.pre-migration-v0-to-v1.backup.sqlite`,
    })
    const backup = new Database(store.backups[0]!.path, { readonly: true })
    expect(
      backup.prepare('SELECT value FROM legacy_marker').pluck().get(),
    ).toBe('keep-me')
    expect(backup.pragma('user_version', { simple: true })).toBe(0)
    backup.close()
    store.close()
  })

  it('does not create a redundant backup when the schema is already current', async () => {
    const databasePath = await createDatabasePath()
    const first = await openPersistenceDatabase({ databasePath })
    first.close()

    const before = (await readdir(dirname(databasePath))).filter((name) =>
      name.includes('.pre-migration-'),
    )
    const second = await openPersistenceDatabase({ databasePath })

    expect(second.backups).toEqual([])
    second.close()
    const after = (await readdir(dirname(databasePath))).filter((name) =>
      name.includes('.pre-migration-'),
    )
    expect(after).toEqual(before)
  })

  it('enforces workspace project revision and asset relational constraints', async () => {
    const databasePath = await createDatabasePath()
    const store = await openPersistenceDatabase({ databasePath })
    const database = store.database

    database
      .prepare('INSERT INTO workspaces (id, name, name_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('ws_00000000000000000000000000000001', 'Studio', 'studio', '2026-08-25T00:00:00.000Z', '2026-08-25T00:00:00.000Z')
    expect(() =>
      database
        .prepare('INSERT INTO workspaces (id, name, name_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run('ws_00000000000000000000000000000002', 'STUDIO', 'studio', '2026-08-25T00:00:00.000Z', '2026-08-25T00:00:00.000Z'),
    ).toThrow()
    expect(() =>
      database
        .prepare('INSERT INTO projects (id, workspace_id, name, name_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run('prj_00000000000000000000000000000001', 'ws_missing', 'Project', 'project', '2026-08-25T00:00:00.000Z', '2026-08-25T00:00:00.000Z'),
    ).toThrow()

    database
      .prepare('INSERT INTO projects (id, workspace_id, name, name_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('prj_00000000000000000000000000000001', 'ws_00000000000000000000000000000001', 'Project', 'project', '2026-08-25T00:00:00.000Z', '2026-08-25T00:00:00.000Z')
    database
      .prepare('INSERT INTO revisions (id, project_id, revision_number, source, label, snapshot_json, extension_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('rev_00000000000000000000000000000001', 'prj_00000000000000000000000000000001', 1, 'manual', null, '{}', '{}', '2026-08-25T00:00:00.000Z')
    expect(() =>
      database
        .prepare('INSERT INTO revisions (id, project_id, revision_number, source, label, snapshot_json, extension_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run('rev_00000000000000000000000000000002', 'prj_00000000000000000000000000000001', 1, 'autosave', null, '{}', '{}', '2026-08-25T00:00:00.000Z'),
    ).toThrow()
    expect(() =>
      database
        .prepare('INSERT INTO project_assets (project_id, asset_hash) VALUES (?, ?)')
        .run('prj_00000000000000000000000000000001', 'missing-hash'),
    ).toThrow()

    store.close()
  })

  it('supports one recovery row per project and removes dependent state with its project', async () => {
    const databasePath = await createDatabasePath()
    const store = await openPersistenceDatabase({ databasePath })
    const database = store.database
    const timestamp = '2026-08-25T00:00:00.000Z'
    database.prepare('INSERT INTO workspaces (id, name, name_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('ws_00000000000000000000000000000001', 'Studio', 'studio', timestamp, timestamp)
    database.prepare('INSERT INTO projects (id, workspace_id, name, name_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('prj_00000000000000000000000000000001', 'ws_00000000000000000000000000000001', 'Project', 'project', timestamp, timestamp)
    database.prepare('INSERT INTO autosave_state (project_id, durable_revision_number, content_hash, snapshot_json, updated_at) VALUES (?, ?, ?, ?, ?)').run('prj_00000000000000000000000000000001', 1, 'hash', '{}', timestamp)
    database.prepare('INSERT INTO trash (id, project_id, trashed_at) VALUES (?, ?, ?)').run('trash_00000000000000000000000000000001', 'prj_00000000000000000000000000000001', timestamp)

    expect(() =>
      database.prepare('INSERT INTO trash (id, project_id, trashed_at) VALUES (?, ?, ?)').run('trash_00000000000000000000000000000002', 'prj_00000000000000000000000000000001', timestamp),
    ).toThrow()

    database.prepare('DELETE FROM projects WHERE id = ?').run('prj_00000000000000000000000000000001')
    expect(database.prepare('SELECT COUNT(*) FROM autosave_state').pluck().get()).toBe(0)
    expect(database.prepare('SELECT COUNT(*) FROM trash').pluck().get()).toBe(0)
    store.close()
  })

  it('rolls back a failed migration and exposes a usable pre-migration backup', async () => {
    const databasePath = await createDatabasePath()
    const baseMigration: PersistenceMigration = {
      version: 1,
      name: 'base',
      apply(database) {
        database.exec('CREATE TABLE durable_value (value TEXT NOT NULL); INSERT INTO durable_value VALUES (\'safe\')')
      },
    }
    const first = await openPersistenceDatabase({ databasePath, migrations: [baseMigration] })
    first.close()
    const failingMigration: PersistenceMigration = {
      version: 2,
      name: 'fails',
      apply(database) {
        database.exec('CREATE TABLE partial_change (value TEXT); INSERT INTO table_that_does_not_exist VALUES (1)')
      },
    }

    let failure: unknown
    try {
      await openPersistenceDatabase({
        databasePath,
        migrations: [baseMigration, failingMigration],
      })
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(PersistenceMigrationError)
    expect((failure as PersistenceMigrationError).backups).toEqual([
      {
        fromVersion: 1,
        toVersion: 2,
        path: `${databasePath}.pre-migration-v1-to-v2.backup.sqlite`,
      },
    ])
    const original = new Database(databasePath, { readonly: true })
    expect(original.pragma('user_version', { simple: true })).toBe(1)
    expect(tableNames(original)).not.toContain('partial_change')
    expect(original.prepare('SELECT value FROM durable_value').pluck().get()).toBe('safe')
    original.close()
    const backup = new Database((failure as PersistenceMigrationError).backups[0]!.path, { readonly: true })
    expect(backup.pragma('user_version', { simple: true })).toBe(1)
    expect(backup.prepare('SELECT value FROM durable_value').pluck().get()).toBe('safe')
    backup.close()
  })

  it('fails closed for migration gaps and databases newer than the application', async () => {
    const gapPath = await createDatabasePath()
    const gapMigration: PersistenceMigration = {
      version: 2,
      name: 'gap',
      apply() {},
    }
    await expect(
      openPersistenceDatabase({ databasePath: gapPath, migrations: [gapMigration] }),
    ).rejects.toThrow(/contiguous/i)

    const newerPath = await createDatabasePath()
    const newer = new Database(newerPath)
    newer.pragma('user_version = 99')
    newer.close()
    await expect(openPersistenceDatabase({ databasePath: newerPath })).rejects.toThrow(
      /newer than this application/i,
    )
  })

  it('fails closed when a current-version database is missing its migration ledger and required schema', async () => {
    const databasePath = await createDatabasePath()
    const incomplete = new Database(databasePath)
    incomplete.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`)
    incomplete.close()

    await expect(openPersistenceDatabase({ databasePath })).rejects.toThrow(
      /schema_migrations|migration ledger|required schema/i,
    )

    const reopened = new Database(databasePath)
    expect(reopened.pragma('user_version', { simple: true })).toBe(
      CURRENT_SCHEMA_VERSION,
    )
    reopened.close()
  })

  it('fails closed when the applied migration ledger name does not match the configured migration', async () => {
    const databasePath = await createDatabasePath()
    const first = await openPersistenceDatabase({ databasePath })
    first.database
      .prepare('UPDATE schema_migrations SET name = ? WHERE version = ?')
      .run('unexpected migration identity', CURRENT_SCHEMA_VERSION)
    first.close()

    await expect(openPersistenceDatabase({ databasePath })).rejects.toThrow(
      /migration ledger.*mismatch/i,
    )
  })

  it('fails closed when the applied migration ledger has missing or extra versions', async () => {
    const missingPath = await createDatabasePath()
    const missing = await openPersistenceDatabase({ databasePath: missingPath })
    missing.database
      .prepare('DELETE FROM schema_migrations WHERE version = ?')
      .run(CURRENT_SCHEMA_VERSION)
    missing.close()
    await expect(
      openPersistenceDatabase({ databasePath: missingPath }),
    ).rejects.toThrow(/migration ledger.*mismatch/i)

    const extraPath = await createDatabasePath()
    const extra = await openPersistenceDatabase({ databasePath: extraPath })
    extra.database
      .prepare(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
      )
      .run(2, 'unconfigured migration', '2026-08-25T00:00:00.000Z')
    extra.close()
    await expect(
      openPersistenceDatabase({ databasePath: extraPath }),
    ).rejects.toThrow(/migration ledger.*mismatch/i)
  })

  it('fails closed when the default current schema is missing a required table', async () => {
    const databasePath = await createDatabasePath()
    const first = await openPersistenceDatabase({ databasePath })
    first.database.exec('DROP TABLE trash')
    first.close()

    await expect(openPersistenceDatabase({ databasePath })).rejects.toThrow(
      /required schema.*trash/i,
    )
  })

  it('fails closed when a required table has the right name but the wrong schema', async () => {
    const databasePath = await createDatabasePath()
    const first = await openPersistenceDatabase({ databasePath })
    first.database.exec('ALTER TABLE trash DROP COLUMN trashed_at')
    first.close()

    await expect(openPersistenceDatabase({ databasePath })).rejects.toThrow(
      /required schema.*trash/i,
    )
  })

  it('fails closed when persisted rows violate foreign-key integrity', async () => {
    const databasePath = await createDatabasePath()
    const first = await openPersistenceDatabase({ databasePath })
    first.database.pragma('foreign_keys = OFF')
    first.database
      .prepare(
        'INSERT INTO projects (id, workspace_id, name, name_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        'prj_00000000000000000000000000000001',
        'ws_missing',
        'Orphan',
        'orphan',
        '2026-08-25T00:00:00.000Z',
        '2026-08-25T00:00:00.000Z',
      )
    first.close()

    await expect(openPersistenceDatabase({ databasePath })).rejects.toThrow(
      /foreign.key check/i,
    )
  })
})
