import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { applyRevisionOperations, type ExcalidrawDocument } from './animation-tools.ts'
import {
  parseProjectId,
  parseRevisionNumber,
  parseWorkspaceId,
  type ProjectId,
} from './persistence/contracts.ts'
import { openPersistenceDatabase } from './persistence/database.ts'
import { createProjectRepository } from './persistence/project-repository.ts'
import { createWorkspaceRepository } from './persistence/workspace-repository.ts'
import { createProjectFileService } from './services/project-file-service.ts'
import { createRevisionHistoryService } from './services/revision-history-service.ts'

export const createProjectControl = async (dataRoot: string) => {
  await mkdir(dataRoot, { recursive: true })
  const store = await openPersistenceDatabase({
    databasePath: join(dataRoot, 'animation-studio.sqlite'),
  })
  const workspaces = createWorkspaceRepository(store.database)
  const projects = createProjectRepository(store.database)
  const files = createProjectFileService({ database: store.database, projects })
  const history = createRevisionHistoryService({ database: store.database, projects })
  if (!workspaces.list({ includeArchived: true }).length) {
    workspaces.create({ name: 'My Workspace' })
  }
  const workspaceId = (value?: unknown) => value === undefined
    ? workspaces.list()[0]!.id
    : parseWorkspaceId(value)

  return {
    workspaces: () => workspaces.list(),
    create(input: { name: string; snapshot: ExcalidrawDocument; workspaceId?: unknown }) {
      return projects.create({
        workspaceId: workspaceId(input.workspaceId),
        name: input.name,
        source: 'mcp',
        label: 'Created by ChatGPT',
        snapshot: input.snapshot,
        extension: { version: 1, timeline: { version: 2 } },
        assetHashes: [],
      })
    },
    list(input: { workspaceId?: unknown; query?: string; includeTrashed?: boolean } = {}) {
      return projects.list({
        workspaceId: workspaceId(input.workspaceId),
        query: input.query,
        includeTrashed: input.includeTrashed,
      })
    },
    open(input: { projectId: unknown; revision?: unknown }) {
      return projects.get(parseProjectId(input.projectId), {
        includeTrashed: true,
        revisionNumber: input.revision === undefined
          ? undefined
          : parseRevisionNumber(input.revision),
      })
    },
    revise(input: {
      projectId: unknown
      expectedRevision: unknown
      operations: Array<Record<string, unknown>>
    }) {
      const projectId = parseProjectId(input.projectId)
      const current = projects.get(projectId)
      const snapshot = applyRevisionOperations(
        current.snapshot as ExcalidrawDocument,
        input.operations,
      )
      return projects.update(projectId, {
        expectedRevision: parseRevisionNumber(input.expectedRevision),
        source: 'mcp',
        label: 'Revised by ChatGPT',
        snapshot,
        extension: current.extension,
        assetHashes: current.assetHashes,
      })
    },
    history(projectId: unknown) {
      return history.list(parseProjectId(projectId))
    },
    action(input: {
      projectId: unknown
      action: 'rename' | 'duplicate' | 'trash' | 'restore' | 'restore-revision'
      name?: string
      targetWorkspaceId?: unknown
      revision?: unknown
    }) {
      const projectId = parseProjectId(input.projectId)
      const action = String(input.action)
      if (action === 'rename') return files.rename(projectId, { name: input.name ?? '' })
      if (action === 'duplicate') {
        return files.duplicate(projectId, {
          name: input.name ?? '',
          targetWorkspaceId: input.targetWorkspaceId === undefined
            ? undefined
            : parseWorkspaceId(input.targetWorkspaceId),
        })
      }
      if (action === 'trash') return projects.trash(projectId)
      if (action === 'restore') return projects.restore(projectId)
      if (action === 'restore-revision') {
        return history.restore(projectId, parseRevisionNumber(input.revision))
      }
      throw new Error(`Unsupported project action: ${action}`)
    },
    close: () => store.close(),
  }
}

export type ProjectControl = Awaited<ReturnType<typeof createProjectControl>>
export type DurableProjectId = ProjectId
