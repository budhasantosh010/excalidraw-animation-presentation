import { describe, expect, it } from 'vitest'

import ordinaryFixture from '../../mcp/fixtures/ordinary-non-animated.json'
import animatedFixture from '../../mcp/fixtures/v1-independent-connected-steps.json'
import { parsePersistedProjectJson } from '../../mcp/persistence/contracts.ts'
import {
  RecoveryJournalStorageError,
  RecoveryJournalValidationError,
  createRecoveryJournal,
} from './recoveryJournal.ts'

const ordinary = parsePersistedProjectJson(
  JSON.stringify(ordinaryFixture),
)
const animated = parsePersistedProjectJson(
  JSON.stringify(animatedFixture),
)

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>()
  get length() {
    return this.values.size
  }
  clear() {
    this.values.clear()
  }
  getItem(key: string) {
    return this.values.get(key) ?? null
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }
  removeItem(key: string) {
    this.values.delete(key)
  }
  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

const createJournal = (storage = new MemoryStorage()) => {
  const timestamps = [
    '2026-08-26T00:00:00.000Z',
    '2026-08-26T00:01:00.000Z',
    '2026-08-26T00:02:00.000Z',
  ]
  let timestampIndex = 0
  let idIndex = 0
  return {
    storage,
    journal: createRecoveryJournal({
      storage,
      now: () => timestamps[timestampIndex++]!,
      createId: () => `journal-${++idIndex}`,
    }),
  }
}

describe('browser recovery journal', () => {
  it('round-trips exact detached unsent edits across journal instances', () => {
    const { journal, storage } = createJournal()
    const snapshot = structuredClone(animated.snapshot)

    const written = journal.write(ordinary, {
      expectedRevision: ordinary.revision.number,
      snapshot,
      extension: animated.extension,
      assetHashes: animated.assetHashes,
    })
    snapshot.elements[0]!.x = 9999

    const reloaded = createRecoveryJournal({ storage }).read(ordinary.projectId)
    expect(reloaded).toEqual(written)
    expect(reloaded?.candidate.snapshot).toEqual(animated.snapshot)
    reloaded!.candidate.snapshot.elements[0]!.x = -9999
    expect(createRecoveryJournal({ storage }).read(ordinary.projectId)).toEqual(
      written,
    )
  })

  it('offers recovery for changed content on the same durable revision', () => {
    const { journal } = createJournal()
    const written = journal.write(ordinary, {
      expectedRevision: ordinary.revision.number,
      snapshot: animated.snapshot,
      extension: animated.extension,
      assetHashes: animated.assetHashes,
    })

    expect(journal.assess(ordinary)).toEqual({ status: 'offer', journal: written })
  })

  it('detects already-durable content and clears only the exact acknowledged journal', () => {
    const { journal } = createJournal()
    const written = journal.write(ordinary, {
      expectedRevision: ordinary.revision.number,
      snapshot: ordinary.snapshot,
      extension: ordinary.extension,
      assetHashes: ordinary.assetHashes,
    })

    expect(journal.assess(ordinary)).toEqual({
      status: 'already-durable',
      journal: written,
    })
    expect(journal.acknowledge(ordinary, written.identity)).toBe(true)
    expect(journal.assess(ordinary)).toEqual({ status: 'none' })
  })

  it('reports a conflict when durable history advanced and rejects future journals', () => {
    const { journal, storage } = createJournal()
    const stale = journal.write(ordinary, {
      expectedRevision: ordinary.revision.number,
      snapshot: animated.snapshot,
      extension: animated.extension,
      assetHashes: animated.assetHashes,
    })
    const newerDurable = structuredClone(ordinary)
    newerDurable.revision.number = 2 as typeof newerDurable.revision.number

    expect(journal.assess(newerDurable)).toEqual({
      status: 'conflict',
      journal: stale,
      durableRevision: newerDurable.revision.number,
    })

    expect(journal.remove(ordinary.projectId, stale.identity)).toBe(true)
    const current = journal.write(newerDurable, {
      expectedRevision: 2,
      snapshot: animated.snapshot,
      extension: animated.extension,
      assetHashes: animated.assetHashes,
    })
    const corrupted = JSON.parse(
      storage.getItem(journal.keyFor(ordinary.projectId))!,
    ) as Record<string, unknown> & {
      candidate: { revision: { number: number } }
    }
    corrupted.baseRevision = 3
    corrupted.candidate.revision.number = 3
    storage.setItem(journal.keyFor(ordinary.projectId), JSON.stringify(corrupted))
    expect(() => journal.assess(newerDurable)).toThrow(
      RecoveryJournalValidationError,
    )
    expect(current.baseRevision).toBe(2)
  })

  it('does not let an older acknowledgement clear a newer journal', () => {
    const { journal } = createJournal()
    const first = journal.write(ordinary, {
      expectedRevision: ordinary.revision.number,
      snapshot: ordinary.snapshot,
      extension: ordinary.extension,
      assetHashes: ordinary.assetHashes,
    })
    const second = journal.write(ordinary, {
      expectedRevision: ordinary.revision.number,
      snapshot: animated.snapshot,
      extension: animated.extension,
      assetHashes: animated.assetHashes,
    })

    expect(journal.acknowledge(ordinary, first.identity)).toBe(false)
    expect(journal.read(ordinary.projectId)).toEqual(second)
  })

  it('preserves a newer cross-context journal written during acknowledgement', () => {
    const { journal, storage } = createJournal()
    const first = journal.write(ordinary, {
      expectedRevision: ordinary.revision.number,
      snapshot: ordinary.snapshot,
      extension: ordinary.extension,
      assetHashes: ordinary.assetHashes,
    })
    const mainKey = journal.keyFor(ordinary.projectId)
    const firstSerialized = storage.getItem(mainKey)!
    const second = journal.write(ordinary, {
      expectedRevision: ordinary.revision.number,
      snapshot: animated.snapshot,
      extension: animated.extension,
      assetHashes: animated.assetHashes,
    })
    const secondSerialized = storage.getItem(mainKey)!
    storage.setItem(mainKey, firstSerialized)

    const originalSet = storage.setItem.bind(storage)
    storage.setItem = (key, value) => {
      if (key === journal.ackKeyFor(ordinary.projectId)) {
        originalSet(mainKey, secondSerialized)
      }
      originalSet(key, value)
    }

    expect(journal.acknowledge(ordinary, first.identity)).toBe(true)
    expect(journal.read(ordinary.projectId)).toEqual(second)
  })

  it('isolates journals for different projects', () => {
    const { journal } = createJournal()
    const secondProject = structuredClone(ordinary)
    secondProject.projectId =
      'prj_20000000000000000000000000000002' as typeof secondProject.projectId
    const first = journal.write(ordinary, {
      expectedRevision: 1,
      snapshot: animated.snapshot,
      extension: animated.extension,
      assetHashes: animated.assetHashes,
    })
    const second = journal.write(secondProject, {
      expectedRevision: 1,
      snapshot: ordinary.snapshot,
      extension: ordinary.extension,
      assetHashes: ordinary.assetHashes,
    })

    expect(journal.read(ordinary.projectId)).toEqual(first)
    expect(journal.read(secondProject.projectId)).toEqual(second)
    expect(journal.remove(ordinary.projectId, first.identity)).toBe(true)
    expect(journal.read(secondProject.projectId)).toEqual(second)
  })

  it('fails visibly for malformed journals and storage read/write/remove failures', () => {
    const { journal, storage } = createJournal()
    storage.setItem(
      journal.keyFor(ordinary.projectId),
      JSON.stringify({ version: 1, projectId: ordinary.projectId }),
    )
    expect(() => journal.read(ordinary.projectId)).toThrow(
      RecoveryJournalValidationError,
    )

    const failing = {
      getItem() {
        throw new Error('read failed')
      },
      setItem() {
        throw new Error('quota exceeded')
      },
      removeItem() {
        throw new Error('remove failed')
      },
    }
    const broken = createRecoveryJournal({ storage: failing })
    expect(() => broken.read(ordinary.projectId)).toThrow(
      RecoveryJournalStorageError,
    )

    const writeBroken = createRecoveryJournal({
      storage: { ...failing, getItem: () => null },
    })
    expect(() =>
      writeBroken.write(ordinary, {
        expectedRevision: 1,
        snapshot: animated.snapshot,
        extension: animated.extension,
        assetHashes: animated.assetHashes,
      }),
    ).toThrow(RecoveryJournalStorageError)

    const removableStorage = new MemoryStorage()
    const removable = createRecoveryJournal({
      storage: removableStorage,
      now: () => '2026-08-26T00:03:00.000Z',
      createId: () => 'journal-remove',
    })
    const removableEntry = removable.write(ordinary, {
      expectedRevision: 1,
      snapshot: animated.snapshot,
      extension: animated.extension,
      assetHashes: animated.assetHashes,
    })
    const removeBroken = createRecoveryJournal({
      storage: {
        getItem: (key) => removableStorage.getItem(key),
        setItem: () => {
          throw new Error('remove tombstone failed')
        },
        removeItem: (key) => removableStorage.removeItem(key),
      },
    })
    expect(() =>
      removeBroken.remove(ordinary.projectId, removableEntry.identity),
    ).toThrow(
      RecoveryJournalStorageError,
    )
  })

  it('rejects malformed edit data before mutating storage', () => {
    const { journal, storage } = createJournal()
    const malformed = structuredClone(animated.snapshot)
    malformed.elements[0]!.x = Number.NaN

    expect(() =>
      journal.write(ordinary, {
        expectedRevision: 1,
        snapshot: malformed,
        extension: animated.extension,
        assetHashes: animated.assetHashes,
      }),
    ).toThrow(RecoveryJournalValidationError)
    expect(storage.length).toBe(0)
  })

  it('rejects stale or future base revisions before mutating storage', () => {
    const { journal, storage } = createJournal()

    expect(() =>
      journal.write(ordinary, {
        expectedRevision: 2,
        snapshot: animated.snapshot,
        extension: animated.extension,
        assetHashes: animated.assetHashes,
      }),
    ).toThrow(RecoveryJournalValidationError)
    expect(storage.length).toBe(0)
  })
})
