import { getElementAnimation } from '../../src/animation.ts'
import type { ExcalidrawDocument } from '../animation-tools.ts'

declare const persistenceIdBrand: unique symbol

type BrandedId<Kind extends string> = string & {
  readonly [persistenceIdBrand]: Kind
}

export type WorkspaceId = BrandedId<'WorkspaceId'>
export type ProjectId = BrandedId<'ProjectId'>
export type RevisionId = BrandedId<'RevisionId'>
export type TrashId = BrandedId<'TrashId'>
export type AssetHash = BrandedId<'AssetHash'>
export type RevisionNumber = number & {
  readonly [persistenceIdBrand]: 'RevisionNumber'
}

export type RevisionSource =
  | 'manual'
  | 'autosave'
  | 'import'
  | 'mcp'
  | 'recovery'
  | 'restore'

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

export type ProjectExtensionV1 = {
  version: 1
  timeline?: {
    version: number
    [key: string]: JsonValue
  }
  [key: string]: JsonValue | undefined
}

export type ProjectTrashState =
  | { state: 'active' }
  | { state: 'trashed'; id: TrashId; trashedAt: string }

export type ProjectRevision = {
  id: RevisionId
  number: RevisionNumber
  source: RevisionSource
  label: string | null
  createdAt: string
}

export type CanonicalProjectSnapshot = ExcalidrawDocument &
  Record<string, unknown>

export type PersistedProjectRecord = {
  schemaVersion: 1
  workspaceId: WorkspaceId
  projectId: ProjectId
  name: string
  revision: ProjectRevision
  trash: ProjectTrashState
  assetHashes: AssetHash[]
  extension: ProjectExtensionV1
  createdAt: string
  updatedAt: string
  snapshot: CanonicalProjectSnapshot
}

const revisionSources = new Set<RevisionSource>([
  'manual',
  'autosave',
  'import',
  'mcp',
  'recovery',
  'restore',
])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const parsePrefixedId = <Kind extends string>(
  value: unknown,
  prefix: string,
  label: string,
) => {
  const pattern = new RegExp(`^${prefix}_[0-9a-f]{32}$`)
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(`Invalid ${label}.`)
  }
  return value as BrandedId<Kind>
}

export const parseWorkspaceId = (value: unknown): WorkspaceId =>
  parsePrefixedId<'WorkspaceId'>(value, 'ws', 'workspace ID')

export const parseProjectId = (value: unknown): ProjectId =>
  parsePrefixedId<'ProjectId'>(value, 'prj', 'project ID')

export const parseRevisionId = (value: unknown): RevisionId =>
  parsePrefixedId<'RevisionId'>(value, 'rev', 'revision ID')

export const parseTrashId = (value: unknown): TrashId =>
  parsePrefixedId<'TrashId'>(value, 'trash', 'trash ID')

export const parseAssetHash = (value: unknown): AssetHash => {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error('Invalid asset hash; expected lowercase SHA-256 hex.')
  }
  return value as AssetHash
}

export const parseRevisionNumber = (value: unknown): RevisionNumber => {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error('Invalid revision number; expected a positive safe integer.')
  }
  return value as RevisionNumber
}

const parseTimestamp = (value: unknown, label: string) => {
  if (
    typeof value !== 'string' ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error(`Invalid ${label}; expected a canonical ISO timestamp.`)
  }
  return value
}

function assertJsonCompatible(
  value: unknown,
  path: string,
  ancestors = new Set<object>(),
): asserts value is JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new Error(`Invalid JSON number at ${path}.`)
    }
    return
  }
  if (typeof value !== 'object') {
    throw new Error(`Invalid non-JSON value at ${path}.`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (
    Array.isArray(value)
      ? prototype !== Array.prototype
      : prototype !== Object.prototype && prototype !== null
  ) {
    throw new Error(`Invalid non-plain JSON object at ${path}.`)
  }
  if (ancestors.has(value)) throw new Error(`Cyclic value at ${path}.`)

  ancestors.add(value)
  if (Array.isArray(value)) {
    const ownKeys = Reflect.ownKeys(value)
    const elementKeys: string[] = []
    for (const key of ownKeys) {
      if (typeof key === 'symbol') {
        throw new Error(`Invalid symbol property on JSON array at ${path}.`)
      }
      if (key === 'length') continue
      const index = Number(key)
      if (
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index >= value.length ||
        String(index) !== key
      ) {
        throw new Error(`Invalid extra JSON array property at ${path}.${key}.`)
      }
      elementKeys.push(key)
    }
    if (elementKeys.length !== value.length) {
      throw new Error(`Invalid sparse JSON array at ${path}.`)
    }
    for (const key of elementKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        throw new Error(`Invalid JSON array property at ${path}[${key}].`)
      }
      assertJsonCompatible(descriptor.value, `${path}[${key}]`, ancestors)
    }
  } else {
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === 'symbol') {
        throw new Error(`Invalid symbol property on JSON object at ${path}.`)
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        throw new Error(`Invalid non-enumerable JSON property at ${path}.${key}.`)
      }
      assertJsonCompatible(descriptor.value, `${path}.${key}`, ancestors)
    }
  }
  ancestors.delete(value)
}

const validateSnapshot = (value: unknown): CanonicalProjectSnapshot => {
  if (!isRecord(value)) throw new Error('Invalid project snapshot.')
  if (
    value.type !== 'excalidraw' ||
    value.version !== 2 ||
    value.source !== 'local' ||
    !Array.isArray(value.elements) ||
    !isRecord(value.appState) ||
    !isRecord(value.files)
  ) {
    throw new Error(
      value.source !== 'local'
        ? 'Invalid project snapshot source; expected local.'
        : 'Invalid Excalidraw project snapshot.',
    )
  }

  const elementIds = new Set<string>()
  for (const [index, candidate] of value.elements.entries()) {
    if (!isRecord(candidate)) {
      throw new Error(`Invalid Excalidraw element at index ${index}.`)
    }
    if (
      typeof candidate.id !== 'string' ||
      candidate.id.length < 1 ||
      candidate.id.length > 128 ||
      elementIds.has(candidate.id)
    ) {
      throw new Error(`Invalid or duplicate element ID at index ${index}.`)
    }
    elementIds.add(candidate.id)
    if (typeof candidate.type !== 'string' || candidate.type.length === 0) {
      throw new Error(`Invalid Excalidraw element at index ${index}.`)
    }

    for (const field of [
      'x',
      'y',
      'width',
      'height',
      'angle',
      'opacity',
    ] as const) {
      if (!Number.isFinite(candidate[field])) {
        throw new Error(
          `Invalid Excalidraw element ${candidate.id}: ${field} must be finite.`,
        )
      }
    }
    for (const field of ['seed', 'versionNonce'] as const) {
      if (!Number.isSafeInteger(candidate[field])) {
        throw new Error(
          `Invalid Excalidraw element ${candidate.id}: ${field} must be a safe integer.`,
        )
      }
    }
    if (!Number.isSafeInteger(candidate.version) || Number(candidate.version) < 1) {
      throw new Error(
        `Invalid Excalidraw element ${candidate.id}: version must be a positive safe integer.`,
      )
    }
    if (!Number.isSafeInteger(candidate.updated) || Number(candidate.updated) < 0) {
      throw new Error(
        `Invalid Excalidraw element ${candidate.id}: updated must be a non-negative safe integer.`,
      )
    }
    if (
      !Array.isArray(candidate.groupIds) ||
      candidate.groupIds.some((groupId) => typeof groupId !== 'string')
    ) {
      throw new Error(
        `Invalid Excalidraw element ${candidate.id}: groupIds must be a string array.`,
      )
    }
    for (const field of ['isDeleted', 'locked'] as const) {
      if (typeof candidate[field] !== 'boolean') {
        throw new Error(
          `Invalid Excalidraw element ${candidate.id}: ${field} must be boolean.`,
        )
      }
    }

    const customData = candidate.customData
    if (
      isRecord(customData) &&
      Object.hasOwn(customData, 'sanverseAnimation') &&
      !getElementAnimation(candidate as never)
    ) {
      throw new Error(`Invalid animation metadata: ${candidate.id}.`)
    }
  }

  assertJsonCompatible(value.appState, 'snapshot.appState')
  assertJsonCompatible(value.files, 'snapshot.files')
  assertJsonCompatible(value, 'snapshot')
  return value as CanonicalProjectSnapshot
}

const validateExtension = (value: unknown): ProjectExtensionV1 => {
  if (!isRecord(value) || value.version !== 1) {
    throw new Error('Invalid or unsupported project extension version.')
  }
  if (value.timeline !== undefined) {
    if (
      !isRecord(value.timeline) ||
      !Number.isSafeInteger(value.timeline.version) ||
      Number(value.timeline.version) < 1
    ) {
      throw new Error('Invalid timeline extension.')
    }
  }
  assertJsonCompatible(value, 'extension')
  return value as ProjectExtensionV1
}

const validateRevision = (value: unknown): ProjectRevision => {
  if (!isRecord(value)) throw new Error('Invalid project revision.')
  const source = value.source
  if (typeof source !== 'string' || !revisionSources.has(source as RevisionSource)) {
    throw new Error('Invalid revision source.')
  }
  if (
    value.label !== null &&
    (typeof value.label !== 'string' ||
      value.label.trim().length === 0 ||
      value.label.length > 200)
  ) {
    throw new Error('Invalid revision label.')
  }
  return {
    id: parseRevisionId(value.id),
    number: parseRevisionNumber(value.number),
    source: source as RevisionSource,
    label: value.label as string | null,
    createdAt: parseTimestamp(value.createdAt, 'revision timestamp'),
  }
}

const validateTrashState = (value: unknown): ProjectTrashState => {
  if (!isRecord(value)) throw new Error('Invalid trash state.')
  if (value.state === 'active') return value as { state: 'active' }
  if (value.state === 'trashed') {
    return {
      ...value,
      state: 'trashed',
      id: parseTrashId(value.id),
      trashedAt: parseTimestamp(value.trashedAt, 'trash timestamp'),
    }
  }
  throw new Error('Invalid trash state.')
}

export const parsePersistedProjectRecord = (
  value: unknown,
): PersistedProjectRecord => {
  assertJsonCompatible(value, 'record')
  if (!isRecord(value)) throw new Error('Invalid persisted project record.')
  if (value.schemaVersion !== 1) {
    throw new Error('Invalid or unsupported persisted project schema version.')
  }
  if (
    typeof value.name !== 'string' ||
    value.name.trim().length === 0 ||
    value.name.length > 200
  ) {
    throw new Error('Invalid project name.')
  }
  if (!Array.isArray(value.assetHashes)) {
    throw new Error('Invalid asset hash list.')
  }
  const assetHashes = value.assetHashes.map(parseAssetHash)
  if (new Set(assetHashes).size !== assetHashes.length) {
    throw new Error('Invalid duplicate asset hash.')
  }

  const parsed: PersistedProjectRecord = {
    schemaVersion: 1,
    workspaceId: parseWorkspaceId(value.workspaceId),
    projectId: parseProjectId(value.projectId),
    name: value.name,
    revision: validateRevision(value.revision),
    trash: validateTrashState(value.trash),
    assetHashes,
    extension: validateExtension(value.extension),
    createdAt: parseTimestamp(value.createdAt, 'project creation timestamp'),
    updatedAt: parseTimestamp(value.updatedAt, 'project update timestamp'),
    snapshot: validateSnapshot(value.snapshot),
  }

  return structuredClone(parsed)
}

export const parsePersistedProjectJson = (
  serialized: string,
): PersistedProjectRecord => {
  if (typeof serialized !== 'string') {
    throw new Error('Invalid serialized project; expected JSON text.')
  }
  let value: unknown
  try {
    value = JSON.parse(serialized)
  } catch {
    throw new Error('Invalid serialized project JSON.')
  }
  return parsePersistedProjectRecord(value)
}

export const serializePersistedProjectRecord = (
  value: unknown,
): string => JSON.stringify(parsePersistedProjectRecord(value))

/**
 * Writers must provide the revision they read. A write is allowed only when
 * that expected revision exactly equals the current durable revision.
 */
export const assertExpectedRevision = (
  currentRevision: unknown,
  expectedRevision: unknown,
): RevisionNumber => {
  const current = parseRevisionNumber(currentRevision)
  const expected = parseRevisionNumber(expectedRevision)
  if (current !== expected) {
    throw new Error(
      `Revision conflict: expected revision ${expected}, current revision is ${current}.`,
    )
  }
  return current
}
