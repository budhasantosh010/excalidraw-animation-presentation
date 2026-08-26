import { createHash } from 'node:crypto'

import type Database from 'better-sqlite3'

import {
  parsePersistedProjectRecord,
  parseProjectId,
  parseRevisionNumber,
  type AssetHash,
  type CanonicalProjectSnapshot,
  type PersistedProjectRecord,
  type ProjectExtensionV1,
  type ProjectId,
  type RevisionNumber,
} from '../persistence/contracts.ts'
import type { ProjectRepository } from '../persistence/project-repository.ts'
import {
  PersistenceAssetReferenceError,
  PersistenceConflictError,
} from '../persistence/repository-errors.ts'
import type { ThumbnailScheduler } from './thumbnail-scheduler.ts'
import type { RevisionHistoryService } from './revision-history-service.ts'

export type AutosaveInput = {
  projectId: unknown
  expectedRevision: unknown
  snapshot: unknown
  extension: unknown
  assetHashes: readonly unknown[]
}

export type PendingAutosave = {
  projectId: ProjectId
  expectedRevision: RevisionNumber
  snapshot: CanonicalProjectSnapshot
  extension: ProjectExtensionV1
  assetHashes: AssetHash[]
  contentHash: string
}

export class AutosaveConflictError extends PersistenceConflictError {
  readonly projectId: ProjectId
  readonly expectedRevision: RevisionNumber
  readonly currentRevision: RevisionNumber

  constructor({
    projectId,
    expectedRevision,
    currentRevision,
  }: {
    projectId: ProjectId
    expectedRevision: RevisionNumber
    currentRevision: RevisionNumber
  }) {
    super(
      `Autosave conflict for project ${projectId}: expected revision ${expectedRevision}, current revision is ${currentRevision}.`,
    )
    this.name = 'AutosaveConflictError'
    this.projectId = projectId
    this.expectedRevision = expectedRevision
    this.currentRevision = currentRevision
  }
}

export type AutosaveOutcome =
  | {
      status: 'saved'
      project: PersistedProjectRecord
    }
  | {
      status: 'unchanged'
      project: PersistedProjectRecord
    }
  | {
      status: 'conflict'
      projectId: ProjectId
      expectedRevision: RevisionNumber
      currentRevision: RevisionNumber
      error: AutosaveConflictError
    }
  | {
      status: 'error'
      projectId: ProjectId
      error: unknown
    }

export type AutosaveService = {
  schedule(input: AutosaveInput): void
  flush(projectId?: ProjectId): Promise<AutosaveOutcome[]>
  getRecoveryState(projectId: ProjectId): PendingAutosave | undefined
  shutdown(): Promise<AutosaveOutcome[]>
}

type CanonicalContent = Pick<
  PendingAutosave,
  'snapshot' | 'extension' | 'assetHashes'
>

const stableJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableJson(
          (value as Record<string, unknown>)[key],
        )}`,
    )
    .join(',')}}`
}

export const computeAutosaveContentHash = ({
  snapshot,
  extension,
  assetHashes,
}: CanonicalContent) =>
  createHash('sha256')
    .update(
      stableJson({
        snapshot,
        extension,
        assetHashes: [...assetHashes].sort(),
      }),
    )
    .digest('hex')

export const createAutosaveService = ({
  database,
  projects,
  debounceMs = 750,
  thumbnailScheduler,
  revisionHistory,
  onConflict = () => undefined,
  onError = () => undefined,
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}: {
  database: Database.Database
  projects: ProjectRepository
  debounceMs?: number
  thumbnailScheduler?: ThumbnailScheduler
  revisionHistory?: Pick<RevisionHistoryService, 'pruneAutosaves'>
  onConflict?(
    error: AutosaveConflictError,
    pending: PendingAutosave,
  ): unknown
  onError?(error: unknown, pending: PendingAutosave): unknown
  setTimer?(callback: () => void, delay: number): unknown
  clearTimer?(handle: unknown): void
}): AutosaveService => {
  if (!Number.isFinite(debounceMs) || debounceMs < 0) {
    throw new Error('Autosave debounce must be a non-negative finite number.')
  }

  const pending = new Map<ProjectId, PendingAutosave>()
  const timers = new Map<ProjectId, unknown>()
  let shutDown = false

  const safelyReport = <ErrorType>(
    callback: (error: ErrorType, input: PendingAutosave) => unknown,
    error: ErrorType,
    input: PendingAutosave,
  ) => {
    try {
      const result = callback(error, structuredClone(input))
      if (
        result !== null &&
        (typeof result === 'object' || typeof result === 'function') &&
        typeof (result as PromiseLike<unknown>).then === 'function'
      ) {
        void Promise.resolve(result).catch(() => undefined)
      }
    } catch {
      // Diagnostics must never interrupt or reject autosave work.
    }
  }

  const validateAndDetach = (input: AutosaveInput): PendingAutosave => {
    const projectId = parseProjectId(input.projectId)
    const expectedRevision = parseRevisionNumber(input.expectedRevision)
    const current = projects.get(projectId, { includeTrashed: true })
    const candidate = parsePersistedProjectRecord({
      ...current,
      revision: {
        ...current.revision,
        number: expectedRevision,
      },
      snapshot: input.snapshot,
      extension: input.extension,
      assetHashes: input.assetHashes,
    })
    const findAsset = database.prepare('SELECT 1 FROM assets WHERE hash = ?')
    for (const hash of candidate.assetHashes) {
      if (!findAsset.get(hash)) {
        throw new PersistenceAssetReferenceError(
          `Asset ${hash} must exist before autosave can reference it.`,
        )
      }
    }
    const detached = {
      projectId,
      expectedRevision,
      snapshot: candidate.snapshot,
      extension: candidate.extension,
      assetHashes: [...candidate.assetHashes].sort(),
    }
    return {
      ...detached,
      contentHash: computeAutosaveContentHash(detached),
    }
  }

  const clearProjectTimer = (projectId: ProjectId) => {
    const handle = timers.get(projectId)
    if (handle === undefined) return
    timers.delete(projectId)
    clearTimer(handle)
  }

  const persist = (input: PendingAutosave): AutosaveOutcome => {
    try {
      let outcome!: AutosaveOutcome
      database.transaction(() => {
        const reconcileAutosaveState = (
          project: PersistedProjectRecord,
          contentHash: string,
        ) => {
          database
            .prepare(
              `INSERT INTO autosave_state
                 (project_id, durable_revision_number, content_hash, snapshot_json, updated_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(project_id) DO UPDATE SET
                 durable_revision_number = excluded.durable_revision_number,
                 content_hash = excluded.content_hash,
                 snapshot_json = excluded.snapshot_json,
                 updated_at = excluded.updated_at`,
            )
            .run(
              project.projectId,
              project.revision.number,
              contentHash,
              JSON.stringify(project.snapshot),
              project.updatedAt,
            )
        }
        const current = projects.get(input.projectId, { includeTrashed: true })
        if (current.revision.number !== input.expectedRevision) {
          const error = new AutosaveConflictError({
            projectId: input.projectId,
            expectedRevision: input.expectedRevision,
            currentRevision: current.revision.number,
          })
          outcome = {
            status: 'conflict',
            projectId: input.projectId,
            expectedRevision: input.expectedRevision,
            currentRevision: current.revision.number,
            error,
          }
          return
        }

        const durableHash = computeAutosaveContentHash({
          snapshot: current.snapshot,
          extension: current.extension,
          assetHashes: current.assetHashes,
        })
        if (durableHash === input.contentHash) {
          reconcileAutosaveState(current, durableHash)
          outcome = { status: 'unchanged', project: current }
          return
        }

        const saved = projects.update(input.projectId, {
          expectedRevision: input.expectedRevision,
          source: 'autosave',
          label: null,
          snapshot: input.snapshot,
          extension: input.extension,
          assetHashes: input.assetHashes,
        })
        reconcileAutosaveState(saved, input.contentHash)
        outcome = { status: 'saved', project: saved }
      }).immediate()

      if (outcome.status === 'saved') {
        try {
          thumbnailScheduler?.schedule({
            projectId: outcome.project.projectId,
            revisionNumber: outcome.project.revision.number,
            snapshot: outcome.project.snapshot,
          })
        } catch (error) {
          safelyReport(onError, error, input)
        }
        try {
          revisionHistory?.pruneAutosaves(outcome.project.projectId)
        } catch (error) {
          safelyReport(onError, error, input)
        }
      }
      if (outcome.status === 'conflict') {
        safelyReport(onConflict, outcome.error, input)
      }
      if (outcome.status === 'saved' || outcome.status === 'unchanged') {
        if (pending.get(input.projectId) === input) pending.delete(input.projectId)
      }
      return outcome
    } catch (error) {
      safelyReport(onError, error, input)
      return { status: 'error', projectId: input.projectId, error }
    }
  }

  const flushIds = async (ids: readonly ProjectId[]) => {
    const outcomes: AutosaveOutcome[] = []
    for (const projectId of ids) {
      clearProjectTimer(projectId)
      const input = pending.get(projectId)
      if (!input) continue
      outcomes.push(persist(input))
    }
    return outcomes
  }

  return {
    schedule(input) {
      if (shutDown) throw new Error('Autosave service has been shut down.')
      const validated = validateAndDetach(input)
      clearProjectTimer(validated.projectId)
      pending.set(validated.projectId, validated)
      const handle = setTimer(() => {
        timers.delete(validated.projectId)
        void flushIds([validated.projectId]).catch((error) => {
          safelyReport(onError, error, validated)
        })
      }, debounceMs)
      timers.set(validated.projectId, handle)
    },
    flush(projectIdValue) {
      const ids = projectIdValue
        ? [parseProjectId(projectIdValue)]
        : [...pending.keys()]
      return flushIds(ids)
    },
    getRecoveryState(projectIdValue) {
      const state = pending.get(parseProjectId(projectIdValue))
      return state ? structuredClone(state) : undefined
    },
    async shutdown() {
      if (shutDown) return []
      shutDown = true
      for (const projectId of timers.keys()) clearProjectTimer(projectId)
      return flushIds([...pending.keys()])
    },
  }
}
