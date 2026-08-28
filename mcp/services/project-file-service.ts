import type Database from 'better-sqlite3'

import {
  parseProjectId,
  parseWorkspaceId,
  type PersistedProjectRecord,
  type ProjectId,
  type WorkspaceId,
} from '../persistence/contracts.ts'
import type { ProjectRepository } from '../persistence/project-repository.ts'
import {
  isSqliteUniqueConstraintError,
  PersistenceConfirmationError,
  PersistenceConflictError,
  PersistenceNameConflictError,
  PersistenceNotFoundError,
} from '../persistence/repository-errors.ts'
import type { ThumbnailScheduler } from './thumbnail-scheduler.ts'

export type ProjectFileService = {
  rename(projectId: ProjectId, input: { name: string }): PersistedProjectRecord
  duplicate(
    projectId: ProjectId,
    input: { name: string; targetWorkspaceId?: WorkspaceId },
  ): PersistedProjectRecord
  move(
    projectId: ProjectId,
    input: { targetWorkspaceId: WorkspaceId },
  ): PersistedProjectRecord
  permanentlyDelete(
    projectId: ProjectId,
    input: { confirmationProjectId: ProjectId },
  ): { projectId: ProjectId; deleted: true }
}

const normalizeProjectName = (value: unknown) => {
  if (typeof value !== 'string') throw new Error('Invalid project name.')
  const name = value.trim().replace(/\s+/g, ' ')
  if (name.length === 0 || name.length > 200) {
    throw new Error('Invalid project name; expected 1 to 200 characters.')
  }
  return name
}

const toNameKey = (name: string) =>
  name.normalize('NFKC').toLocaleLowerCase('en-US')

const rethrowNameConflict = (error: unknown, name: string): never => {
  if (isSqliteUniqueConstraintError(error)) {
    throw new PersistenceNameConflictError(
      `A project named "${name}" already exists in the target workspace.`,
      { cause: error },
    )
  }
  throw error
}

export const createProjectFileService = ({
  database,
  projects,
  now = () => new Date().toISOString(),
  thumbnailScheduler,
}: {
  database: Database.Database
  projects: ProjectRepository
  now?: () => string
  thumbnailScheduler?: ThumbnailScheduler
}): ProjectFileService => {
  const requireActive = (projectId: ProjectId) => {
    const project = projects.get(projectId, { includeTrashed: true })
    if (project.trash.state === 'trashed') {
      throw new PersistenceConflictError(
        `Project ${projectId} is trashed and must be restored first.`,
      )
    }
    return project
  }

  const requireWorkspace = (workspaceId: WorkspaceId) => {
    const exists = database
      .prepare('SELECT 1 FROM workspaces WHERE id = ?')
      .get(workspaceId)
    if (!exists) {
      throw new PersistenceNotFoundError(
        `Workspace ${workspaceId} was not found.`,
      )
    }
  }

  const scheduleThumbnail = (project: PersistedProjectRecord) => {
    try {
      thumbnailScheduler?.schedule({
        projectId: project.projectId,
        revisionNumber: project.revision.number,
        snapshot: project.snapshot,
      })
    } catch {
      // Thumbnail work is best-effort and cannot undo a durable operation.
    }
  }

  return {
    rename(projectIdValue, { name: nameValue }) {
      const projectId = parseProjectId(projectIdValue)
      const name = normalizeProjectName(nameValue)
      try {
        database.transaction(() => {
          requireActive(projectId)
          const result = database
            .prepare(
              `UPDATE projects
               SET name = ?, name_key = ?, updated_at = ?
               WHERE id = ?`,
            )
            .run(name, toNameKey(name), now(), projectId)
          if (result.changes !== 1) {
            throw new PersistenceNotFoundError(`Project ${projectId} was not found.`)
          }
        }).immediate()
      } catch (error) {
        rethrowNameConflict(error, name)
      }
      return projects.get(projectId)
    },

    duplicate(projectIdValue, input) {
      const projectId = parseProjectId(projectIdValue)
      const source = requireActive(projectId)
      const targetWorkspaceId = parseWorkspaceId(
        input.targetWorkspaceId ?? source.workspaceId,
      )
      requireWorkspace(targetWorkspaceId)
      const duplicate = projects.create({
        workspaceId: targetWorkspaceId,
        name: normalizeProjectName(input.name),
        source: 'manual',
        label: null,
        snapshot: source.snapshot,
        extension: source.extension,
        assetHashes: source.assetHashes,
      })
      scheduleThumbnail(duplicate)
      return duplicate
    },

    move(projectIdValue, { targetWorkspaceId: targetWorkspaceIdValue }) {
      const projectId = parseProjectId(projectIdValue)
      const targetWorkspaceId = parseWorkspaceId(targetWorkspaceIdValue)
      try {
        database.transaction(() => {
          requireActive(projectId)
          requireWorkspace(targetWorkspaceId)
          const result = database
            .prepare('UPDATE projects SET workspace_id = ? WHERE id = ?')
            .run(targetWorkspaceId, projectId)
          if (result.changes !== 1) {
            throw new PersistenceNotFoundError(`Project ${projectId} was not found.`)
          }
        }).immediate()
      } catch (error) {
        const current = projects.get(projectId, { includeTrashed: true })
        rethrowNameConflict(error, current.name)
      }
      return projects.get(projectId)
    },

    permanentlyDelete(projectIdValue, { confirmationProjectId: confirmationValue }) {
      const projectId = parseProjectId(projectIdValue)
      const confirmationProjectId = parseProjectId(confirmationValue)
      if (confirmationProjectId !== projectId) {
        throw new PersistenceConfirmationError(
          `Permanent deletion confirmation does not match project ${projectId}.`,
        )
      }
      database.transaction(() => {
        const project = projects.get(projectId, { includeTrashed: true })
        if (project.trash.state !== 'trashed') {
          throw new PersistenceConflictError(
            `Project ${projectId} must be trashed before permanent deletion.`,
          )
        }
        const result = database.prepare('DELETE FROM projects WHERE id = ?').run(projectId)
        if (result.changes !== 1) {
          throw new PersistenceConflictError(
            `Project ${projectId} changed before permanent deletion.`,
          )
        }
      }).immediate()
      return { projectId, deleted: true }
    },
  }
}
