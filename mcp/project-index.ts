import { createHash } from 'node:crypto'

import { getAnimationDefinition, getTimelineScenes } from '../src/timeline.ts'
import type { ExcalidrawDocument } from './animation-tools.ts'

export type ProjectIndexIdentity = {
  filename: string
  name?: string
  revision: number
  projectId?: string
  workspaceId?: string
}

export type ProjectInspection = {
  sceneId?: string
  elementIds?: string[]
  query?: string
  elementType?: string
  animationOnly?: boolean
  limit?: number
  cursor?: string
}

const DEFAULT_LIMIT = 100
export const MAX_PROJECT_INDEX_LIMIT = 200

const fingerprint = (value: unknown) => createHash('sha256')
  .update(JSON.stringify(value))
  .digest('base64url')

export const fingerprintProjectDocument = (document: ExcalidrawDocument) =>
  fingerprint(document)

const encodeCursor = (scope: string, offset: number) =>
  Buffer.from(JSON.stringify({ scope, offset }), 'utf8').toString('base64url')

const decodeCursor = (cursor: string, scope: string) => {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      scope?: unknown
      offset?: unknown
    }
    if (
      value.scope !== scope ||
      !Number.isSafeInteger(value.offset) ||
      Number(value.offset) < 0
    ) {
      throw new Error('Stale or invalid project inspection cursor.')
    }
    return Number(value.offset)
  } catch (error) {
    if (error instanceof Error && error.message.includes('project inspection cursor')) {
      throw error
    }
    throw new Error('Stale or invalid project inspection cursor.')
  }
}

const stringArray = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

export const buildProjectIndex = (
  document: ExcalidrawDocument,
  identity: ProjectIndexIdentity,
  inspection: ProjectInspection = {},
) => {
  const scenes = getTimelineScenes(document.elements as never)
  const sceneByFrame = new Map(scenes.map((scene) => [scene.frameId, scene]))
  const semanticSceneIdByFrame = new Map<string, string>()
  for (const element of document.elements) {
    const animation = element.isDeleted || element.type === 'frame'
      ? undefined
      : getAnimationDefinition(element as never)
    if (animation && typeof element.frameId === 'string') {
      semanticSceneIdByFrame.set(element.frameId, animation.sceneId)
    }
  }
  const textByContainer = new Map(
    document.elements.flatMap((element): Array<[string, string]> =>
      !element.isDeleted &&
      typeof element.containerId === 'string' &&
      typeof element.text === 'string'
        ? [[element.containerId, element.text]]
        : [],
    ),
  )
  const selectedIds = inspection.elementIds === undefined
    ? undefined
    : new Set(inspection.elementIds)
  const query = inspection.query?.trim().toLocaleLowerCase()
  const limit = Math.min(
    MAX_PROJECT_INDEX_LIMIT,
    Math.max(1, Math.trunc(inspection.limit ?? DEFAULT_LIMIT)),
  )
  const cursorScope = fingerprint({
    project: {
      filename: identity.filename,
      projectId: identity.projectId ?? null,
      workspaceId: identity.workspaceId ?? null,
      revision: identity.revision,
      content: fingerprintProjectDocument(document),
    },
    filters: {
      sceneId: inspection.sceneId ?? null,
      elementIds: inspection.elementIds
        ? [...new Set(inspection.elementIds)].sort()
        : null,
      query: query ?? null,
      elementType: inspection.elementType ?? null,
      animationOnly: inspection.animationOnly === true,
      limit,
    },
  })
  const offset = inspection.cursor
    ? decodeCursor(inspection.cursor, cursorScope)
    : 0

  const elements = document.elements.flatMap((element) => {
    if (element.isDeleted || element.type === 'frame') return []
    const animation = getAnimationDefinition(element as never)
    const scene = sceneByFrame.get(String(element.frameId ?? ''))
    const sceneId = animation?.sceneId ?? scene?.sceneId
    const text = typeof element.text === 'string'
      ? element.text
      : textByContainer.get(String(element.id))
    const record = {
      id: String(element.id),
      ...(sceneId ? { sceneId } : {}),
      type: String(element.type),
      ...(text === undefined ? {} : { text }),
      ...(typeof element.containerId === 'string'
        ? { containerId: element.containerId }
        : {}),
      x: Number(element.x),
      y: Number(element.y),
      width: Number(element.width),
      height: Number(element.height),
      angle: Number(element.angle ?? 0),
      opacity: Number(element.opacity ?? 100),
      groupIds: stringArray(element.groupIds),
      boundElementIds: Array.isArray(element.boundElements)
        ? element.boundElements.flatMap((binding) =>
            binding && typeof binding.id === 'string' ? [binding.id] : [],
          )
        : [],
      bindingElementIds: [element.startBinding, element.endBinding].flatMap((binding) =>
        binding && typeof binding.elementId === 'string' ? [binding.elementId] : [],
      ),
      ...(animation ? { animation } : {}),
    }
    if (inspection.sceneId && sceneId !== inspection.sceneId) return []
    if (selectedIds && !selectedIds.has(record.id)) return []
    if (inspection.elementType && record.type !== inspection.elementType) return []
    if (inspection.animationOnly && !animation) return []
    if (query) {
      const searchable = [record.id, record.type, text, scene?.name]
        .filter((value): value is string => typeof value === 'string')
        .join('\n')
        .toLocaleLowerCase()
      if (!searchable.includes(query)) return []
    }
    return [record]
  })

  if (inspection.cursor && offset >= elements.length) {
    throw new Error('Stale or invalid project inspection cursor.')
  }
  const page = elements.slice(offset, offset + limit)
  const nextOffset = offset + page.length
  const filtersApplied = {
    ...(inspection.sceneId ? { sceneId: inspection.sceneId } : {}),
    ...(inspection.elementIds?.length ? { elementIds: inspection.elementIds } : {}),
    ...(inspection.query?.trim() ? { query: inspection.query.trim() } : {}),
    ...(inspection.elementType ? { elementType: inspection.elementType } : {}),
    ...(inspection.animationOnly ? { animationOnly: true } : {}),
  }

  return {
    schemaVersion: 1,
    project: {
      filename: identity.filename,
      name: identity.name ?? identity.filename.replace(/\.excalidraw$/i, ''),
      revision: identity.revision,
      ...(identity.projectId ? { projectId: identity.projectId } : {}),
      ...(identity.workspaceId ? { workspaceId: identity.workspaceId } : {}),
    },
    sceneSummary: { count: scenes.length },
    scenes: scenes.map((scene) => ({
      id: semanticSceneIdByFrame.get(scene.frameId) ?? scene.sceneId,
      frameId: scene.frameId,
      name: scene.name,
      order: scene.order,
      durationMs: scene.durationMs,
      camera: scene.camera,
    })),
    elements: page,
    pagination: {
      returned: page.length,
      total: elements.length,
      limit,
      ...(nextOffset < elements.length
        ? { nextCursor: encodeCursor(cursorScope, nextOffset) }
        : {}),
    },
    filtersApplied,
  }
}

const elementsById = (document: ExcalidrawDocument) =>
  new Map(document.elements.map((element) => [String(element.id), element]))

const semanticSceneId = (
  document: ExcalidrawDocument,
  element: Record<string, any> | undefined,
) => {
  if (!element) return undefined
  if (element.type !== 'frame') {
    const animation = getAnimationDefinition(element as never)
    if (animation) return animation.sceneId
    if (typeof element.frameId === 'string') {
      return getTimelineScenes(document.elements as never)
        .find((scene) => scene.frameId === element.frameId)?.sceneId
    }
    return undefined
  }
  for (const child of document.elements) {
    if (child.isDeleted || child.frameId !== element.id) continue
    const animation = getAnimationDefinition(child as never)
    if (animation) return animation.sceneId
  }
  return getTimelineScenes([element] as never)[0]?.sceneId
}

export const buildMutationReceipt = (
  before: ExcalidrawDocument,
  after: ExcalidrawDocument,
  operationsApplied: number,
  identity: ProjectIndexIdentity & { previousRevision: number },
) => {
  const beforeById = elementsById(before)
  const afterById = elementsById(after)
  const createdElementIds = after.elements.flatMap((element) =>
    !element.isDeleted && !beforeById.has(String(element.id))
      ? [String(element.id)]
      : [],
  )
  const deletedElementIds = before.elements.flatMap((element) => {
    const current = afterById.get(String(element.id))
    return !element.isDeleted && (!current || current.isDeleted)
      ? [String(element.id)]
      : []
  })
  const updatedElementIds = after.elements.flatMap((element) => {
    const previous = beforeById.get(String(element.id))
    return previous &&
      !element.isDeleted &&
      !previous.isDeleted &&
      JSON.stringify(previous) !== JSON.stringify(element)
      ? [String(element.id)]
      : []
  })
  const affectedIds = [
    ...createdElementIds,
    ...updatedElementIds,
    ...deletedElementIds,
  ]
  const activeAffectedIds = [...createdElementIds, ...updatedElementIds]
  const afterIndex = buildProjectIndex(after, identity, {
    elementIds: activeAffectedIds,
    limit: MAX_PROJECT_INDEX_LIMIT,
  })
  const affectedSceneIds = [...new Set(affectedIds.flatMap((id) => {
    const sceneId = semanticSceneId(after, afterById.get(id))
      ?? semanticSceneId(before, beforeById.get(id))
    return sceneId ? [sceneId] : []
  }))]

  return {
    ...(identity.projectId ? { projectId: identity.projectId } : {}),
    ...(identity.workspaceId ? { workspaceId: identity.workspaceId } : {}),
    filename: identity.filename,
    previousRevision: identity.previousRevision,
    revision: identity.revision,
    operationsApplied,
    createdElementIds,
    updatedElementIds,
    deletedElementIds,
    affectedSceneIds,
    warnings: [],
    affectedElements: afterIndex.elements,
    previousContentFingerprint: fingerprintProjectDocument(before),
    contentFingerprint: fingerprintProjectDocument(after),
  }
}

export const buildCreationReceipt = (
  document: ExcalidrawDocument,
  identity: ProjectIndexIdentity,
) => {
  const index = buildProjectIndex(document, identity, {
    limit: MAX_PROJECT_INDEX_LIMIT,
  })
  return {
    ...(identity.projectId ? { projectId: identity.projectId } : {}),
    ...(identity.workspaceId ? { workspaceId: identity.workspaceId } : {}),
    filename: identity.filename,
    revision: identity.revision,
    createdElementIds: document.elements.flatMap((element) =>
      element.isDeleted ? [] : [String(element.id)],
    ),
    sceneIds: index.scenes.map((scene) => scene.id),
    warnings: [],
  }
}

export const buildProjectActionReceipt = (
  before: ExcalidrawDocument,
  after: ExcalidrawDocument,
  identity: ProjectIndexIdentity & {
    action: 'rename' | 'duplicate' | 'trash' | 'restore' | 'restore-revision'
    previousRevision: number
    sourceRevision?: number
    sourceProjectId?: string
  },
) => {
  const changes = buildMutationReceipt(before, after, 0, identity)
  return {
    action: identity.action,
    ...(identity.sourceRevision === undefined
      ? {}
      : { sourceRevision: identity.sourceRevision }),
    ...(identity.sourceProjectId
      ? { sourceProjectId: identity.sourceProjectId }
      : {}),
    ...(identity.projectId ? { projectId: identity.projectId } : {}),
    ...(identity.workspaceId ? { workspaceId: identity.workspaceId } : {}),
    filename: identity.filename,
    previousRevision: identity.previousRevision,
    revision: identity.revision,
    snapshotChanged:
      changes.previousContentFingerprint !== changes.contentFingerprint,
    createdElementIds: changes.createdElementIds,
    updatedElementIds: changes.updatedElementIds,
    deletedElementIds: changes.deletedElementIds,
    affectedSceneIds: changes.affectedSceneIds,
    affectedElements: changes.affectedElements,
    previousContentFingerprint: changes.previousContentFingerprint,
    contentFingerprint: changes.contentFingerprint,
    warnings: changes.warnings,
  }
}
