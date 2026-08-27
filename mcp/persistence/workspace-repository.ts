import { randomUUID } from 'node:crypto'

import type Database from 'better-sqlite3'

import { parseWorkspaceId, type WorkspaceId } from './contracts.ts'
import {
  isSqliteUniqueConstraintError,
  PersistenceNameConflictError,
  PersistenceNotFoundError,
} from './repository-errors.ts'

export type WorkspaceRecord = {
  id: WorkspaceId
  name: string
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export type WorkspaceRepositoryDependencies = {
  createId?: () => string
  now?: () => string
}

export type WorkspaceRepository = {
  create(input: { name: string }): WorkspaceRecord
  get(id: WorkspaceId): WorkspaceRecord
  update(
    id: WorkspaceId,
    changes: { name?: string; archived?: boolean },
  ): WorkspaceRecord
  list(options?: { includeArchived?: boolean }): WorkspaceRecord[]
}

const normalizeName = (name: string) => {
  if (typeof name !== 'string') throw new Error('Invalid workspace name.')
  const normalized = name.trim().replace(/\s+/g, ' ')
  if (normalized.length === 0 || normalized.length > 200) {
    throw new Error('Invalid workspace name; expected 1 to 200 characters.')
  }
  return normalized
}

const toNameKey = (name: string) =>
  name.normalize('NFKC').toLocaleLowerCase('en-US')

const toWorkspaceRecord = (row: {
  id: string
  name: string
  created_at: string
  updated_at: string
  archived_at: string | null
}): WorkspaceRecord => ({
  id: parseWorkspaceId(row.id),
  name: row.name,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  archivedAt: row.archived_at,
})

export const createWorkspaceRepository = (
  database: Database.Database,
  dependencies: WorkspaceRepositoryDependencies = {},
): WorkspaceRepository => {
  const createId = dependencies.createId ?? (() => `ws_${randomUUID().replaceAll('-', '')}`)
  const now = dependencies.now ?? (() => new Date().toISOString())
  const read = database.prepare(
    `SELECT id, name, created_at, updated_at, archived_at
     FROM workspaces WHERE id = ?`,
  )
  const requireWorkspace = (id: WorkspaceId) => {
    const row = read.get(id) as Parameters<typeof toWorkspaceRecord>[0] | undefined
    if (!row) {
      throw new PersistenceNotFoundError(`Workspace ${id} was not found.`)
    }
    return toWorkspaceRecord(row)
  }

  const rethrowNameConflict = (error: unknown, name: string): never => {
    if (isSqliteUniqueConstraintError(error)) {
      throw new PersistenceNameConflictError(
        `A workspace named "${name}" already exists.`,
        { cause: error },
      )
    }
    throw error
  }

  return {
    create({ name }) {
      const normalizedName = normalizeName(name)
      const id = parseWorkspaceId(createId())
      const timestamp = now()
      try {
        database
          .prepare(
            `INSERT INTO workspaces
               (id, name, name_key, created_at, updated_at, archived_at)
             VALUES (?, ?, ?, ?, ?, NULL)`,
          )
          .run(id, normalizedName, toNameKey(normalizedName), timestamp, timestamp)
      } catch (error) {
        rethrowNameConflict(error, normalizedName)
      }
      return requireWorkspace(id)
    },
    get(id) {
      return requireWorkspace(parseWorkspaceId(id))
    },
    update(id, changes) {
      const workspaceId = parseWorkspaceId(id)
      const current = requireWorkspace(workspaceId)
      const name = changes.name === undefined ? current.name : normalizeName(changes.name)
      const timestamp = now()
      const archivedAt =
        changes.archived === undefined
          ? current.archivedAt
          : changes.archived
            ? timestamp
            : null
      try {
        database
          .prepare(
            `UPDATE workspaces
             SET name = ?, name_key = ?, updated_at = ?, archived_at = ?
             WHERE id = ?`,
          )
          .run(name, toNameKey(name), timestamp, archivedAt, workspaceId)
      } catch (error) {
        rethrowNameConflict(error, name)
      }
      return requireWorkspace(workspaceId)
    },
    list(options = {}) {
      const rows = database
        .prepare(
          `SELECT id, name, created_at, updated_at, archived_at
           FROM workspaces
           WHERE (? = 1 OR archived_at IS NULL)
           ORDER BY name_key ASC, id ASC`,
        )
        .all(options.includeArchived ? 1 : 0) as Array<
        Parameters<typeof toWorkspaceRecord>[0]
      >
      return rows.map(toWorkspaceRecord)
    },
  }
}
