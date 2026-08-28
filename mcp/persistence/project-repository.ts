import { randomUUID } from 'node:crypto'

import type Database from 'better-sqlite3'

import {
  assertExpectedRevision,
  parseAssetHash,
  parsePersistedProjectRecord,
  parseProjectId,
  parseRevisionId,
  parseRevisionNumber,
  parseTrashId,
  parseWorkspaceId,
  type AssetHash,
  type CanonicalProjectSnapshot,
  type PersistedProjectRecord,
  type ProjectExtensionV1,
  type ProjectId,
  type ProjectTrashState,
  type RevisionNumber,
  type RevisionSource,
  type WorkspaceId,
} from './contracts.ts'
import {
  PersistenceAssetReferenceError,
  PersistenceConflictError,
  PersistenceNameConflictError,
  PersistenceNotFoundError,
} from './repository-errors.ts'

export type ProjectRepositoryDependencies = {
  createProjectId?: () => string
  createRevisionId?: () => string
  createTrashId?: () => string
  now?: () => string
}

export type CreateProjectInput = {
  workspaceId: WorkspaceId
  name: string
  source: RevisionSource
  label?: string | null
  snapshot: CanonicalProjectSnapshot
  extension: ProjectExtensionV1
  assetHashes?: readonly AssetHash[]
}

export type UpdateProjectInput = {
  expectedRevision: number
  source: RevisionSource
  label?: string | null
  snapshot: CanonicalProjectSnapshot
  extension: ProjectExtensionV1
  assetHashes?: readonly AssetHash[]
}

export type ProjectSummary = {
  workspaceId: WorkspaceId
  projectId: ProjectId
  name: string
  currentRevision: RevisionNumber
  createdAt: string
  updatedAt: string
  trash: ProjectTrashState
}

export type ProjectRepository = {
  create(input: CreateProjectInput): PersistedProjectRecord
  get(
    projectId: ProjectId,
    options?: { includeTrashed?: boolean; revisionNumber?: number },
  ): PersistedProjectRecord
  update(projectId: ProjectId, input: UpdateProjectInput): PersistedProjectRecord
  list(options: {
    workspaceId: WorkspaceId
    query?: string
    includeTrashed?: boolean
  }): ProjectSummary[]
  trash(
    projectId: ProjectId,
    options?: { includeAlreadyTrashed?: boolean },
  ): PersistedProjectRecord
  restore(projectId: ProjectId): PersistedProjectRecord
}

type ProjectRevisionRow = {
  project_id: string
  workspace_id: string
  name: string
  current_revision_number: number
  project_created_at: string
  project_updated_at: string
  revision_id: string
  revision_number: number
  source: RevisionSource
  label: string | null
  snapshot_json: string
  extension_json: string
  revision_created_at: string
  trash_id: string | null
  trashed_at: string | null
}

type ProjectSummaryRow = {
  project_id: string
  workspace_id: string
  name: string
  current_revision_number: number
  created_at: string
  updated_at: string
  trash_id: string | null
  trashed_at: string | null
}

const normalizeProjectName = (name: string) => {
  if (typeof name !== 'string') throw new Error('Invalid project name.')
  const normalized = name.trim().replace(/\s+/g, ' ')
  if (normalized.length === 0 || normalized.length > 200) {
    throw new Error('Invalid project name; expected 1 to 200 characters.')
  }
  return normalized
}

const toNameKey = (name: string) =>
  name.normalize('NFKC').toLocaleLowerCase('en-US')

const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&')

const sqliteMessageIncludes = (error: unknown, fragment: string) =>
  error instanceof Error && error.message.includes(fragment)

const makeId = (prefix: 'prj' | 'rev' | 'trash') =>
  `${prefix}_${randomUUID().replaceAll('-', '')}`

const trashStateFromRow = (row: {
  trash_id: string | null
  trashed_at: string | null
}): ProjectTrashState =>
  row.trash_id && row.trashed_at
    ? {
        state: 'trashed',
        id: parseTrashId(row.trash_id),
        trashedAt: row.trashed_at,
      }
    : { state: 'active' }

export const createProjectRepository = (
  database: Database.Database,
  dependencies: ProjectRepositoryDependencies = {},
): ProjectRepository => {
  const createProjectId = dependencies.createProjectId ?? (() => makeId('prj'))
  const createRevisionId = dependencies.createRevisionId ?? (() => makeId('rev'))
  const createTrashId = dependencies.createTrashId ?? (() => makeId('trash'))
  const now = dependencies.now ?? (() => new Date().toISOString())

  const readProjectRow = (
    projectId: ProjectId,
    revisionNumber?: RevisionNumber,
  ) =>
    database
      .prepare(
        `SELECT
           p.id AS project_id,
           p.workspace_id,
           p.name,
           p.current_revision_number,
           p.created_at AS project_created_at,
           p.updated_at AS project_updated_at,
           r.id AS revision_id,
           r.revision_number,
           r.source,
           r.label,
           r.snapshot_json,
           r.extension_json,
           r.created_at AS revision_created_at,
           t.id AS trash_id,
           t.trashed_at
         FROM projects p
         JOIN revisions r
           ON r.project_id = p.id
          AND r.revision_number = COALESCE(?, p.current_revision_number)
         LEFT JOIN trash t ON t.project_id = p.id
         WHERE p.id = ?`,
      )
      .get(revisionNumber ?? null, projectId) as ProjectRevisionRow | undefined

  const readAssetHashes = (revisionId: string) =>
    (
      database
        .prepare(
          `SELECT asset_hash FROM revision_assets
           WHERE revision_id = ? ORDER BY asset_hash ASC`,
        )
        .pluck()
        .all(revisionId) as string[]
    ).map(parseAssetHash)

  const buildRecord = (row: ProjectRevisionRow): PersistedProjectRecord =>
    parsePersistedProjectRecord({
      schemaVersion: 1,
      workspaceId: row.workspace_id,
      projectId: row.project_id,
      name: row.name,
      revision: {
        id: row.revision_id,
        number: row.revision_number,
        source: row.source,
        label: row.label,
        createdAt: row.revision_created_at,
      },
      trash: trashStateFromRow(row),
      assetHashes: readAssetHashes(row.revision_id),
      extension: JSON.parse(row.extension_json) as unknown,
      createdAt: row.project_created_at,
      updatedAt:
        row.revision_number === row.current_revision_number
          ? row.project_updated_at
          : row.revision_created_at,
      snapshot: JSON.parse(row.snapshot_json) as unknown,
    })

  const get = (
    projectIdValue: ProjectId,
    options: { includeTrashed?: boolean; revisionNumber?: number } = {},
  ) => {
    const projectId = parseProjectId(projectIdValue)
    const revisionNumber =
      options.revisionNumber === undefined
        ? undefined
        : parseRevisionNumber(options.revisionNumber)
    const row = readProjectRow(projectId, revisionNumber)
    if (!row || (!options.includeTrashed && row.trash_id)) {
      throw new PersistenceNotFoundError(
        revisionNumber
          ? `Project ${projectId} revision ${revisionNumber} was not found.`
          : `Project ${projectId} was not found.`,
      )
    }
    return buildRecord(row)
  }

  const ensureWorkspaceExists = (workspaceId: WorkspaceId) => {
    const exists = database
      .prepare('SELECT 1 FROM workspaces WHERE id = ?')
      .get(workspaceId)
    if (!exists) {
      throw new PersistenceNotFoundError(
        `Workspace ${workspaceId} was not found.`,
      )
    }
  }

  const ensureAssetsExist = (assetHashes: readonly AssetHash[]) => {
    const findAsset = database.prepare('SELECT 1 FROM assets WHERE hash = ?')
    for (const hash of assetHashes) {
      if (!findAsset.get(hash)) {
        throw new PersistenceAssetReferenceError(
          `Asset ${hash} must exist before it can be linked to a project.`,
        )
      }
    }
  }

  const create = (input: CreateProjectInput) => {
    const workspaceId = parseWorkspaceId(input.workspaceId)
    const projectId = parseProjectId(createProjectId())
    const revisionId = parseRevisionId(createRevisionId())
    const timestamp = now()
    const candidate = parsePersistedProjectRecord({
      schemaVersion: 1,
      workspaceId,
      projectId,
      name: normalizeProjectName(input.name),
      revision: {
        id: revisionId,
        number: 1,
        source: input.source,
        label: input.label ?? null,
        createdAt: timestamp,
      },
      trash: { state: 'active' },
      assetHashes: input.assetHashes ?? [],
      extension: input.extension,
      createdAt: timestamp,
      updatedAt: timestamp,
      snapshot: input.snapshot,
    })

    const transaction = database.transaction(() => {
      ensureWorkspaceExists(workspaceId)
      ensureAssetsExist(candidate.assetHashes)
      database
        .prepare(
          `INSERT INTO projects
             (id, workspace_id, name, name_key, current_revision_number, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(
          candidate.projectId,
          candidate.workspaceId,
          candidate.name,
          toNameKey(candidate.name),
          candidate.createdAt,
          candidate.updatedAt,
        )
      database
        .prepare(
          `INSERT INTO revisions
             (id, project_id, revision_number, source, label, snapshot_json, extension_json, created_at)
           VALUES (?, ?, 1, ?, ?, ?, ?, ?)`,
        )
        .run(
          candidate.revision.id,
          candidate.projectId,
          candidate.revision.source,
          candidate.revision.label,
          JSON.stringify(candidate.snapshot),
          JSON.stringify(candidate.extension),
          candidate.revision.createdAt,
        )
      const linkAsset = database.prepare(
        'INSERT INTO project_assets (project_id, asset_hash) VALUES (?, ?)',
      )
      const linkRevisionAsset = database.prepare(
        'INSERT INTO revision_assets (revision_id, asset_hash) VALUES (?, ?)',
      )
      for (const hash of candidate.assetHashes) {
        linkAsset.run(candidate.projectId, hash)
        linkRevisionAsset.run(candidate.revision.id, hash)
      }
    })

    try {
      transaction.immediate()
    } catch (error) {
      if (
        sqliteMessageIncludes(
          error,
          'UNIQUE constraint failed: projects.workspace_id, projects.name_key',
        )
      ) {
        throw new PersistenceNameConflictError(
          `A project named "${candidate.name}" already exists in this workspace.`,
          { cause: error },
        )
      }
      throw error
    }
    return get(projectId)
  }

  const update = (projectIdValue: ProjectId, input: UpdateProjectInput) => {
    const projectId = parseProjectId(projectIdValue)
    const current = get(projectId, { includeTrashed: true })
    if (current.trash.state === 'trashed') {
      throw new PersistenceConflictError(
        `Project ${projectId} is trashed and cannot be updated until it is restored.`,
      )
    }
    const expectedRevision = parseRevisionNumber(input.expectedRevision)
    const revisionId = parseRevisionId(createRevisionId())
    const timestamp = now()
    const candidate = parsePersistedProjectRecord({
      ...current,
      revision: {
        id: revisionId,
        number: Number(expectedRevision) + 1,
        source: input.source,
        label: input.label ?? null,
        createdAt: timestamp,
      },
      assetHashes: input.assetHashes ?? current.assetHashes,
      extension: input.extension,
      updatedAt: timestamp,
      snapshot: input.snapshot,
    })

    const transaction = database.transaction(() => {
      const durable = database
        .prepare(
          `SELECT
             p.current_revision_number,
             EXISTS(SELECT 1 FROM trash t WHERE t.project_id = p.id) AS is_trashed
           FROM projects p
           WHERE p.id = ?`,
        )
        .get(projectId) as
        | { current_revision_number: number; is_trashed: number }
        | undefined
      if (!durable) {
        throw new PersistenceNotFoundError(`Project ${projectId} was not found.`)
      }
      if (durable.is_trashed) {
        throw new PersistenceConflictError(
          `Project ${projectId} is trashed and cannot be updated until it is restored.`,
        )
      }
      try {
        assertExpectedRevision(durable.current_revision_number, expectedRevision)
      } catch (error) {
        throw new PersistenceConflictError(
          `Revision conflict: expected revision ${expectedRevision}, current revision is ${durable.current_revision_number}.`,
          { cause: error },
        )
      }
      ensureAssetsExist(candidate.assetHashes)
      database
        .prepare(
          `INSERT INTO revisions
             (id, project_id, revision_number, source, label, snapshot_json, extension_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          candidate.revision.id,
          projectId,
          candidate.revision.number,
          candidate.revision.source,
          candidate.revision.label,
          JSON.stringify(candidate.snapshot),
          JSON.stringify(candidate.extension),
          candidate.revision.createdAt,
        )
      const linkRevisionAsset = database.prepare(
        'INSERT INTO revision_assets (revision_id, asset_hash) VALUES (?, ?)',
      )
      for (const hash of candidate.assetHashes) {
        linkRevisionAsset.run(candidate.revision.id, hash)
      }
      database
        .prepare('DELETE FROM project_assets WHERE project_id = ?')
        .run(projectId)
      const linkCurrentAsset = database.prepare(
        'INSERT INTO project_assets (project_id, asset_hash) VALUES (?, ?)',
      )
      for (const hash of candidate.assetHashes) {
        linkCurrentAsset.run(projectId, hash)
      }
      const changed = database
        .prepare(
          `UPDATE projects
           SET current_revision_number = ?, updated_at = ?
           WHERE id = ? AND current_revision_number = ?`,
        )
        .run(
          candidate.revision.number,
          candidate.updatedAt,
          projectId,
          expectedRevision,
        )
      if (changed.changes !== 1) {
        throw new PersistenceConflictError(
          `Revision conflict while updating project ${projectId}.`,
        )
      }
    })
    transaction.immediate()
    return get(projectId, { includeTrashed: true })
  }

  const list: ProjectRepository['list'] = ({
    workspaceId: workspaceIdValue,
    query,
    includeTrashed = false,
  }) => {
    const workspaceId = parseWorkspaceId(workspaceIdValue)
    ensureWorkspaceExists(workspaceId)
    const normalizedQuery = query === undefined ? '' : toNameKey(query.trim().replace(/\s+/g, ' '))
    const rows = database
      .prepare(
        `SELECT
           p.id AS project_id,
           p.workspace_id,
           p.name,
           p.current_revision_number,
           p.created_at,
           p.updated_at,
           t.id AS trash_id,
           t.trashed_at
         FROM projects p
         LEFT JOIN trash t ON t.project_id = p.id
         WHERE p.workspace_id = ?
           AND (? = 1 OR t.id IS NULL)
           AND (? = '' OR p.name_key LIKE ? ESCAPE '\\')
         ORDER BY p.name_key ASC, p.id ASC`,
      )
      .all(
        workspaceId,
        includeTrashed ? 1 : 0,
        normalizedQuery,
        `%${escapeLike(normalizedQuery)}%`,
      ) as ProjectSummaryRow[]
    return rows.map((row) => ({
      workspaceId: parseWorkspaceId(row.workspace_id),
      projectId: parseProjectId(row.project_id),
      name: row.name,
      currentRevision: parseRevisionNumber(row.current_revision_number),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      trash: trashStateFromRow(row),
    }))
  }

  const trash: ProjectRepository['trash'] = (
    projectIdValue,
    options = {},
  ) => {
    const projectId = parseProjectId(projectIdValue)
    const current = get(projectId, { includeTrashed: true })
    if (current.trash.state === 'trashed') {
      if (options.includeAlreadyTrashed) return current
      throw new PersistenceConflictError(`Project ${projectId} is already trashed.`)
    }
    const trashId = parseTrashId(createTrashId())
    const timestamp = now()
    database.transaction(() => {
      database
        .prepare('INSERT INTO trash (id, project_id, trashed_at) VALUES (?, ?, ?)')
        .run(trashId, projectId, timestamp)
    }).immediate()
    return get(projectId, { includeTrashed: true })
  }

  const restore = (projectIdValue: ProjectId) => {
    const projectId = parseProjectId(projectIdValue)
    const current = get(projectId, { includeTrashed: true })
    if (current.trash.state === 'active') {
      throw new PersistenceConflictError(`Project ${projectId} is not trashed.`)
    }
    database.transaction(() => {
      const result = database
        .prepare('DELETE FROM trash WHERE project_id = ?')
        .run(projectId)
      if (result.changes !== 1) {
        throw new PersistenceConflictError(
          `Project ${projectId} could not be restored because its trash state changed.`,
        )
      }
    }).immediate()
    return get(projectId)
  }

  return { create, get, update, list, trash, restore }
}
