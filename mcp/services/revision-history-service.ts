import type Database from 'better-sqlite3'

import { getElementAnimation } from '../../src/animation.ts'
import {
  parseProjectId,
  parseRevisionNumber,
  type PersistedProjectRecord,
  type ProjectId,
  type RevisionNumber,
  type RevisionSource,
} from '../persistence/contracts.ts'
import type { ProjectRepository } from '../persistence/project-repository.ts'
import { PersistenceConflictError } from '../persistence/repository-errors.ts'

export type RevisionPreview = {
  revisionNumber: RevisionNumber
  source: RevisionSource
  label: string | null
  createdAt: string
  isCurrent: boolean
  elementCount: number
  animatedElementCount: number
  stepCount: number
  assetCount: number
}

export type RevisionHistoryService = {
  list(projectId: ProjectId): RevisionPreview[]
  restore(
    projectId: ProjectId,
    revisionNumber: number,
    options?: { label?: string | null },
  ): PersistedProjectRecord
  pruneAutosaves(projectId: ProjectId): RevisionNumber[]
}

const summarize = (
  record: PersistedProjectRecord,
  currentRevision: RevisionNumber,
): RevisionPreview => {
  const activeElements = record.snapshot.elements.filter(
    (element) => element.isDeleted !== true,
  )
  const animations = activeElements.flatMap((element) => {
    const animation = getElementAnimation(
      element as Parameters<typeof getElementAnimation>[0],
    )
    return animation ? [animation] : []
  })
  return {
    revisionNumber: record.revision.number,
    source: record.revision.source,
    label: record.revision.label,
    createdAt: record.revision.createdAt,
    isCurrent: record.revision.number === currentRevision,
    elementCount: activeElements.length,
    animatedElementCount: animations.length,
    stepCount: new Set(animations.map(({ step }) => step)).size,
    assetCount: record.assetHashes.length,
  }
}

export const createRevisionHistoryService = ({
  database,
  projects,
  maxAutosaveRevisions = 20,
}: {
  database: Database.Database
  projects: ProjectRepository
  maxAutosaveRevisions?: number
}): RevisionHistoryService => {
  if (!Number.isSafeInteger(maxAutosaveRevisions) || maxAutosaveRevisions < 0) {
    throw new Error('Autosave retention must be a non-negative safe integer.')
  }

  const list = (projectIdValue: ProjectId) => {
    const projectId = parseProjectId(projectIdValue)
    const current = projects.get(projectId, { includeTrashed: true })
    const revisionNumbers = database
      .prepare(
        `SELECT revision_number FROM revisions
         WHERE project_id = ? ORDER BY revision_number DESC`,
      )
      .pluck()
      .all(projectId) as number[]
    return revisionNumbers.map((revisionNumber) =>
      summarize(
        projects.get(projectId, {
          includeTrashed: true,
          revisionNumber,
        }),
        current.revision.number,
      ),
    )
  }

  const restore: RevisionHistoryService['restore'] = (
    projectIdValue,
    revisionNumberValue,
    options = {},
  ) => {
    const projectId = parseProjectId(projectIdValue)
    const revisionNumber = parseRevisionNumber(revisionNumberValue)
    const current = projects.get(projectId, { includeTrashed: true })
    if (current.trash.state === 'trashed') {
      throw new PersistenceConflictError(
        `Project ${projectId} must be restored from trash before restoring a revision.`,
      )
    }
    if (revisionNumber === current.revision.number) {
      throw new PersistenceConflictError(
        `Revision ${revisionNumber} is already current for project ${projectId}.`,
      )
    }
    const target = projects.get(projectId, {
      includeTrashed: true,
      revisionNumber,
    })
    return projects.update(projectId, {
      expectedRevision: current.revision.number,
      source: 'restore',
      label: options.label ?? `Restored revision ${revisionNumber}`,
      snapshot: target.snapshot,
      extension: target.extension,
      assetHashes: target.assetHashes,
    })
  }

  const pruneAutosaves = (projectIdValue: ProjectId) => {
    const projectId = parseProjectId(projectIdValue)
    const remove = database.prepare(
      `DELETE FROM revisions
       WHERE project_id = ? AND revision_number = ?
         AND source = 'autosave' AND label IS NULL`,
    )
    return database.transaction(() => {
      const current = projects.get(projectId, { includeTrashed: true })
      const protectedNumbers = new Set<number>([
        current.revision.number,
        Math.max(1, Number(current.revision.number) - 1),
      ])
      const durableAutosave = database
        .prepare(
          'SELECT durable_revision_number FROM autosave_state WHERE project_id = ?',
        )
        .pluck()
        .get(projectId) as number | undefined
      if (durableAutosave !== undefined) protectedNumbers.add(durableAutosave)

      const autosaves = database
        .prepare(
          `SELECT revision_number FROM revisions
           WHERE project_id = ? AND source = 'autosave' AND label IS NULL
           ORDER BY revision_number DESC`,
        )
        .pluck()
        .all(projectId) as number[]
      const retainedByLimit = new Set(autosaves.slice(0, maxAutosaveRevisions))
      const deletable = autosaves.filter(
        (revisionNumber) =>
          !retainedByLimit.has(revisionNumber) &&
          !protectedNumbers.has(revisionNumber),
      )
      for (const revisionNumber of deletable) {
        if (remove.run(projectId, revisionNumber).changes !== 1) {
          throw new PersistenceConflictError(
            `Autosave revision ${revisionNumber} changed during retention cleanup.`,
          )
        }
      }
      return deletable.map(parseRevisionNumber)
    }).immediate()
  }

  return { list, restore, pruneAutosaves }
}
