import {
  parsePersistedProjectRecord,
  type PersistedProjectRecord,
} from '../mcp/persistence/contracts.ts'
import { getElementAnimation } from './animation.ts'

export type WorkspaceRecord = {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export type ProjectSummary = {
  workspaceId: string
  projectId: string
  name: string
  currentRevision: number
  createdAt: string
  updatedAt: string
  trash: { state: 'active' } | { state: 'trashed'; id: string; trashedAt: string }
}

export type RevisionPreview = {
  revisionNumber: number
  source: string
  label: string | null
  createdAt: string
  isCurrent: boolean
  elementCount: number
  animatedElementCount: number
  stepCount: number
  assetCount: number
}

type StoredProject = {
  current: PersistedProjectRecord
  revisions: PersistedProjectRecord[]
}

type BrowserWorkspaceState = {
  workspaces: WorkspaceRecord[]
  projects: Record<string, StoredProject>
}

const STORAGE_KEY = 'sanverse-browser-workspaces-v1'
const DATABASE_NAME = 'sanverse-browser-workspaces'
const DATABASE_STORE = 'state'
const DATABASE_VERSION = 1
const MUTATION_LOCK_NAME = 'sanverse-browser-workspaces-state-v1'
const MAX_REVISIONS_PER_PROJECT = 50
const MAX_INDEXED_DB_STATE_BYTES = 64 * 1024 * 1024
const MAX_LOCAL_STORAGE_STATE_BYTES = 4 * 1024 * 1024
const DEFAULT_WORKSPACE_ID = 'ws_00000000000000000000000000000001'
const encoder = new TextEncoder()

const timestamp = () => new Date().toISOString()
const id = (prefix: 'ws' | 'prj' | 'rev' | 'trash') =>
  `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`

const normalizeName = (value: unknown, label: string) => {
  if (typeof value !== 'string') throw new Error(`Invalid ${label}.`)
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (!normalized || normalized.length > 200) {
    throw new Error(`Invalid ${label}; expected 1 to 200 characters.`)
  }
  return normalized
}

const emptyState = (): BrowserWorkspaceState => ({ workspaces: [], projects: {} })

const parseState = (value: unknown): BrowserWorkspaceState => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid browser workspace state.')
  }
  const parsed = value as BrowserWorkspaceState
  if (!Array.isArray(parsed.workspaces) || !parsed.projects || typeof parsed.projects !== 'object') {
    throw new Error('Invalid browser workspace state.')
  }
  return parsed
}

const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
  request.onupgradeneeded = () => {
    const database = request.result
    if (!database.objectStoreNames.contains(DATABASE_STORE)) {
      database.createObjectStore(DATABASE_STORE)
    }
  }
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error ?? new Error('IndexedDB could not be opened.'))
})

const loadIndexedDbState = async () => {
  const database = await openDatabase()
  try {
    return await new Promise<BrowserWorkspaceState | null>((resolve, reject) => {
      const transaction = database.transaction(DATABASE_STORE, 'readonly')
      const request = transaction.objectStore(DATABASE_STORE).get(STORAGE_KEY)
      request.onsuccess = () => resolve(request.result ? parseState(request.result) : null)
      request.onerror = () => reject(request.error ?? new Error('Browser workspace data could not be read.'))
    })
  } finally {
    database.close()
  }
}

const loadLocalStorageState = (): BrowserWorkspaceState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyState()
    return parseState(JSON.parse(raw))
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Browser workspace data is corrupted.')
    if (error instanceof Error && error.message === 'Invalid browser workspace state.') throw error
    return emptyState()
  }
}

const loadState = async (): Promise<BrowserWorkspaceState> => {
  if (typeof indexedDB !== 'undefined') {
    try {
      const indexedState = await loadIndexedDbState()
      if (indexedState) return indexedState
      const legacyState = loadLocalStorageState()
      if (legacyState.workspaces.length || Object.keys(legacyState.projects).length) {
        await saveIndexedDbState(compactState(legacyState, MAX_INDEXED_DB_STATE_BYTES))
        localStorage.removeItem(STORAGE_KEY)
      }
      return legacyState
    } catch {
      // Private browsing and hardened browser profiles can disable IndexedDB.
    }
  }
  return loadLocalStorageState()
}

const serializedBytes = (value: unknown) => encoder.encode(JSON.stringify(value)).byteLength

const compactState = (state: BrowserWorkspaceState, maxBytes: number) => {
  for (const project of Object.values(state.projects)) {
    if (project.revisions.length > MAX_REVISIONS_PER_PROJECT) {
      project.revisions.splice(0, project.revisions.length - MAX_REVISIONS_PER_PROJECT)
    }
  }

  while (serializedBytes(state) > maxBytes) {
    const oldest = Object.values(state.projects)
      .filter(({ revisions }) => revisions.length)
      .sort((left, right) =>
        left.revisions[0]!.revision.createdAt.localeCompare(right.revisions[0]!.revision.createdAt))[0]
    if (!oldest) {
      throw new Error('Browser workspace data exceeds the storage safety limit. Export or remove projects.')
    }
    oldest.revisions.shift()
  }
  return state
}

const saveIndexedDbState = async (state: BrowserWorkspaceState) => {
  const database = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(DATABASE_STORE, 'readwrite')
      transaction.objectStore(DATABASE_STORE).put(state, STORAGE_KEY)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('Browser workspace data could not be saved.'))
      transaction.onabort = () => reject(transaction.error ?? new Error('Browser workspace save was aborted.'))
    })
  } finally {
    database.close()
  }
}

const saveState = async (state: BrowserWorkspaceState) => {
  try {
    if (typeof indexedDB !== 'undefined') {
      await saveIndexedDbState(compactState(state, MAX_INDEXED_DB_STATE_BYTES))
      return
    }
    const compacted = compactState(state, MAX_LOCAL_STORAGE_STATE_BYTES)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(compacted))
  } catch {
    throw new Error('Browser storage is full or unavailable. Export projects before clearing site data.')
  }
}

let fallbackMutationQueue = Promise.resolve()

const mutateState = async <Result>(
  mutation: (state: BrowserWorkspaceState) => Result,
): Promise<Result> => {
  const locks = typeof navigator === 'undefined'
    ? undefined
    : (navigator as Navigator & { locks?: LockManager }).locks
  if (locks) {
    return locks.request(MUTATION_LOCK_NAME, async () => {
      const state = await loadState()
      const result = mutation(state)
      await saveState(state)
      return result
    })
  }
  if (typeof indexedDB !== 'undefined') {
    throw new Error('This browser cannot safely coordinate project saves across tabs.')
  }

  let release!: () => void
  const previous = fallbackMutationQueue
  fallbackMutationQueue = new Promise<void>((resolve) => { release = resolve })
  await previous
  try {
    const state = await loadState()
    const result = mutation(state)
    await saveState(state)
    return result
  } finally {
    release()
  }
}

const ensureDefaultWorkspace = (state: BrowserWorkspaceState) => {
  if (state.workspaces.length) return state.workspaces[0]!
  const now = timestamp()
  const workspace: WorkspaceRecord = {
    id: DEFAULT_WORKSPACE_ID,
    name: 'My Workspace',
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  }
  state.workspaces.push(workspace)
  return workspace
}

const summary = (record: PersistedProjectRecord): ProjectSummary => ({
  workspaceId: record.workspaceId,
  projectId: record.projectId,
  name: record.name,
  currentRevision: record.revision.number,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  trash: record.trash,
})

const requireProject = (state: BrowserWorkspaceState, projectId: string) => {
  const project = state.projects[projectId]
  if (!project) throw new Error(`Project ${projectId} was not found.`)
  return project
}

const createProjectRecord = (
  state: BrowserWorkspaceState,
  input: {
    workspaceId: string
    name: string
    snapshot: PersistedProjectRecord['snapshot']
    extension: PersistedProjectRecord['extension']
  },
) => {
  if (!state.workspaces.some(({ id }) => id === input.workspaceId)) {
    throw new Error(`Workspace ${input.workspaceId} was not found.`)
  }
  const now = timestamp()
  const projectId = id('prj')
  const current = parsePersistedProjectRecord({
    schemaVersion: 1,
    workspaceId: input.workspaceId,
    projectId,
    name: normalizeName(input.name, 'project name'),
    revision: {
      id: id('rev'),
      number: 1,
      source: 'manual',
      label: 'Created',
      createdAt: now,
    },
    trash: { state: 'active' },
    assetHashes: [],
    extension: structuredClone(input.extension),
    createdAt: now,
    updatedAt: now,
    snapshot: structuredClone(input.snapshot),
  })
  state.projects[projectId] = { current, revisions: [] }
  return current
}

const revisionPreview = (
  record: PersistedProjectRecord,
  currentRevision: number,
): RevisionPreview => {
  const elements = record.snapshot.elements.filter(({ isDeleted }) => isDeleted !== true)
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

export const workspaceApi = {
  bootstrap: async () => {
    return mutateState((state) => {
      const selected = ensureDefaultWorkspace(state)
      return {
        workspaces: state.workspaces.filter(({ archivedAt }) => archivedAt === null),
        selectedWorkspaceId: selected.id,
        projects: Object.values(state.projects)
          .map(({ current }) => current)
          .filter(({ workspaceId, trash }) => workspaceId === selected.id && trash.state === 'active')
          .map(summary),
      }
    })
  },
  createWorkspace: async (name: string) => mutateState((state) => {
    const now = timestamp()
    const workspace: WorkspaceRecord = {
      id: id('ws'),
      name: normalizeName(name, 'workspace name'),
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    }
    state.workspaces.push(workspace)
    return workspace
  }),
  listProjects: async (
    workspaceId: string,
    options: { query?: string; includeTrashed?: boolean } = {},
  ) => {
    const state = await loadState()
    const query = options.query?.trim().normalize('NFKC').toLocaleLowerCase('en-US') ?? ''
    return Object.values(state.projects)
      .map(({ current }) => current)
      .filter((record) => record.workspaceId === workspaceId)
      .filter((record) => options.includeTrashed || record.trash.state === 'active')
      .filter((record) => !query || record.name.normalize('NFKC').toLocaleLowerCase('en-US').includes(query))
      .map(summary)
      .sort((left, right) => left.name.localeCompare(right.name))
  },
  createProject: async (input: {
    workspaceId: string
    name: string
    snapshot: PersistedProjectRecord['snapshot']
    extension: PersistedProjectRecord['extension']
  }) => mutateState((state) => createProjectRecord(state, input)),
  getProject: async (projectId: string) =>
    structuredClone(requireProject(await loadState(), projectId).current),
  listRevisions: async (projectId: string) => {
    const project = requireProject(await loadState(), projectId)
    return [project.current, ...project.revisions]
      .sort((left, right) => right.revision.number - left.revision.number)
      .map((record) => revisionPreview(record, project.current.revision.number))
  },
  action: async <Result = PersistedProjectRecord>(
    projectId: string,
    body: Record<string, unknown>,
  ) => mutateState((state) => {
    const project = requireProject(state, projectId)
    const current = project.current
    if (body.action === 'save') {
      if (body.expectedRevision !== current.revision.number) throw new Error('Revision conflict.')
      const now = timestamp()
      project.revisions.push(structuredClone(current))
      project.current = parsePersistedProjectRecord({
        ...current,
        revision: {
          id: id('rev'),
          number: current.revision.number + 1,
          source: body.source === 'recovery' ? 'recovery' : 'autosave',
          label: null,
          createdAt: now,
        },
        snapshot: structuredClone(body.snapshot as PersistedProjectRecord['snapshot']),
        extension: structuredClone(body.extension as PersistedProjectRecord['extension']),
        updatedAt: now,
      })
    } else if (body.action === 'rename') {
      const name = normalizeName(body.name, 'project name')
      project.current = parsePersistedProjectRecord({
        ...current,
        name,
        updatedAt: timestamp(),
      })
      project.revisions = project.revisions.map((record) =>
        parsePersistedProjectRecord({ ...record, name }))
    } else if (body.action === 'duplicate') {
      return createProjectRecord(state, {
        workspaceId: typeof body.targetWorkspaceId === 'string'
          ? body.targetWorkspaceId
          : current.workspaceId,
        name: normalizeName(body.name, 'project name'),
        snapshot: current.snapshot,
        extension: current.extension,
      }) as Result
    } else if (body.action === 'trash' || body.action === 'restore-trash') {
      const trash = body.action === 'trash'
        ? { state: 'trashed' as const, id: id('trash'), trashedAt: timestamp() }
        : { state: 'active' as const }
      project.current = parsePersistedProjectRecord({ ...current, trash })
      project.revisions = project.revisions.map((record) =>
        parsePersistedProjectRecord({ ...record, trash }))
    } else if (body.action === 'restore-revision') {
      const revisionNumber = Number(body.revisionNumber)
      const target = [current, ...project.revisions]
        .find(({ revision }) => revision.number === revisionNumber)
      if (!target) throw new Error(`Revision ${revisionNumber} was not found.`)
      const now = timestamp()
      project.revisions.push(structuredClone(current))
      project.current = parsePersistedProjectRecord({
        ...current,
        revision: {
          id: id('rev'),
          number: current.revision.number + 1,
          source: 'restore',
          label: `Restored revision ${revisionNumber}`,
          createdAt: now,
        },
        snapshot: structuredClone(target.snapshot),
        extension: structuredClone(target.extension),
        assetHashes: [...target.assetHashes],
        updatedAt: now,
      })
    } else {
      throw new Error('Unsupported project action.')
    }
    return structuredClone(project.current) as Result
  }),
}
