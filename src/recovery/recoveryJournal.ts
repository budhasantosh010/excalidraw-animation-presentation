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
} from '../../mcp/persistence/contracts.ts'

export const RECOVERY_JOURNAL_KEY_PREFIX =
  'sanverse-animation-recovery-journal-v1:'
const RECOVERY_JOURNAL_ACK_KEY_PREFIX =
  `${RECOVERY_JOURNAL_KEY_PREFIX}ack:`

export type RecoveryJournalIdentity = {
  id: string
  contentFingerprint: string
  updatedAt: string
}

export type RecoveryJournalV1 = {
  version: 1
  projectId: ProjectId
  baseRevision: RevisionNumber
  createdAt: string
  updatedAt: string
  identity: RecoveryJournalIdentity
  candidate: PersistedProjectRecord
}

export type RecoveryAssessment =
  | { status: 'none' }
  | { status: 'already-durable'; journal: RecoveryJournalV1 }
  | { status: 'offer'; journal: RecoveryJournalV1 }
  | {
      status: 'conflict'
      journal: RecoveryJournalV1
      durableRevision: RevisionNumber
    }

export type RecoveryStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export class RecoveryJournalValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'RecoveryJournalValidationError'
  }
}

export class RecoveryJournalStorageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'RecoveryJournalStorageError'
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const parseTimestamp = (value: unknown, label: string) => {
  if (
    typeof value !== 'string' ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new RecoveryJournalValidationError(
      `Invalid recovery journal ${label}; expected a canonical ISO timestamp.`,
    )
  }
  return value
}

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

const browserFingerprint = (value: unknown) => {
  const text = stableJson(value)
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    first = Math.imul(first ^ code, 0x01000193)
    second = Math.imul(second ^ code, 0x85ebca6b)
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0)
    .toString(16)
    .padStart(8, '0')}`
}

const contentFingerprint = (
  value: Pick<
    PersistedProjectRecord,
    'snapshot' | 'extension' | 'assetHashes'
  >,
) =>
  browserFingerprint({
    snapshot: value.snapshot,
    extension: value.extension,
    assetHashes: [...value.assetHashes].sort(),
  })

const canonicalContent = (
  value: Pick<
    PersistedProjectRecord,
    'snapshot' | 'extension' | 'assetHashes'
  >,
) =>
  stableJson({
    snapshot: value.snapshot,
    extension: value.extension,
    assetHashes: [...value.assetHashes].sort(),
  })

const parseIdentity = (value: unknown): RecoveryJournalIdentity => {
  if (!isRecord(value)) {
    throw new RecoveryJournalValidationError(
      'Invalid recovery journal identity.',
    )
  }
  const keys = Object.keys(value).sort()
  if (keys.join(',') !== 'contentFingerprint,id,updatedAt') {
    throw new RecoveryJournalValidationError(
      'Invalid recovery journal identity fields.',
    )
  }
  if (
    typeof value.id !== 'string' ||
    value.id.length < 1 ||
    value.id.length > 128 ||
    !/^[A-Za-z0-9._-]+$/.test(value.id)
  ) {
    throw new RecoveryJournalValidationError('Invalid recovery journal ID.')
  }
  if (
    typeof value.contentFingerprint !== 'string' ||
    !/^[0-9a-f]{16}$/.test(value.contentFingerprint)
  ) {
    throw new RecoveryJournalValidationError(
      'Invalid recovery journal content fingerprint.',
    )
  }
  return {
    id: value.id,
    contentFingerprint: value.contentFingerprint,
    updatedAt: parseTimestamp(value.updatedAt, 'identity timestamp'),
  }
}

const parseJournal = (
  value: unknown,
  expectedProjectId: ProjectId,
): RecoveryJournalV1 => {
  if (!isRecord(value)) {
    throw new RecoveryJournalValidationError('Invalid recovery journal.')
  }
  const keys = Object.keys(value).sort()
  if (
    keys.join(',') !==
    'baseRevision,candidate,createdAt,identity,projectId,updatedAt,version'
  ) {
    throw new RecoveryJournalValidationError(
      'Invalid recovery journal fields.',
    )
  }
  if (value.version !== 1) {
    throw new RecoveryJournalValidationError(
      'Unsupported recovery journal version.',
    )
  }
  const projectId = parseProjectId(value.projectId)
  if (projectId !== expectedProjectId) {
    throw new RecoveryJournalValidationError(
      'Recovery journal project does not match its storage key.',
    )
  }
  const baseRevision = parseRevisionNumber(value.baseRevision)
  const createdAt = parseTimestamp(value.createdAt, 'created timestamp')
  const updatedAt = parseTimestamp(value.updatedAt, 'updated timestamp')
  const identity = parseIdentity(value.identity)
  if (identity.updatedAt !== updatedAt) {
    throw new RecoveryJournalValidationError(
      'Recovery journal identity timestamp does not match.',
    )
  }
  let candidate: PersistedProjectRecord
  try {
    candidate = parsePersistedProjectRecord(value.candidate)
  } catch (error) {
    throw new RecoveryJournalValidationError(
      'Invalid recovery journal project snapshot.',
      { cause: error },
    )
  }
  if (
    candidate.projectId !== projectId ||
    candidate.revision.number !== baseRevision
  ) {
    throw new RecoveryJournalValidationError(
      'Recovery journal candidate identity or revision does not match.',
    )
  }
  if (identity.contentFingerprint !== contentFingerprint(candidate)) {
    throw new RecoveryJournalValidationError(
      'Recovery journal content fingerprint does not match its snapshot.',
    )
  }
  return {
    version: 1,
    projectId,
    baseRevision,
    createdAt,
    updatedAt,
    identity,
    candidate,
  }
}

const sameIdentity = (
  first: RecoveryJournalIdentity,
  second: RecoveryJournalIdentity,
) =>
  first.id === second.id &&
  first.contentFingerprint === second.contentFingerprint &&
  first.updatedAt === second.updatedAt

export const createRecoveryJournal = ({
  storage,
  now = () => new Date().toISOString(),
  createId = () => globalThis.crypto.randomUUID(),
}: {
  storage: RecoveryStorage
  now?: () => string
  createId?: () => string
}) => {
  const keyFor = (projectIdValue: ProjectId | string) =>
    `${RECOVERY_JOURNAL_KEY_PREFIX}${parseProjectId(projectIdValue)}`

  const ackKeyFor = (projectIdValue: ProjectId | string) =>
    `${RECOVERY_JOURNAL_ACK_KEY_PREFIX}${parseProjectId(projectIdValue)}`

  const readIdentity = (projectId: ProjectId) => {
    let serialized: string | null
    try {
      serialized = storage.getItem(ackKeyFor(projectId))
    } catch (error) {
      throw new RecoveryJournalStorageError(
        `Recovery journal acknowledgement for ${projectId} could not be read.`,
        { cause: error },
      )
    }
    if (serialized === null) return undefined
    try {
      return parseIdentity(JSON.parse(serialized) as unknown)
    } catch (error) {
      if (error instanceof RecoveryJournalValidationError) throw error
      throw new RecoveryJournalValidationError(
        `Recovery journal acknowledgement for ${projectId} is invalid.`,
        { cause: error },
      )
    }
  }

  const writeIdentity = (
    projectId: ProjectId,
    identity: RecoveryJournalIdentity,
  ) => {
    try {
      storage.setItem(ackKeyFor(projectId), JSON.stringify(identity))
    } catch (error) {
      throw new RecoveryJournalStorageError(
        `Recovery journal acknowledgement for ${projectId} could not be written.`,
        { cause: error },
      )
    }
  }

  const read = (projectIdValue: ProjectId | string) => {
    const projectId = parseProjectId(projectIdValue)
    let serialized: string | null
    try {
      serialized = storage.getItem(keyFor(projectId))
    } catch (error) {
      throw new RecoveryJournalStorageError(
        `Recovery journal for ${projectId} could not be read.`,
        { cause: error },
      )
    }
    if (serialized === null) return undefined
    let parsed: unknown
    try {
      parsed = JSON.parse(serialized) as unknown
    } catch (error) {
      throw new RecoveryJournalValidationError(
        `Recovery journal for ${projectId} contains malformed JSON.`,
        { cause: error },
      )
    }
    try {
      const journal = parseJournal(parsed, projectId)
      const acknowledged = readIdentity(projectId)
      if (acknowledged && sameIdentity(journal.identity, acknowledged)) {
        return undefined
      }
      return structuredClone(journal)
    } catch (error) {
      if (error instanceof RecoveryJournalValidationError) throw error
      throw new RecoveryJournalValidationError(
        `Recovery journal for ${projectId} is invalid.`,
        { cause: error },
      )
    }
  }

  const remove = (
    projectIdValue: ProjectId | string,
    identity: RecoveryJournalIdentity,
  ) => {
    const projectId = parseProjectId(projectIdValue)
    const current = read(projectId)
    if (!current || !sameIdentity(current.identity, identity)) return false
    writeIdentity(projectId, current.identity)
    return true
  }

  const write = (
    durableValue: PersistedProjectRecord,
    edit: {
      expectedRevision: unknown
      snapshot: CanonicalProjectSnapshot
      extension: ProjectExtensionV1
      assetHashes: readonly AssetHash[]
    },
  ) => {
    let durable: PersistedProjectRecord
    let baseRevision: RevisionNumber
    let candidate: PersistedProjectRecord
    try {
      durable = parsePersistedProjectRecord(durableValue)
      baseRevision = parseRevisionNumber(edit.expectedRevision)
      if (baseRevision !== durable.revision.number) {
        throw new RecoveryJournalValidationError(
          `Recovery journal expected revision ${baseRevision} does not match durable revision ${durable.revision.number}.`,
        )
      }
      candidate = parsePersistedProjectRecord({
        ...durable,
        revision: { ...durable.revision, number: baseRevision },
        snapshot: edit.snapshot,
        extension: edit.extension,
        assetHashes: edit.assetHashes,
      })
    } catch (error) {
      if (error instanceof RecoveryJournalValidationError) throw error
      throw new RecoveryJournalValidationError(
        'Recovery journal edit is invalid.',
        { cause: error },
      )
    }
    const existing = read(durable.projectId)
    const timestamp = parseTimestamp(now(), 'write timestamp')
    const fingerprint = contentFingerprint(candidate)
    const journal = parseJournal(
      {
        version: 1,
        projectId: durable.projectId,
        baseRevision,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
        identity: {
          id: createId(),
          contentFingerprint: fingerprint,
          updatedAt: timestamp,
        },
        candidate,
      },
      durable.projectId,
    )
    try {
      storage.setItem(keyFor(durable.projectId), JSON.stringify(journal))
    } catch (error) {
      throw new RecoveryJournalStorageError(
        `Recovery journal for ${durable.projectId} could not be written.`,
        { cause: error },
      )
    }
    return structuredClone(journal)
  }

  const assessRecord = (
    durable: PersistedProjectRecord,
    journal: RecoveryJournalV1,
  ): Exclude<RecoveryAssessment, { status: 'none' }> => {
    if (journal.baseRevision > durable.revision.number) {
      throw new RecoveryJournalValidationError(
        `Recovery journal revision ${journal.baseRevision} is newer than durable revision ${durable.revision.number}.`,
      )
    }
    if (
      journal.identity.contentFingerprint === contentFingerprint(durable) &&
      canonicalContent(journal.candidate) === canonicalContent(durable)
    ) {
      return { status: 'already-durable', journal }
    }
    if (journal.baseRevision === durable.revision.number) {
      return { status: 'offer', journal }
    }
    return {
      status: 'conflict',
      journal,
      durableRevision: durable.revision.number,
    }
  }

  const assess = (durableValue: PersistedProjectRecord): RecoveryAssessment => {
    const durable = parsePersistedProjectRecord(durableValue)
    const journal = read(durable.projectId)
    if (!journal) return { status: 'none' }
    return assessRecord(durable, journal)
  }

  const acknowledge = (
    durableValue: PersistedProjectRecord,
    identity: RecoveryJournalIdentity,
  ) => {
    const durable = parsePersistedProjectRecord(durableValue)
    const current = read(durable.projectId)
    if (!current || !sameIdentity(current.identity, identity)) return false
    if (assessRecord(durable, current).status !== 'already-durable') return false
    writeIdentity(durable.projectId, current.identity)
    return true
  }

  return { keyFor, ackKeyFor, read, write, assess, acknowledge, remove }
}
