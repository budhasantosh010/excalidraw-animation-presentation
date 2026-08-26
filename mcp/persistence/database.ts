import { access, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import Database from 'better-sqlite3'

export type PersistenceMigration = {
  version: number
  name: string
  apply(database: Database.Database): void
  validate?(database: Database.Database): void
}

export type MigrationBackup = {
  fromVersion: number
  toVersion: number
  path: string
}

export type OpenPersistenceDatabaseOptions = {
  databasePath: string
  migrations?: readonly PersistenceMigration[]
}

export type PersistenceDatabase = {
  database: Database.Database
  databasePath: string
  schemaVersion: number
  backups: readonly MigrationBackup[]
  getSchemaVersion(): number
  close(): void
}

const INITIAL_SCHEMA_SQL = `
  CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT
  ) STRICT;

  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL,
    current_revision_number INTEGER NOT NULL DEFAULT 0 CHECK (current_revision_number >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    UNIQUE (workspace_id, name_key)
  ) STRICT;

  CREATE INDEX projects_workspace_updated_idx
    ON projects (workspace_id, updated_at DESC, id);
  CREATE INDEX projects_name_key_idx ON projects (name_key);

  CREATE TABLE revisions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
    source TEXT NOT NULL CHECK (source IN ('manual', 'autosave', 'import', 'mcp', 'recovery', 'restore')),
    label TEXT,
    snapshot_json TEXT NOT NULL,
    extension_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON UPDATE CASCADE ON DELETE CASCADE,
    UNIQUE (project_id, revision_number)
  ) STRICT;

  CREATE INDEX revisions_project_created_idx
    ON revisions (project_id, created_at DESC, revision_number DESC);

  CREATE TABLE assets (
    hash TEXT PRIMARY KEY,
    mime_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
    storage_path TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE project_assets (
    project_id TEXT NOT NULL,
    asset_hash TEXT NOT NULL,
    PRIMARY KEY (project_id, asset_hash),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (asset_hash) REFERENCES assets(hash) ON UPDATE CASCADE ON DELETE RESTRICT
  ) STRICT;

  CREATE TABLE autosave_state (
    project_id TEXT PRIMARY KEY,
    durable_revision_number INTEGER NOT NULL CHECK (durable_revision_number >= 0),
    content_hash TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON UPDATE CASCADE ON DELETE CASCADE
  ) STRICT;

  CREATE TABLE trash (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL UNIQUE,
    trashed_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON UPDATE CASCADE ON DELETE CASCADE
  ) STRICT;
`

const REVISION_ASSETS_SCHEMA_SQL = `
  CREATE TABLE revision_assets (
    revision_id TEXT NOT NULL,
    asset_hash TEXT NOT NULL,
    PRIMARY KEY (revision_id, asset_hash),
    FOREIGN KEY (revision_id) REFERENCES revisions(id) ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (asset_hash) REFERENCES assets(hash) ON UPDATE CASCADE ON DELETE RESTRICT
  ) STRICT;

  CREATE INDEX revision_assets_asset_idx
    ON revision_assets (asset_hash, revision_id);

  INSERT INTO revision_assets (revision_id, asset_hash)
  SELECT r.id, pa.asset_hash
  FROM revisions r
  JOIN project_assets pa ON pa.project_id = r.project_id;
`

type RequiredSchemaObject = {
  type: 'index' | 'table'
  name: string
  sql: string
}

const normalizeSchemaSql = (sql: string) =>
  sql.replace(/\s+/g, ' ').trim().toLowerCase()

const INITIAL_REQUIRED_SCHEMA: readonly RequiredSchemaObject[] = (() => {
  const expected = new Database(':memory:')
  try {
    expected.exec(INITIAL_SCHEMA_SQL)
    return expected
      .prepare(
        `SELECT type, name, sql
         FROM sqlite_schema
         WHERE type IN ('table', 'index')
           AND name NOT LIKE 'sqlite_%'
           AND sql IS NOT NULL
         ORDER BY type, name`,
      )
      .all()
      .map((row) => {
        const schemaObject = row as RequiredSchemaObject
        return {
          type: schemaObject.type,
          name: schemaObject.name,
          sql: normalizeSchemaSql(schemaObject.sql),
        }
      })
  } finally {
    expected.close()
  }
})()

const validateInitialSchema = (database: Database.Database) => {
  const mismatches: string[] = []
  const readObject = database.prepare(
    `SELECT sql
     FROM sqlite_schema
     WHERE type = ? AND name = ? AND sql IS NOT NULL`,
  )
  for (const expected of INITIAL_REQUIRED_SCHEMA) {
    const actual = readObject.get(expected.type, expected.name) as
      | { sql: string }
      | undefined
    if (!actual || normalizeSchemaSql(actual.sql) !== expected.sql) {
      mismatches.push(`${expected.type} ${expected.name}`)
    }
  }
  if (mismatches.length > 0) {
    throw new Error(
      `Persistence required schema is missing or altered: ${mismatches.join(', ')}.`,
    )
  }
}

const REVISION_ASSETS_REQUIRED_SCHEMA: readonly RequiredSchemaObject[] = (() => {
  const expected = new Database(':memory:')
  try {
    expected.exec(INITIAL_SCHEMA_SQL)
    expected.exec(REVISION_ASSETS_SCHEMA_SQL)
    return expected
      .prepare(
        `SELECT type, name, sql
         FROM sqlite_schema
         WHERE name IN ('revision_assets', 'revision_assets_asset_idx')
           AND sql IS NOT NULL
         ORDER BY type, name`,
      )
      .all()
      .map((row) => {
        const schemaObject = row as RequiredSchemaObject
        return {
          type: schemaObject.type,
          name: schemaObject.name,
          sql: normalizeSchemaSql(schemaObject.sql),
        }
      })
  } finally {
    expected.close()
  }
})()

const validateRevisionAssetsSchema = (database: Database.Database) => {
  const readObject = database.prepare(
    `SELECT sql FROM sqlite_schema
     WHERE type = ? AND name = ? AND sql IS NOT NULL`,
  )
  const mismatches = REVISION_ASSETS_REQUIRED_SCHEMA.filter((expected) => {
    const actual = readObject.get(expected.type, expected.name) as
      | { sql: string }
      | undefined
    return !actual || normalizeSchemaSql(actual.sql) !== expected.sql
  }).map(({ type, name }) => `${type} ${name}`)
  if (mismatches.length > 0) {
    throw new Error(
      `Persistence revision-asset schema is missing or altered: ${mismatches.join(', ')}.`,
    )
  }
}

export const DEFAULT_PERSISTENCE_MIGRATIONS: readonly PersistenceMigration[] = [
  {
    version: 1,
    name: 'initial durable project schema',
    apply(database) {
      database.exec(INITIAL_SCHEMA_SQL)
    },
    validate: validateInitialSchema,
  },
  {
    version: 2,
    name: 'revision scoped asset links',
    apply(database) {
      database.exec(REVISION_ASSETS_SCHEMA_SQL)
    },
    validate: validateRevisionAssetsSchema,
  },
]

export const CURRENT_SCHEMA_VERSION =
  DEFAULT_PERSISTENCE_MIGRATIONS.at(-1)?.version ?? 0

export class PersistenceMigrationError extends Error {
  readonly backups: readonly MigrationBackup[]

  constructor(
    message: string,
    backups: readonly MigrationBackup[],
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'PersistenceMigrationError'
    this.backups = [...backups]
  }
}

const validateMigrations = (migrations: readonly PersistenceMigration[]) => {
  for (const [index, migration] of migrations.entries()) {
    const expectedVersion = index + 1
    if (
      migration.version !== expectedVersion ||
      !Number.isSafeInteger(migration.version) ||
      typeof migration.name !== 'string' ||
      migration.name.trim().length === 0 ||
      typeof migration.apply !== 'function'
    ) {
      throw new Error(
        `Persistence migrations must be contiguous from version 1; expected version ${expectedVersion}.`,
      )
    }
  }
}

const getSchemaVersion = (database: Database.Database) =>
  Number(database.pragma('user_version', { simple: true }))

const pathExists = async (path: string) => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const nextBackupPath = async (
  databasePath: string,
  fromVersion: number,
  toVersion: number,
) => {
  const base = `${databasePath}.pre-migration-v${fromVersion}-to-v${toVersion}.backup.sqlite`
  if (!(await pathExists(base))) return base
  let suffix = 1
  while (await pathExists(`${base}.${suffix}`)) suffix += 1
  return `${base}.${suffix}`
}

const createMigrationBackup = async (
  database: Database.Database,
  databasePath: string,
  fromVersion: number,
  toVersion: number,
): Promise<MigrationBackup> => {
  const path = await nextBackupPath(databasePath, fromVersion, toVersion)
  await database.backup(path)
  return { fromVersion, toVersion, path }
}

const applyMigration = (
  database: Database.Database,
  migration: PersistenceMigration,
) => {
  database.transaction(() => {
    database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;
    `)
    migration.apply(database)
    database
      .prepare(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
      )
      .run(migration.version, migration.name, new Date().toISOString())
    database.pragma(`user_version = ${migration.version}`)
  })()
}

const validateReadyDatabase = (
  database: Database.Database,
  migrations: readonly PersistenceMigration[],
  currentVersion: number,
) => {
  const integrityRows = database.pragma('integrity_check') as Array<
    Record<string, unknown>
  >
  const integrityMessages = integrityRows.flatMap((row) =>
    Object.values(row).map(String),
  )
  if (
    integrityMessages.length !== 1 ||
    integrityMessages[0]?.toLowerCase() !== 'ok'
  ) {
    throw new Error(
      `SQLite integrity check failed: ${integrityMessages.join('; ') || 'no result'}.`,
    )
  }

  const foreignKeyViolations = database.pragma('foreign_key_check') as Array<
    Record<string, unknown>
  >
  if (foreignKeyViolations.length > 0) {
    throw new Error(
      `SQLite foreign-key check failed with ${foreignKeyViolations.length} violation(s).`,
    )
  }

  const expectedLedger = migrations
    .filter((migration) => migration.version <= currentVersion)
    .map(({ version, name }) => ({ version, name }))
  const hasMigrationLedger = Boolean(
    database
      .prepare(
        "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'schema_migrations'",
      )
      .get(),
  )
  if (!hasMigrationLedger) {
    if (expectedLedger.length > 0) {
      throw new Error(
        'Persistence migration ledger schema_migrations is missing.',
      )
    }
  } else {
    const actualLedger = database
      .prepare(
        'SELECT version, name FROM schema_migrations ORDER BY version ASC',
      )
      .all() as Array<{ version: number; name: string }>
    const ledgerMatches =
      actualLedger.length === expectedLedger.length &&
      actualLedger.every(
        (row, index) =>
          row.version === expectedLedger[index]?.version &&
          row.name === expectedLedger[index]?.name,
      )
    if (!ledgerMatches) {
      throw new Error(
        'Persistence migration ledger mismatch: applied versions and names must exactly match the configured migrations.',
      )
    }
  }

  for (const migration of migrations) {
    if (migration.version > currentVersion) break
    migration.validate?.(database)
  }
}

export const openPersistenceDatabase = async ({
  databasePath,
  migrations = DEFAULT_PERSISTENCE_MIGRATIONS,
}: OpenPersistenceDatabaseOptions): Promise<PersistenceDatabase> => {
  if (typeof databasePath !== 'string' || databasePath.trim().length === 0) {
    throw new Error('A persistence database path is required.')
  }
  validateMigrations(migrations)
  const latestVersion = migrations.at(-1)?.version ?? 0
  const databaseAlreadyExisted = await pathExists(databasePath)
  await mkdir(dirname(databasePath), { recursive: true })

  const database = new Database(databasePath)
  const backups: MigrationBackup[] = []
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    database.close()
  }

  try {
    database.pragma('journal_mode = WAL')
    database.pragma('foreign_keys = ON')
    if (database.pragma('journal_mode', { simple: true }) !== 'wal') {
      throw new Error('SQLite WAL mode could not be enabled.')
    }
    if (database.pragma('foreign_keys', { simple: true }) !== 1) {
      throw new Error('SQLite foreign key enforcement could not be enabled.')
    }

    let currentVersion = getSchemaVersion(database)
    if (currentVersion > latestVersion) {
      throw new Error(
        `Database schema version ${currentVersion} is newer than this application supports (${latestVersion}).`,
      )
    }

    for (const migration of migrations) {
      if (migration.version <= currentVersion) continue
      if (databaseAlreadyExisted) {
        backups.push(
          await createMigrationBackup(
            database,
            databasePath,
            currentVersion,
            migration.version,
          ),
        )
      }
      applyMigration(database, migration)
      currentVersion = migration.version
    }

    validateReadyDatabase(database, migrations, currentVersion)

    return {
      database,
      databasePath,
      schemaVersion: currentVersion,
      backups,
      getSchemaVersion: () => getSchemaVersion(database),
      close,
    }
  } catch (cause) {
    close()
    if (backups.length > 0) {
      throw new PersistenceMigrationError(
        `Persistence migration failed; the database was left at its last committed schema version.`,
        backups,
        { cause },
      )
    }
    throw cause
  }
}
