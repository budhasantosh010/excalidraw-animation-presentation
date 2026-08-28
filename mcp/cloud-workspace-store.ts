import { getElementAnimation } from '../src/animation.ts'
import { summarizeAnimationDocument, type ExcalidrawDocument } from './animation-tools.ts'
import {
  parsePersistedProjectRecord,
  parseProjectId,
  parseRevisionNumber,
  parseWorkspaceId,
  type PersistedProjectRecord,
  type ProjectExtensionV1,
  type ProjectId,
  type RevisionSource,
  type WorkspaceId,
} from './persistence/contracts.ts'
import type { R2BucketLike } from './cloud-storage.ts'

export type CloudWorkspaceRecord = {
  id: WorkspaceId
  name: string
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export type CloudProjectSummary = {
  workspaceId: WorkspaceId
  projectId: ProjectId
  name: string
  currentRevision: number
  createdAt: string
  updatedAt: string
  trash: PersistedProjectRecord['trash']
  sceneCount: number
  drawableElementCount: number
  animatedElementCount: number
}

type StoredProject = {
  current: PersistedProjectRecord
  revisions: PersistedProjectRecord[]
}

const DEFAULT_WORKSPACE_ID = 'ws_00000000000000000000000000000001'
const DEFAULT_MAX_PROJECT_BYTES = 2 * 1024 * 1024
const DEFAULT_MAX_WORKSPACES = 8
const DEFAULT_MAX_PROJECTS_PER_WORKSPACE = 32
const DEFAULT_MAX_PROJECTS_TOTAL = 128
const PROJECT_SUMMARY_METADATA_KEY = 'sanverse-project-summary-v1'

type CloudWorkspaceStoreLimits = {
  maxWorkspaces?: number
  maxProjectsPerWorkspace?: number
  maxProjectsTotal?: number
  maxProjectBytes?: number
}

const now = () => new Date().toISOString()
const createId = (prefix: 'ws' | 'prj' | 'rev' | 'trash') =>
  `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`

const normalizeName = (value: unknown, label: string) => {
  if (typeof value !== 'string') throw new Error(`Invalid ${label}.`)
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (!normalized || normalized.length > 200) {
    throw new Error(`Invalid ${label}; expected 1 to 200 characters.`)
  }
  return normalized
}

const parseWorkspace = (value: unknown): CloudWorkspaceRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid cloud workspace record.')
  }
  const candidate = value as Record<string, unknown>
  return {
    id: parseWorkspaceId(candidate.id),
    name: normalizeName(candidate.name, 'workspace name'),
    createdAt: String(candidate.createdAt),
    updatedAt: String(candidate.updatedAt),
    archivedAt: candidate.archivedAt === null ? null : String(candidate.archivedAt),
  }
}

const parseStoredProject = (value: unknown): StoredProject => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid cloud project record.')
  }
  const candidate = value as Record<string, unknown>
  if (!Array.isArray(candidate.revisions)) {
    throw new Error('Invalid cloud project revisions.')
  }
  const revisions = candidate.revisions.map(parsePersistedProjectRecord)
  const current = parsePersistedProjectRecord(candidate.current)
  return { current, revisions }
}

const projectSummary = (record: PersistedProjectRecord): CloudProjectSummary => {
  const animation = summarizeAnimationDocument(
    `${record.name}.excalidraw`,
    record.snapshot as ExcalidrawDocument,
    record.revision.number,
  )
  return {
    workspaceId: record.workspaceId,
    projectId: record.projectId,
    name: record.name,
    currentRevision: record.revision.number,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    trash: record.trash,
    sceneCount: animation.sceneCount,
    drawableElementCount: animation.drawableElementCount,
    animatedElementCount: animation.animatedElementCount,
  }
}

const projectMetadata = (record: PersistedProjectRecord) => ({
  [PROJECT_SUMMARY_METADATA_KEY]: JSON.stringify(projectSummary(record)),
})

const parseProjectSummary = (value: string): CloudProjectSummary => {
  const candidate = JSON.parse(value) as CloudProjectSummary
  const workspaceId = parseWorkspaceId(candidate.workspaceId)
  const projectId = parseProjectId(candidate.projectId)
  const currentRevision = parseRevisionNumber(candidate.currentRevision)
  const name = normalizeName(candidate.name, 'project name')
  if (!candidate.trash || typeof candidate.trash !== 'object') {
    throw new Error('Invalid cloud project summary metadata.')
  }
  for (const metric of ['sceneCount', 'drawableElementCount', 'animatedElementCount'] as const) {
    if (!Number.isInteger(candidate[metric]) || candidate[metric] < 0) {
      throw new Error('Invalid cloud project summary metadata.')
    }
  }
  return {
    ...candidate,
    workspaceId,
    projectId,
    currentRevision,
    name,
    createdAt: String(candidate.createdAt),
    updatedAt: String(candidate.updatedAt),
  }
}

const revisionPreview = (
  record: PersistedProjectRecord,
  currentRevision: number,
) => {
  const elements = record.snapshot.elements.filter(
    (element) => element.isDeleted !== true,
  )
  const animations = elements.flatMap((element) => {
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
    elementCount: elements.length,
    animatedElementCount: animations.length,
    stepCount: new Set(animations.map(({ step }) => step)).size,
    assetCount: record.assetHashes.length,
  }
}

export class R2WorkspaceStore {
  private readonly root: string
  private readonly workspacesPrefix: string
  private readonly projectsPrefix: string
  private readonly limits: Required<CloudWorkspaceStoreLimits>

  constructor(
    private readonly bucket: R2BucketLike,
    namespace = 'mcp',
    limits: CloudWorkspaceStoreLimits = {},
  ) {
    if (!/^[A-Za-z0-9_/-]{1,160}$/.test(namespace)) {
      throw new Error('Invalid cloud workspace namespace.')
    }
    this.root = `sanverse-cloud-v2/${namespace.replace(/^\/+|\/+$/g, '')}/`
    this.workspacesPrefix = `${this.root}workspaces/`
    this.projectsPrefix = `${this.root}projects/`
    this.limits = {
      maxWorkspaces: limits.maxWorkspaces ?? DEFAULT_MAX_WORKSPACES,
      maxProjectsPerWorkspace:
        limits.maxProjectsPerWorkspace ?? DEFAULT_MAX_PROJECTS_PER_WORKSPACE,
      maxProjectsTotal: limits.maxProjectsTotal ?? DEFAULT_MAX_PROJECTS_TOTAL,
      maxProjectBytes: limits.maxProjectBytes ?? DEFAULT_MAX_PROJECT_BYTES,
    }
  }

  private workspaceKey(id: string) {
    return `${this.workspacesPrefix}${id}.json`
  }

  private projectKey(id: string) {
    return `${this.projectsPrefix}${id}.json`
  }

  private async listObjects(prefix: string) {
    const objects: Array<{ key: string; customMetadata?: Record<string, string> }> = []
    let cursor: string | undefined
    do {
      const page = await this.bucket.list({
        prefix,
        include: ['customMetadata'],
        ...(cursor ? { cursor } : {}),
      })
      objects.push(...page.objects)
      cursor = page.truncated ? page.cursor : undefined
      if (page.truncated && !cursor) throw new Error('R2 pagination cursor is missing.')
    } while (cursor)
    return objects.sort((left, right) => left.key.localeCompare(right.key))
  }

  private async listKeys(prefix: string) {
    return (await this.listObjects(prefix)).map(({ key }) => key)
  }

  private async readJson(key: string) {
    const object = await this.bucket.get(key)
    if (!object) return null
    return { etag: object.etag, value: JSON.parse(await object.text()) as unknown }
  }

  private async readStoredProject(projectIdValue: unknown) {
    const projectId = parseProjectId(projectIdValue)
    const object = await this.readJson(this.projectKey(projectId))
    if (!object) throw new Error(`Project ${projectId} was not found.`)
    return { projectId, etag: object.etag, stored: parseStoredProject(object.value) }
  }

  private async replaceStoredProject(
    projectId: ProjectId,
    etag: string,
    stored: StoredProject,
  ) {
    const bounded = { ...stored, revisions: [...stored.revisions] }
    let serialized = `${JSON.stringify(bounded)}\n`
    while (
      new TextEncoder().encode(serialized).byteLength > this.limits.maxProjectBytes &&
      bounded.revisions.length
    ) {
      bounded.revisions.shift()
      serialized = `${JSON.stringify(bounded)}\n`
    }
    if (new TextEncoder().encode(serialized).byteLength > this.limits.maxProjectBytes) {
      throw new Error('Project exceeds the cloud storage size limit.')
    }
    const result = await this.bucket.put(
      this.projectKey(projectId),
      serialized,
      {
        customMetadata: projectMetadata(bounded.current),
        onlyIf: { etagMatches: etag },
      },
    )
    if (!result) throw new Error(`Project ${projectId} changed; reload and retry.`)
  }

  async ensureDefaultWorkspace() {
    const current = await this.listWorkspaces()
    if (current.length) return current[0]!
    const timestamp = now()
    const workspace = parseWorkspace({
      id: DEFAULT_WORKSPACE_ID,
      name: 'My Workspace',
      createdAt: timestamp,
      updatedAt: timestamp,
      archivedAt: null,
    })
    await this.bucket.put(
      this.workspaceKey(workspace.id),
      `${JSON.stringify(workspace)}\n`,
      { onlyIf: { etagDoesNotMatch: '*' } },
    )
    const object = await this.readJson(this.workspaceKey(workspace.id))
    if (!object) throw new Error('Default workspace could not be created.')
    return parseWorkspace(object.value)
  }

  async createWorkspace(name: unknown) {
    if ((await this.listWorkspaces()).length >= this.limits.maxWorkspaces) {
      throw new Error('Workspace quota exceeded.')
    }
    const timestamp = now()
    const workspace = parseWorkspace({
      id: createId('ws'),
      name: normalizeName(name, 'workspace name'),
      createdAt: timestamp,
      updatedAt: timestamp,
      archivedAt: null,
    })
    const stored = await this.bucket.put(
      this.workspaceKey(workspace.id),
      `${JSON.stringify(workspace)}\n`,
      { onlyIf: { etagDoesNotMatch: '*' } },
    )
    if (!stored) throw new Error('Workspace ID conflict; retry the request.')
    return workspace
  }

  async listWorkspaces() {
    const records = await Promise.all(
      (await this.listKeys(this.workspacesPrefix)).map(async (key) => {
        const object = await this.readJson(key)
        if (!object) throw new Error(`Workspace disappeared while listing: ${key}`)
        return parseWorkspace(object.value)
      }),
    )
    return records
      .filter(({ archivedAt }) => archivedAt === null)
      .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
  }

  async createProject(input: {
    workspaceId: unknown
    name: unknown
    source: RevisionSource
    label: string | null
    snapshot: unknown
    extension: ProjectExtensionV1
    assetHashes: unknown[]
  }) {
    const workspaceId = parseWorkspaceId(input.workspaceId)
    if (!await this.readJson(this.workspaceKey(workspaceId))) {
      throw new Error(`Workspace ${workspaceId} was not found.`)
    }
    const allProjectObjects = await this.listObjects(this.projectsPrefix)
    if (allProjectObjects.length >= this.limits.maxProjectsTotal) {
      throw new Error('Cloud project quota exceeded.')
    }
    if ((await this.listProjects({ workspaceId, includeTrashed: true })).length >=
      this.limits.maxProjectsPerWorkspace) {
      throw new Error('Project quota exceeded for this workspace.')
    }
    const projectId = parseProjectId(createId('prj'))
    const timestamp = now()
    const current = parsePersistedProjectRecord({
      schemaVersion: 1,
      workspaceId,
      projectId,
      name: normalizeName(input.name, 'project name'),
      revision: {
        id: createId('rev'),
        number: 1,
        source: input.source,
        label: input.label,
        createdAt: timestamp,
      },
      trash: { state: 'active' },
      assetHashes: input.assetHashes,
      extension: input.extension,
      createdAt: timestamp,
      updatedAt: timestamp,
      snapshot: input.snapshot,
    })
    const serialized = `${JSON.stringify({ current, revisions: [] })}\n`
    if (new TextEncoder().encode(serialized).byteLength > this.limits.maxProjectBytes) {
      throw new Error('Project exceeds the cloud storage size limit.')
    }
    const stored = await this.bucket.put(
      this.projectKey(projectId),
      serialized,
      {
        customMetadata: projectMetadata(current),
        onlyIf: { etagDoesNotMatch: '*' },
      },
    )
    if (!stored) throw new Error('Project ID conflict; retry the request.')
    return current
  }

  async listProjects(input: {
    workspaceId: unknown
    query?: string
    includeTrashed?: boolean
  }) {
    const workspaceId = parseWorkspaceId(input.workspaceId)
    if (!await this.readJson(this.workspaceKey(workspaceId))) {
      throw new Error(`Workspace ${workspaceId} was not found.`)
    }
    const query = input.query?.trim().normalize('NFKC').toLocaleLowerCase('en-US') ?? ''
    const objects = await this.listObjects(this.projectsPrefix)
    if (objects.length > this.limits.maxProjectsTotal) {
      throw new Error('Cloud project quota exceeded; archive data before listing.')
    }
    const summaries: CloudProjectSummary[] = []
    for (const object of objects) {
      const metadata = object.customMetadata?.[PROJECT_SUMMARY_METADATA_KEY]
      if (metadata) {
        summaries.push(parseProjectSummary(metadata))
      } else {
        // Sequential compatibility reads keep old deployments bounded in memory.
        const stored = await this.readJson(object.key)
        if (!stored) throw new Error(`Project disappeared while listing: ${object.key}`)
        summaries.push(projectSummary(parseStoredProject(stored.value).current))
      }
    }
    return summaries
      .filter((record) => record.workspaceId === workspaceId)
      .filter((record) => input.includeTrashed || record.trash.state === 'active')
      .filter((record) => !query || record.name.normalize('NFKC').toLocaleLowerCase('en-US').includes(query))
      .sort((left, right) => left.name.localeCompare(right.name) || left.projectId.localeCompare(right.projectId))
  }

  async getProject(projectIdValue: unknown, options: { revision?: unknown; includeTrashed?: boolean } = {}) {
    const { stored } = await this.readStoredProject(projectIdValue)
    if (!options.includeTrashed && stored.current.trash.state === 'trashed') {
      throw new Error(`Project ${stored.current.projectId} is trashed.`)
    }
    if (options.revision === undefined) return stored.current
    const revision = parseRevisionNumber(options.revision)
    if (revision === stored.current.revision.number) return stored.current
    const record = stored.revisions.find((item) => item.revision.number === revision)
    if (!record) throw new Error(`Revision ${revision} was not found.`)
    return { ...record, name: stored.current.name, trash: stored.current.trash }
  }

  async updateProject(projectIdValue: unknown, input: {
    expectedRevision: unknown
    source: RevisionSource
    label: string | null
    snapshot: unknown
    extension: ProjectExtensionV1
    assetHashes: unknown[]
  }) {
    const { projectId, etag, stored } = await this.readStoredProject(projectIdValue)
    if (stored.current.trash.state === 'trashed') {
      throw new Error(`Project ${projectId} is trashed.`)
    }
    const expectedRevision = parseRevisionNumber(input.expectedRevision)
    if (stored.current.revision.number !== expectedRevision) {
      throw new Error(`Revision conflict while updating project ${projectId}.`)
    }
    const timestamp = now()
    const current = parsePersistedProjectRecord({
      ...stored.current,
      revision: {
        id: createId('rev'),
        number: expectedRevision + 1,
        source: input.source,
        label: input.label,
        createdAt: timestamp,
      },
      snapshot: input.snapshot,
      extension: input.extension,
      assetHashes: input.assetHashes,
      updatedAt: timestamp,
    })
    const next = {
      current,
      revisions: [...stored.revisions, stored.current],
    }
    await this.replaceStoredProject(projectId, etag, next)
    return current
  }

  async listRevisions(projectIdValue: unknown) {
    const { stored } = await this.readStoredProject(projectIdValue)
    return [stored.current, ...stored.revisions]
      .sort((left, right) => right.revision.number - left.revision.number)
      .map((record) => revisionPreview(record, stored.current.revision.number))
  }

  async renameProject(projectIdValue: unknown, name: unknown) {
    const { projectId, etag, stored } = await this.readStoredProject(projectIdValue)
    if (stored.current.trash.state === 'trashed') throw new Error(`Project ${projectId} is trashed.`)
    const normalized = normalizeName(name, 'project name')
    const updatedAt = now()
    const revisions = stored.revisions.map((record) => ({ ...record, name: normalized, updatedAt }))
    const current = { ...stored.current, name: normalized, updatedAt }
    await this.replaceStoredProject(projectId, etag, { current, revisions })
    return current
  }

  async duplicateProject(projectIdValue: unknown, input: { name: unknown; targetWorkspaceId?: unknown }) {
    const source = await this.getProject(projectIdValue)
    return this.createProject({
      workspaceId: input.targetWorkspaceId ?? source.workspaceId,
      name: input.name,
      source: 'manual',
      label: null,
      snapshot: source.snapshot,
      extension: source.extension,
      assetHashes: source.assetHashes,
    })
  }

  async trashProject(projectIdValue: unknown) {
    return this.setTrash(projectIdValue, true)
  }

  async restoreProject(projectIdValue: unknown) {
    return this.setTrash(projectIdValue, false)
  }

  private async setTrash(projectIdValue: unknown, trashed: boolean) {
    const { projectId, etag, stored } = await this.readStoredProject(projectIdValue)
    if ((stored.current.trash.state === 'trashed') === trashed) {
      throw new Error(`Project ${projectId} is ${trashed ? 'already trashed' : 'not trashed'}.`)
    }
    const trash = trashed
      ? { state: 'trashed' as const, id: createId('trash'), trashedAt: now() }
      : { state: 'active' as const }
    const revisions = stored.revisions.map((record) => ({ ...record, trash }))
    const current = { ...stored.current, trash }
    await this.replaceStoredProject(projectId, etag, { current, revisions } as StoredProject)
    return parsePersistedProjectRecord(current)
  }

  async restoreRevision(projectIdValue: unknown, revisionValue: unknown) {
    const current = await this.getProject(projectIdValue)
    const revision = parseRevisionNumber(revisionValue)
    if (current.revision.number === revision) {
      throw new Error(`Revision ${revision} is already current.`)
    }
    const target = await this.getProject(projectIdValue, { revision })
    return this.updateProject(current.projectId, {
      expectedRevision: current.revision.number,
      source: 'restore',
      label: `Restored revision ${revision}`,
      snapshot: target.snapshot,
      extension: target.extension,
      assetHashes: target.assetHashes,
    })
  }
}
