import { createHash, randomUUID } from 'node:crypto'
import {
  mkdir as nodeMkdir,
  readFile as nodeReadFile,
  rename as nodeRename,
  rm as nodeRm,
  writeFile as nodeWriteFile,
} from 'node:fs/promises'
import { join } from 'node:path'

import type Database from 'better-sqlite3'

import { parseAssetHash, type AssetHash } from './contracts.ts'

export const DEFAULT_ASSET_MAX_BYTES = 25 * 1024 * 1024

export const EXCALIDRAW_ASSET_MIME_TYPES = [
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/svg+xml',
  'image/webp',
] as const

export type ExcalidrawAssetMimeType =
  (typeof EXCALIDRAW_ASSET_MIME_TYPES)[number]

export type StoredAsset = {
  hash: AssetHash
  mimeType: ExcalidrawAssetMimeType
  byteSize: number
  createdAt: string
}

export type ReadAsset = StoredAsset & {
  bytes: Uint8Array
}

export type StoreAssetInput = {
  bytes: Uint8Array
  mimeType: string
  expectedHash?: string
}

type AssetStoreFileSystem = {
  mkdir(path: string): Promise<void>
  readFile(path: string): Promise<Uint8Array>
  writeFile(path: string, bytes: Uint8Array): Promise<void>
  rename(source: string, destination: string): Promise<void>
  rm(path: string): Promise<void>
}

export type CreateAssetStoreOptions = {
  database: Database.Database
  storageRoot: string
  maxBytes?: number
  now?: () => string
  createTempId?: () => string
  fileSystem?: Partial<AssetStoreFileSystem>
}

export type AssetStore = {
  store(input: StoreAssetInput): Promise<StoredAsset>
  read(hash: AssetHash | string): Promise<ReadAsset>
}

type AssetRow = {
  hash: string
  mime_type: string
  byte_size: number
  storage_path: string
  created_at: string
}

export class AssetValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AssetValidationError'
  }
}

export class AssetIntegrityError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AssetIntegrityError'
  }
}

export class AssetNotFoundError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AssetNotFoundError'
  }
}

export class AssetStorageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AssetStorageError'
  }
}

const allowedMimeTypes = new Set<string>(EXCALIDRAW_ASSET_MIME_TYPES)

const isFileNotFoundError = (error: unknown) =>
  error instanceof Error &&
  'code' in error &&
  (error as NodeJS.ErrnoException).code === 'ENOENT'

const computeHash = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex')

const relativeStoragePath = (hash: AssetHash) =>
  `${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}`

const absoluteStoragePath = (storageRoot: string, hash: AssetHash) =>
  join(storageRoot, hash.slice(0, 2), hash.slice(2, 4), hash)

const parseMimeType = (value: unknown): ExcalidrawAssetMimeType => {
  if (typeof value !== 'string' || !allowedMimeTypes.has(value)) {
    throw new AssetValidationError(
      `Unsupported asset MIME type; expected one of ${EXCALIDRAW_ASSET_MIME_TYPES.join(', ')}.`,
    )
  }
  return value as ExcalidrawAssetMimeType
}

const parseMaxBytes = (value: number | undefined) => {
  const maxBytes = value ?? DEFAULT_ASSET_MAX_BYTES
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new AssetValidationError(
      'Asset maximum size must be a positive safe integer.',
    )
  }
  return maxBytes
}

const metadataFromRow = (row: AssetRow): StoredAsset => ({
  hash: parseAssetHash(row.hash),
  mimeType: parseMimeType(row.mime_type),
  byteSize: row.byte_size,
  createdAt: row.created_at,
})

export const createAssetStore = ({
  database,
  storageRoot,
  maxBytes: configuredMaxBytes,
  now = () => new Date().toISOString(),
  createTempId = () => randomUUID(),
  fileSystem: fileSystemOverrides = {},
}: CreateAssetStoreOptions): AssetStore => {
  if (!database) throw new AssetValidationError('Asset database is required.')
  if (typeof storageRoot !== 'string' || storageRoot.trim().length === 0) {
    throw new AssetValidationError('Asset storage root is required.')
  }
  const maxBytes = parseMaxBytes(configuredMaxBytes)
  const fileSystem: AssetStoreFileSystem = {
    mkdir: async (path) => {
      await nodeMkdir(path, { recursive: true })
    },
    readFile: nodeReadFile,
    writeFile: async (path, bytes) => {
      await nodeWriteFile(path, bytes, { flag: 'wx' })
    },
    rename: nodeRename,
    rm: async (path) => {
      await nodeRm(path, { force: true })
    },
    ...fileSystemOverrides,
  }
  const readRow = database.prepare(
    'SELECT hash, mime_type, byte_size, storage_path, created_at FROM assets WHERE hash = ?',
  )
  const insertRow = database.prepare(
    `INSERT INTO assets (hash, mime_type, byte_size, storage_path, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
  const pendingStores = new Map<AssetHash, Promise<StoredAsset>>()

  const bestEffortRemove = async (path: string) => {
    try {
      await fileSystem.rm(path)
    } catch {
      // Preserve the primary write/database failure. Recovery can remove orphans.
    }
  }

  const validateFile = async (row: AssetRow, notFoundIsMissing: boolean) => {
    const hash = parseAssetHash(row.hash)
    const expectedRelativePath = relativeStoragePath(hash)
    if (row.storage_path !== expectedRelativePath) {
      throw new AssetIntegrityError(
        `Asset ${hash} has an unexpected durable storage path.`,
      )
    }
    let bytes: Uint8Array
    try {
      bytes = await fileSystem.readFile(absoluteStoragePath(storageRoot, hash))
    } catch (error) {
      if (isFileNotFoundError(error) && notFoundIsMissing) {
        throw new AssetNotFoundError(`Asset ${hash} is registered but its file is missing.`, {
          cause: error,
        })
      }
      throw new AssetStorageError(`Asset ${hash} could not be read.`, { cause: error })
    }
    if (bytes.byteLength !== row.byte_size || computeHash(bytes) !== hash) {
      throw new AssetIntegrityError(
        `Asset ${hash} failed its stored size or SHA-256 integrity check.`,
      )
    }
    return Uint8Array.from(bytes)
  }

  const read = async (hashValue: AssetHash | string): Promise<ReadAsset> => {
    let hash: AssetHash
    try {
      hash = parseAssetHash(hashValue)
    } catch (error) {
      throw new AssetValidationError('Invalid asset hash.', { cause: error })
    }
    const row = readRow.get(hash) as AssetRow | undefined
    if (!row) {
      throw new AssetNotFoundError(`Asset ${hash} is not registered.`)
    }
    const metadata = metadataFromRow(row)
    if (!Number.isSafeInteger(metadata.byteSize) || metadata.byteSize < 1) {
      throw new AssetIntegrityError(`Asset ${hash} has invalid stored byte size.`)
    }
    return { ...metadata, bytes: await validateFile(row, true) }
  }

  const store = async (input: StoreAssetInput): Promise<StoredAsset> => {
    if (!(input.bytes instanceof Uint8Array)) {
      throw new AssetValidationError('Asset bytes must be a Uint8Array.')
    }
    const mimeType = parseMimeType(input.mimeType)
    if (input.bytes.byteLength === 0) {
      throw new AssetValidationError('Empty assets are not allowed.')
    }
    if (input.bytes.byteLength > maxBytes) {
      throw new AssetValidationError(
        `Asset exceeds the configured maximum of ${maxBytes} bytes.`,
      )
    }
    const bytes = Uint8Array.from(input.bytes)
    const hash = parseAssetHash(computeHash(bytes))
    if (input.expectedHash !== undefined) {
      let expectedHash: AssetHash
      try {
        expectedHash = parseAssetHash(input.expectedHash)
      } catch (error) {
        throw new AssetValidationError('Invalid expected asset hash.', { cause: error })
      }
      if (expectedHash !== hash) {
        throw new AssetValidationError(
          `Asset SHA-256 does not match the expected hash ${expectedHash}.`,
        )
      }
    }

    const pending = pendingStores.get(hash)
    if (pending) {
      const metadata = await pending
      if (metadata.mimeType !== mimeType) {
        throw new AssetIntegrityError(
          `Asset ${hash} conflicts with its registered MIME type.`,
        )
      }
      return metadata
    }

    const operation = (async () => {
      const existing = readRow.get(hash) as AssetRow | undefined
      if (existing) {
        const metadata = metadataFromRow(existing)
        if (
          metadata.mimeType !== mimeType ||
          metadata.byteSize !== bytes.byteLength
        ) {
          throw new AssetIntegrityError(
            `Asset ${hash} conflicts with its registered MIME type or byte size.`,
          )
        }
        await validateFile(existing, true)
        return metadata
      }

      const directory = join(storageRoot, hash.slice(0, 2), hash.slice(2, 4))
      const finalPath = absoluteStoragePath(storageRoot, hash)
      const tempPath = join(directory, `.${hash}.${createTempId()}.tmp`)
      let tempExists = false
      try {
        try {
          await fileSystem.mkdir(directory)
        } catch (error) {
          throw new AssetStorageError(
            `Asset ${hash} storage directory could not be created.`,
            { cause: error },
          )
        }
        try {
          const orphanBytes = await fileSystem.readFile(finalPath)
          if (
            orphanBytes.byteLength !== bytes.byteLength ||
            computeHash(orphanBytes) !== hash
          ) {
            throw new AssetIntegrityError(
              `Unregistered asset file ${hash} exists but is corrupt.`,
            )
          }
        } catch (error) {
          if (error instanceof AssetIntegrityError) throw error
          if (!isFileNotFoundError(error)) {
            throw new AssetStorageError(
              `Asset ${hash} durable path could not be inspected.`,
              { cause: error },
            )
          }
          tempExists = true
          try {
            await fileSystem.writeFile(tempPath, bytes)
          } catch (error) {
            throw new AssetStorageError(
              `Asset ${hash} temporary file could not be written.`,
              { cause: error },
            )
          }
          try {
            await fileSystem.rename(tempPath, finalPath)
          } catch (error) {
            for (let attempt = 0; attempt < 10; attempt += 1) {
              const winner = readRow.get(hash) as AssetRow | undefined
              if (winner) {
                const metadata = metadataFromRow(winner)
                if (
                  metadata.mimeType !== mimeType ||
                  metadata.byteSize !== bytes.byteLength
                ) {
                  throw new AssetIntegrityError(
                    `Asset ${hash} conflicts with its winning registration.`,
                  )
                }
                await validateFile(winner, true)
                return metadata
              }
              await new Promise<void>((resolve) => setTimeout(resolve, 1))
            }
            throw new AssetStorageError(
              `Asset ${hash} could not be committed atomically.`,
              { cause: error },
            )
          }
          tempExists = false
        }

        const createdAt = now()
        try {
          database.transaction(() => {
            insertRow.run(
              hash,
              mimeType,
              bytes.byteLength,
              relativeStoragePath(hash),
              createdAt,
            )
          }).immediate()
        } catch (error) {
          const winner = readRow.get(hash) as AssetRow | undefined
          if (winner) {
            const metadata = metadataFromRow(winner)
            if (
              metadata.mimeType !== mimeType ||
              metadata.byteSize !== bytes.byteLength
            ) {
              throw new AssetIntegrityError(
                `Asset ${hash} conflicts with its winning registration.`,
              )
            }
            await validateFile(winner, true)
            return metadata
          }
          throw new AssetStorageError(
            `Asset ${hash} could not be registered in the database.`,
            { cause: error },
          )
        }
        return { hash, mimeType, byteSize: bytes.byteLength, createdAt }
      } finally {
        if (tempExists) await bestEffortRemove(tempPath)
      }
    })()
    pendingStores.set(hash, operation)
    try {
      return await operation
    } finally {
      if (pendingStores.get(hash) === operation) pendingStores.delete(hash)
    }
  }

  return { store, read }
}
