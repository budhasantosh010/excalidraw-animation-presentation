import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  AssetIntegrityError,
  AssetNotFoundError,
  AssetStorageError,
  AssetValidationError,
  DEFAULT_ASSET_MAX_BYTES,
  createAssetStore,
} from './asset-store.ts'
import {
  parsePersistedProjectJson,
  type CanonicalProjectSnapshot,
} from './contracts.ts'
import { openPersistenceDatabase, type PersistenceDatabase } from './database.ts'
import { createProjectRepository } from './project-repository.ts'
import { createWorkspaceRepository } from './workspace-repository.ts'

const roots: string[] = []
const databases: PersistenceDatabase[] = []

const ordinaryFixture = parsePersistedProjectJson(
  readFileSync(
    new URL('../fixtures/ordinary-non-animated.json', import.meta.url),
    'utf8',
  ),
)

const sha256 = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex')

const createContext = async (options: {
  maxBytes?: number
  rename?: (source: string, destination: string) => Promise<void>
  createTempId?: () => string
  fileSystem?: NonNullable<
    Parameters<typeof createAssetStore>[0]['fileSystem']
  >
} = {}) => {
  const root = await mkdtemp(join(tmpdir(), 'sanverse-assets-'))
  roots.push(root)
  const persistence = await openPersistenceDatabase({
    databasePath: join(root, 'data', 'projects.sqlite'),
  })
  databases.push(persistence)
  const assetRoot = join(root, 'data', 'assets')
  return {
    root,
    assetRoot,
    persistence,
    store: createAssetStore({
      database: persistence.database,
      storageRoot: assetRoot,
      maxBytes: options.maxBytes,
      now: () => '2026-08-25T12:00:00.000Z',
      createTempId: options.createTempId ?? (() => 'fixed-temp'),
      fileSystem:
        options.fileSystem ??
        (options.rename ? { rename: options.rename } : undefined),
    }),
  }
}

afterEach(async () => {
  for (const database of databases.splice(0)) database.close()
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe('content-addressed Excalidraw asset storage', () => {
  it('stores bytes atomically by lowercase SHA-256 and returns a detached read', async () => {
    const { assetRoot, persistence, store } = await createContext()
    const input = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
    const expectedHash = sha256(input)

    const stored = await store.store({ bytes: input, mimeType: 'image/png' })
    input[8] = 99
    const firstRead = await store.read(stored.hash)
    firstRead.bytes[0] = 0
    const secondRead = await store.read(stored.hash)

    expect(stored).toEqual({
      hash: expectedHash,
      mimeType: 'image/png',
      byteSize: 11,
      createdAt: '2026-08-25T12:00:00.000Z',
    })
    expect([...secondRead.bytes]).toEqual([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
    expect(secondRead).toMatchObject(stored)
    expect(
      await readFile(
        join(assetRoot, expectedHash.slice(0, 2), expectedHash.slice(2, 4), expectedHash),
      ),
    ).toEqual(Buffer.from(secondRead.bytes))
    expect(
      persistence.database.prepare('SELECT COUNT(*) FROM assets').pluck().get(),
    ).toBe(1)
    expect(await readdir(join(assetRoot, expectedHash.slice(0, 2), expectedHash.slice(2, 4)))).toEqual([
      expectedHash,
    ])
  })

  it('deduplicates identical bytes and rejects a conflicting declared MIME type', async () => {
    const { persistence, store } = await createContext()
    const bytes = Uint8Array.from([1, 2, 3, 4])

    const first = await store.store({ bytes, mimeType: 'image/webp' })
    const second = await store.store({ bytes, mimeType: 'image/webp' })

    expect(second).toEqual(first)
    expect(
      persistence.database.prepare('SELECT COUNT(*) FROM assets').pluck().get(),
    ).toBe(1)
    await expect(
      store.store({ bytes, mimeType: 'image/png' }),
    ).rejects.toBeInstanceOf(AssetIntegrityError)
  })

  it('deduplicates concurrent writes without deleting the durable file', async () => {
    let tempIndex = 0
    const { persistence, store } = await createContext({
      createTempId: () => `temp-${++tempIndex}`,
    })
    const bytes = Uint8Array.of(5, 4, 3, 2, 1)

    const [first, second] = await Promise.all([
      store.store({ bytes, mimeType: 'image/png' }),
      store.store({ bytes, mimeType: 'image/png' }),
    ])

    expect(second).toEqual(first)
    expect(await store.read(first.hash)).toMatchObject(first)
    expect(
      persistence.database.prepare('SELECT COUNT(*) FROM assets').pluck().get(),
    ).toBe(1)
  })

  it('deduplicates a race between independent stores sharing one database and root', async () => {
    const { assetRoot, persistence } = await createContext()
    const firstStore = createAssetStore({
      database: persistence.database,
      storageRoot: assetRoot,
      createTempId: () => 'first-store',
    })
    const secondStore = createAssetStore({
      database: persistence.database,
      storageRoot: assetRoot,
      createTempId: () => 'second-store',
    })
    const bytes = Uint8Array.of(6, 2, 6, 4, 3)

    const [first, second] = await Promise.all([
      firstStore.store({ bytes, mimeType: 'image/png' }),
      secondStore.store({ bytes, mimeType: 'image/png' }),
    ])

    expect(second).toEqual(first)
    expect(await firstStore.read(first.hash)).toMatchObject(first)
    expect(await secondStore.read(second.hash)).toMatchObject(second)
    expect(
      persistence.database.prepare('SELECT COUNT(*) FROM assets').pluck().get(),
    ).toBe(1)
  })

  it('rejects unsupported MIME, empty, oversized, and expected-hash mismatches before registration', async () => {
    const { assetRoot, persistence, store } = await createContext({ maxBytes: 3 })
    const copyFailure = new Error('oversized input was copied')
    const oversized = new (class extends Uint8Array {
      override [Symbol.iterator](): ArrayIterator<number> {
        throw copyFailure
      }
    })(4)

    await expect(
      store.store({ bytes: Uint8Array.of(1), mimeType: 'text/html' }),
    ).rejects.toBeInstanceOf(AssetValidationError)
    await expect(
      store.store({ bytes: new Uint8Array(), mimeType: 'image/png' }),
    ).rejects.toBeInstanceOf(AssetValidationError)
    await expect(
      store.store({ bytes: oversized, mimeType: 'image/png' }),
    ).rejects.toBeInstanceOf(AssetValidationError)
    await expect(
      store.store({
        bytes: Uint8Array.of(1, 2),
        mimeType: 'image/png',
        expectedHash: 'a'.repeat(64),
      }),
    ).rejects.toBeInstanceOf(AssetValidationError)

    expect(
      persistence.database.prepare('SELECT COUNT(*) FROM assets').pluck().get(),
    ).toBe(0)
    await expect(readdir(assetRoot)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(DEFAULT_ASSET_MAX_BYTES).toBeGreaterThanOrEqual(1024 * 1024)
  })

  it('retains a recoverable final file and leaves no row when database registration fails', async () => {
    const { assetRoot, persistence, store } = await createContext()
    persistence.database.exec(`
      CREATE TRIGGER force_asset_insert_failure
      BEFORE INSERT ON assets
      BEGIN
        SELECT RAISE(ABORT, 'forced asset database failure');
      END;
    `)
    const bytes = Uint8Array.of(9, 8, 7)
    const hash = sha256(bytes)

    await expect(store.store({ bytes, mimeType: 'image/png' })).rejects.toThrow(
      /database|register/i,
    )

    expect(
      persistence.database.prepare('SELECT COUNT(*) FROM assets').pluck().get(),
    ).toBe(0)
    const finalPath = join(assetRoot, hash.slice(0, 2), hash.slice(2, 4), hash)
    await expect(readFile(finalPath)).resolves.toEqual(Buffer.from(bytes))

    persistence.database.exec('DROP TRIGGER force_asset_insert_failure')
    const recovered = await store.store({ bytes, mimeType: 'image/png' })
    expect(recovered.hash).toBe(hash)
    await expect(store.read(recovered.hash)).resolves.toMatchObject(recovered)
  })

  it('cleans its temporary file and registers nothing when atomic rename fails', async () => {
    const renameFailure = new Error('forced rename failure')
    const { assetRoot, persistence, store } = await createContext({
      rename: async () => {
        throw renameFailure
      },
    })
    const bytes = Uint8Array.of(4, 5, 6)
    const hash = sha256(bytes)
    const directory = join(assetRoot, hash.slice(0, 2), hash.slice(2, 4))

    await expect(store.store({ bytes, mimeType: 'image/png' })).rejects.toBeInstanceOf(
      AssetStorageError,
    )

    expect(await readdir(directory)).toEqual([])
    expect(
      persistence.database.prepare('SELECT COUNT(*) FROM assets').pluck().get(),
    ).toBe(0)
  })

  it('wraps an injected directory creation failure without registering an asset', async () => {
    const mkdirFailure = new Error('forced mkdir failure')
    const { persistence, store } = await createContext({
      fileSystem: {
        mkdir: async () => {
          throw mkdirFailure
        },
      },
    })

    const failure = await store
      .store({ bytes: Uint8Array.of(7), mimeType: 'image/png' })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(AssetStorageError)
    expect((failure as Error & { cause?: unknown }).cause).toBe(mkdirFailure)
    expect(
      persistence.database.prepare('SELECT COUNT(*) FROM assets').pluck().get(),
    ).toBe(0)
  })

  it('wraps a non-missing final-file probe failure without registering an asset', async () => {
    const readFailure = Object.assign(new Error('forced access failure'), {
      code: 'EACCES',
    })
    const { persistence, store } = await createContext({
      fileSystem: {
        readFile: async () => {
          throw readFailure
        },
      },
    })

    const failure = await store
      .store({ bytes: Uint8Array.of(8), mimeType: 'image/png' })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(AssetStorageError)
    expect((failure as Error & { cause?: unknown }).cause).toBe(readFailure)
    expect(
      persistence.database.prepare('SELECT COUNT(*) FROM assets').pluck().get(),
    ).toBe(0)
  })

  it('cleans a partial temporary write and preserves the injected write failure as cause', async () => {
    const writeFailure = new Error('forced write failure')
    const { assetRoot, persistence, store } = await createContext({
      fileSystem: {
        writeFile: async (path, bytes) => {
          await writeFile(path, bytes, { flag: 'wx' })
          throw writeFailure
        },
      },
    })
    const bytes = Uint8Array.of(1, 9, 1)
    const hash = sha256(bytes)
    const directory = join(assetRoot, hash.slice(0, 2), hash.slice(2, 4))

    const failure = await store
      .store({ bytes, mimeType: 'image/png' })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(AssetStorageError)
    expect((failure as Error & { cause?: unknown }).cause).toBe(writeFailure)
    expect(await readdir(directory)).toEqual([])
    expect(
      persistence.database.prepare('SELECT COUNT(*) FROM assets').pluck().get(),
    ).toBe(0)
  })

  it('keeps the primary failure when best-effort temporary cleanup also fails', async () => {
    const writeFailure = new Error('primary write failure')
    const cleanupFailure = new Error('secondary cleanup failure')
    const { persistence, store } = await createContext({
      fileSystem: {
        mkdir: async (path) => {
          await mkdir(path, { recursive: true })
        },
        writeFile: async (path, bytes) => {
          await writeFile(path, bytes, { flag: 'wx' })
          throw writeFailure
        },
        rm: async (path) => {
          await rm(path, { force: true })
          throw cleanupFailure
        },
      },
    })

    const failure = await store
      .store({ bytes: Uint8Array.of(3, 1, 4), mimeType: 'image/png' })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(AssetStorageError)
    expect((failure as Error & { cause?: unknown }).cause).toBe(writeFailure)
    expect(
      persistence.database.prepare('SELECT COUNT(*) FROM assets').pluck().get(),
    ).toBe(0)
  })

  it('fails closed when an existing deduplicated file is corrupt', async () => {
    const { assetRoot, store } = await createContext()
    const bytes = Uint8Array.of(1, 3, 3, 7)
    const stored = await store.store({ bytes, mimeType: 'image/png' })
    const path = join(assetRoot, stored.hash.slice(0, 2), stored.hash.slice(2, 4), stored.hash)
    await import('node:fs/promises').then(({ writeFile }) => writeFile(path, Uint8Array.of(0)))

    await expect(
      store.store({ bytes, mimeType: 'image/png' }),
    ).rejects.toBeInstanceOf(AssetIntegrityError)
  })

  it('reports missing and corrupt durable files with explicit typed errors', async () => {
    const { assetRoot, store } = await createContext()
    const first = await store.store({ bytes: Uint8Array.of(2, 4, 6), mimeType: 'image/gif' })
    const firstPath = join(assetRoot, first.hash.slice(0, 2), first.hash.slice(2, 4), first.hash)
    await unlink(firstPath)
    await expect(store.read(first.hash)).rejects.toBeInstanceOf(AssetNotFoundError)

    const second = await store.store({ bytes: Uint8Array.of(8, 6, 4), mimeType: 'image/jpeg' })
    const secondPath = join(assetRoot, second.hash.slice(0, 2), second.hash.slice(2, 4), second.hash)
    await import('node:fs/promises').then(({ writeFile }) => writeFile(secondPath, Uint8Array.of(1)))
    await expect(store.read(second.hash)).rejects.toBeInstanceOf(AssetIntegrityError)
  })

  it('links a stored hash through the project repository without rewriting embedded Excalidraw files', async () => {
    const { persistence, store } = await createContext()
    const asset = await store.store({
      bytes: Uint8Array.from([137, 80, 78, 71, 0]),
      mimeType: 'image/png',
    })
    const workspace = createWorkspaceRepository(persistence.database, {
      createId: () => 'ws_20000000000000000000000000000001',
      now: () => '2026-08-25T12:00:00.000Z',
    }).create({ name: 'Assets' })
    const snapshot = structuredClone(ordinaryFixture.snapshot) as CanonicalProjectSnapshot
    snapshot.files = {
      'image-file-1': {
        id: 'image-file-1',
        dataURL: 'data:image/png;base64,iVBORw0KGgo=',
        mimeType: 'image/png',
        created: 1,
      },
    } as never
    const repository = createProjectRepository(persistence.database, {
      createProjectId: () => 'prj_20000000000000000000000000000001',
      createRevisionId: () => 'rev_20000000000000000000000000000001',
      now: () => '2026-08-25T12:00:00.000Z',
    })

    const created = repository.create({
      workspaceId: workspace.id,
      name: 'Embedded file board',
      source: 'manual',
      snapshot,
      extension: ordinaryFixture.extension,
      assetHashes: [asset.hash],
    })
    const reopened = repository.get(created.projectId)

    expect(reopened.assetHashes).toEqual([asset.hash])
    expect(reopened.snapshot).toEqual(snapshot)
    expect(JSON.stringify(reopened.snapshot)).not.toContain('/assets/')
    expect(JSON.stringify(reopened.snapshot)).not.toContain('http://')
    expect(JSON.stringify(reopened.snapshot)).not.toContain('https://')
  })
})
