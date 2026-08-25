import {
  parseProjectId,
  parseRevisionNumber,
  type CanonicalProjectSnapshot,
  type ProjectId,
  type RevisionNumber,
} from '../persistence/contracts.ts'

export type ThumbnailJob = {
  projectId: ProjectId
  revisionNumber: RevisionNumber
  snapshot: CanonicalProjectSnapshot
}

export type ThumbnailScheduler = {
  schedule(job: ThumbnailJob): void
}

export type ObservableThumbnailScheduler = ThumbnailScheduler & {
  whenIdle(): Promise<void>
}

export const createThumbnailScheduler = ({
  render,
  onError = () => undefined,
}: {
  render(job: ThumbnailJob): Promise<void>
  onError?(error: unknown, job: ThumbnailJob): void
}): ObservableThumbnailScheduler => {
  const queued = new Map<ProjectId, ThumbnailJob>()
  const active = new Set<ProjectId>()
  const latestRevision = new Map<ProjectId, RevisionNumber>()
  let idleWaiters: Array<() => void> = []

  const settleIdle = () => {
    if (active.size !== 0 || queued.size !== 0) return
    const waiters = idleWaiters
    idleWaiters = []
    for (const resolve of waiters) resolve()
  }

  const drain = async (projectId: ProjectId) => {
    while (queued.has(projectId)) {
      const job = queued.get(projectId)!
      queued.delete(projectId)
      try {
        await render(job)
      } catch (error) {
        try {
          onError(error, job)
        } catch {
          // Thumbnail diagnostics must never interrupt durable project work.
        }
      }
    }
    active.delete(projectId)
    settleIdle()
  }

  return {
    schedule(input) {
      const job: ThumbnailJob = {
        projectId: parseProjectId(input.projectId),
        revisionNumber: parseRevisionNumber(input.revisionNumber),
        snapshot: structuredClone(input.snapshot),
      }
      const newest = latestRevision.get(job.projectId)
      if (newest !== undefined && job.revisionNumber <= newest) return
      latestRevision.set(job.projectId, job.revisionNumber)
      queued.set(job.projectId, job)
      if (active.has(job.projectId)) return
      active.add(job.projectId)
      queueMicrotask(() => void drain(job.projectId))
    },
    whenIdle() {
      if (active.size === 0 && queued.size === 0) return Promise.resolve()
      return new Promise<void>((resolve) => idleWaiters.push(resolve))
    },
  }
}

// Existing create/update call sites remain intentionally untouched in Micro 1.4.
// Micro 1.7 should inject this interface after their durable commit succeeds.
