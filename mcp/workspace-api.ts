import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import express from 'express'

import {
  parsePersistedProjectRecord,
  parseProjectId,
  parseRevisionNumber,
  parseWorkspaceId,
} from './persistence/contracts.ts'
import { openPersistenceDatabase } from './persistence/database.ts'
import { createProjectRepository } from './persistence/project-repository.ts'
import {
  PersistenceConflictError,
  PersistenceNotFoundError,
} from './persistence/repository-errors.ts'
import { createWorkspaceRepository } from './persistence/workspace-repository.ts'
import { createProjectFileService } from './services/project-file-service.ts'
import { createRevisionHistoryService } from './services/revision-history-service.ts'

export const createWorkspaceApi = async (dataRoot: string) => {
  await mkdir(dataRoot, { recursive: true })
  const store = await openPersistenceDatabase({
    databasePath: join(dataRoot, 'animation-studio.sqlite'),
  })
  const workspaces = createWorkspaceRepository(store.database)
  const projects = createProjectRepository(store.database)
  const files = createProjectFileService({
    database: store.database,
    projects,
  })
  const history = createRevisionHistoryService({
    database: store.database,
    projects,
  })
  if (workspaces.list({ includeArchived: true }).length === 0) {
    workspaces.create({ name: 'My Workspace' })
  }

  const router = express()
  router.use(express.json({ limit: '32mb' }))

  router.get('/bootstrap', (_request, response) => {
    const workspaceRecords = workspaces.list()
    const firstWorkspace = workspaceRecords[0]
    response.json({
      workspaces: workspaceRecords,
      selectedWorkspaceId: firstWorkspace?.id ?? null,
      projects: firstWorkspace
        ? projects.list({ workspaceId: firstWorkspace.id })
        : [],
    })
  })

  router.post('/workspaces', (request, response) => {
    response.status(201).json(workspaces.create({ name: request.body?.name }))
  })

  router.get('/projects', (request, response) => {
    response.json(
      projects.list({
        workspaceId: parseWorkspaceId(request.query.workspaceId),
        query:
          typeof request.query.query === 'string'
            ? request.query.query
            : undefined,
        includeTrashed: request.query.includeTrashed === 'true',
      }),
    )
  })

  router.post('/projects', (request, response) => {
    const body = request.body as Record<string, unknown>
    response.status(201).json(
      projects.create({
        workspaceId: parseWorkspaceId(body.workspaceId),
        name: body.name as string,
        source: 'manual',
        label: 'Created',
        snapshot: parsePersistedProjectRecord({
          schemaVersion: 1,
          workspaceId: body.workspaceId,
          projectId: 'prj_00000000000000000000000000000000',
          name: body.name,
          revision: {
            id: 'rev_00000000000000000000000000000000',
            number: 1,
            source: 'manual',
            label: null,
            createdAt: new Date().toISOString(),
          },
          trash: { state: 'active' },
          assetHashes: [],
          extension: body.extension,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          snapshot: body.snapshot,
        }).snapshot,
        extension: (body.extension ?? { version: 1 }) as never,
        assetHashes: [],
      }),
    )
  })

  router.get('/projects/:projectId', (request, response) => {
    response.json(
      projects.get(parseProjectId(request.params.projectId), {
        includeTrashed: true,
        revisionNumber:
          request.query.revision === undefined
            ? undefined
            : parseRevisionNumber(Number(request.query.revision)),
      }),
    )
  })

  router.get('/projects/:projectId/revisions', (request, response) => {
    response.json(history.list(parseProjectId(request.params.projectId)))
  })

  router.patch('/projects/:projectId', (request, response) => {
    const projectId = parseProjectId(request.params.projectId)
    const body = request.body as Record<string, unknown>
    switch (body.action) {
      case 'save': {
        const current = projects.get(projectId, { includeTrashed: true })
        const saved = projects.update(projectId, {
            expectedRevision: Number(body.expectedRevision),
            source: body.source === 'recovery' ? 'recovery' : 'autosave',
            label: null,
            snapshot: body.snapshot as never,
            extension: (body.extension ?? { version: 1 }) as never,
            assetHashes: current.assetHashes,
          })
        try {
          history.pruneAutosaves(projectId)
        } catch (error) {
          console.error('Autosave revision cleanup failed.', error)
        }
        response.json(saved)
        return
      }
      case 'rename':
        response.json(files.rename(projectId, { name: body.name as string }))
        return
      case 'duplicate':
        response.status(201).json(
          files.duplicate(projectId, {
            name: body.name as string,
            targetWorkspaceId:
              body.targetWorkspaceId === undefined
                ? undefined
                : parseWorkspaceId(body.targetWorkspaceId),
          }),
        )
        return
      case 'trash':
        response.json(projects.trash(projectId))
        return
      case 'restore-trash':
        response.json(projects.restore(projectId))
        return
      case 'restore-revision':
        response.json(
          history.restore(projectId, Number(body.revisionNumber)),
        )
        return
      default:
        response.status(400).json({ error: 'Unsupported project action.' })
    }
  })

  router.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      const status =
        error instanceof PersistenceNotFoundError
          ? 404
          : error instanceof PersistenceConflictError
            ? 409
            : 400
      response.status(status).json({
        error: error instanceof Error ? error.message : 'Workspace request failed.',
      })
    },
  )

  return {
    router,
    close: () => store.close(),
  }
}
