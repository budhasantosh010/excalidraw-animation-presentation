import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { getElementAnimation } from '../../src/animation.ts'
import {
  assertExpectedRevision,
  parseAssetHash,
  parsePersistedProjectJson,
  parsePersistedProjectRecord,
  parseProjectId,
  parseRevisionId,
  parseRevisionNumber,
  parseTrashId,
  parseWorkspaceId,
  serializePersistedProjectRecord,
} from './contracts.ts'

const fixtureNames = [
  'ordinary-non-animated.json',
  'v1-independent-connected-steps.json',
  'mcp-generated-animation.json',
  'stress-24-drawable-12-step.json',
] as const

const readFixture = (name: (typeof fixtureNames)[number]) =>
  readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')

describe('persistence identifiers', () => {
  it.each([
    [parseWorkspaceId, 'ws_00000000000000000000000000000001'],
    [parseProjectId, 'prj_00000000000000000000000000000001'],
    [parseRevisionId, 'rev_00000000000000000000000000000001'],
    [parseTrashId, 'trash_00000000000000000000000000000001'],
  ])('accepts a canonical identifier', (parse, value) => {
    expect(parse(value)).toBe(value)
  })

  it.each([
    [parseWorkspaceId, 'workspace-1'],
    [parseProjectId, 'prj_UPPERCASE00000000000000000000000'],
    [parseRevisionId, '../rev_00000000000000000000000000000001'],
    [parseTrashId, 'trash_1'],
  ])('rejects a malformed identifier', (parse, value) => {
    expect(() => parse(value)).toThrow(/invalid/i)
  })

  it('accepts only lowercase SHA-256 asset hashes', () => {
    const hash = 'a'.repeat(64)
    expect(parseAssetHash(hash)).toBe(hash)
    expect(() => parseAssetHash('A'.repeat(64))).toThrow(/asset hash/i)
    expect(() => parseAssetHash('a'.repeat(63))).toThrow(/asset hash/i)
  })
})

describe('persisted project compatibility', () => {
  it.each(fixtureNames)('%s parses and round-trips without data loss', (name) => {
    const parsed = parsePersistedProjectJson(readFixture(name))
    const roundTripped = parsePersistedProjectJson(
      serializePersistedProjectRecord(parsed),
    )

    expect(roundTripped).toEqual(parsed)
  })

  it('preserves unknown project-extension and snapshot fields', () => {
    const input = JSON.parse(readFixture('ordinary-non-animated.json'))
    input.extension.futureProjectField = { enabled: true }
    input.extension.timeline = {
      version: 17,
      futureTimelineField: ['preserve', 'verbatim'],
    }
    input.snapshot.futureExcalidrawField = { value: 42 }

    const parsed = parsePersistedProjectRecord(input)

    expect(parsed.extension.futureProjectField).toEqual({ enabled: true })
    expect(parsed.extension.timeline).toEqual({
      version: 17,
      futureTimelineField: ['preserve', 'verbatim'],
    })
    expect(parsed.snapshot.futureExcalidrawField).toEqual({ value: 42 })
  })

  it('detaches parsed data from the input in both mutation directions', () => {
    const input = JSON.parse(readFixture('ordinary-non-animated.json'))
    const parsed = parsePersistedProjectRecord(input)

    input.extension.fixtureKind = 'changed-after-parse'
    input.snapshot.elements[0].x = 999
    expect(parsed.extension.fixtureKind).toBe('ordinary')
    expect(parsed.snapshot.elements[0].x).toBe(100)

    parsed.extension.fixtureKind = 'changed-parsed-output'
    parsed.snapshot.elements[0].x = 777
    expect(input.extension.fixtureKind).toBe('changed-after-parse')
    expect(input.snapshot.elements[0].x).toBe(999)
  })

  it('keeps the v1 effect vocabulary exactly unchanged', () => {
    const effects = new Set<string>()
    for (const name of fixtureNames) {
      const record = parsePersistedProjectJson(readFixture(name))
      for (const element of record.snapshot.elements) {
        const animation = getElementAnimation(element as never)
        if (animation) effects.add(animation.effect)
      }
    }

    expect([...effects].sort()).toEqual([
      'appear',
      'auto',
      'draw',
      'fade',
      'pop',
    ])
  })

  it('retains independent steps for connected v1 elements', () => {
    const record = parsePersistedProjectJson(
      readFixture('v1-independent-connected-steps.json'),
    )
    const rectangle = record.snapshot.elements.find(
      (element) => element.id === 'connected-box',
    )
    const arrow = record.snapshot.elements.find(
      (element) => element.id === 'connected-arrow',
    )

    expect(getElementAnimation(rectangle as never)?.step).toBe(1)
    expect(getElementAnimation(arrow as never)?.step).toBe(2)
  })

  it('retains 24 drawable elements across 12 animation steps', () => {
    const record = parsePersistedProjectJson(
      readFixture('stress-24-drawable-12-step.json'),
    )
    const drawable = record.snapshot.elements.filter(
      (element) => !element.isDeleted && element.type !== 'frame',
    )
    const steps = new Set(
      drawable.map((element) => getElementAnimation(element as never)?.step),
    )

    expect(drawable).toHaveLength(24)
    expect([...steps].sort((left, right) => Number(left) - Number(right))).toEqual(
      Array.from({ length: 12 }, (_, index) => index + 1),
    )
  })
})

describe('fail-closed persistence parsing', () => {
  it.each([
    ['not JSON', '{'],
    ['an array', '[]'],
    ['a malformed snapshot', '{"schemaVersion":1,"snapshot":{}}'],
  ])('rejects %s', (_case, value) => {
    expect(() => parsePersistedProjectJson(value)).toThrow()
  })

  it('rejects invalid animation metadata rather than dropping it', () => {
    const input = JSON.parse(readFixture('mcp-generated-animation.json'))
    input.snapshot.elements[1].customData.sanverseAnimation.effect = 'slide'

    expect(() => parsePersistedProjectRecord(input)).toThrow(
      /animation metadata/i,
    )
  })

  it('rejects any snapshot source other than the canonical local source', () => {
    const input = JSON.parse(readFixture('ordinary-non-animated.json'))
    input.snapshot.source = 'https://example.invalid'

    expect(() => parsePersistedProjectRecord(input)).toThrow(/snapshot.*source/i)
  })

  it.each([
    ['Date extension value', () => new Date('2026-01-01T00:00:00.000Z')],
    ['Map extension value', () => new Map([['key', 'value']])],
  ])('rejects a non-plain %s', (_case, makeValue) => {
    const input = JSON.parse(readFixture('ordinary-non-animated.json'))
    input.extension.invalidValue = makeValue()

    expect(() => parsePersistedProjectRecord(input)).toThrow(/json|plain/i)
  })

  it('rejects sparse arrays that JSON would silently densify', () => {
    const input = JSON.parse(readFixture('ordinary-non-animated.json'))
    input.extension.invalidValue = Array(2)

    expect(() => parsePersistedProjectRecord(input)).toThrow(/sparse|json/i)
  })

  it('rejects a maximum-length sparse array without declared-length work', () => {
    const input = JSON.parse(readFixture('ordinary-non-animated.json'))
    input.extension.invalidValue = Array(2 ** 32 - 1)
    const startedAt = performance.now()

    expect(() => parsePersistedProjectRecord(input)).toThrow(
      /sparse json array/i,
    )
    expect(performance.now() - startedAt).toBeLessThan(250)
  })

  it('rejects extra and symbol properties on arrays', () => {
    const withExtra = JSON.parse(readFixture('ordinary-non-animated.json'))
    withExtra.assetHashes.extra = 'silently-dropped'
    expect(() => parsePersistedProjectRecord(withExtra)).toThrow(/json|property/i)

    const withSymbol = JSON.parse(readFixture('ordinary-non-animated.json'))
    withSymbol.assetHashes[Symbol('hidden')] = 'silently-dropped'
    expect(() => parsePersistedProjectRecord(withSymbol)).toThrow(/json|symbol/i)
  })

  it('rejects non-enumerable and symbol properties on objects', () => {
    const withHidden = JSON.parse(readFixture('ordinary-non-animated.json'))
    Object.defineProperty(withHidden.extension, 'hidden', {
      value: 'silently-dropped',
      enumerable: false,
    })
    expect(() => parsePersistedProjectRecord(withHidden)).toThrow(
      /json|enumerable/i,
    )

    const withSymbol = JSON.parse(readFixture('ordinary-non-animated.json'))
    withSymbol.extension[Symbol('hidden')] = 'silently-dropped'
    expect(() => parsePersistedProjectRecord(withSymbol)).toThrow(/json|symbol/i)
  })

  it('validates unknown top-level and trash-state fields before trusting data', () => {
    const withTopLevelExtra = JSON.parse(
      readFixture('ordinary-non-animated.json'),
    )
    withTopLevelExtra.futureField = new Date('2026-01-01T00:00:00.000Z')
    expect(() => parsePersistedProjectRecord(withTopLevelExtra)).toThrow(
      /json|plain/i,
    )

    const withTrashExtra = JSON.parse(readFixture('ordinary-non-animated.json'))
    withTrashExtra.trash.futureField = new Map([['key', 'value']])
    expect(() => parsePersistedProjectRecord(withTrashExtra)).toThrow(
      /json|plain/i,
    )
  })

  it('accepts a sanitized asset reference and trashed state', () => {
    const input = JSON.parse(readFixture('ordinary-non-animated.json'))
    const hash = 'a'.repeat(64)
    input.assetHashes = [hash]
    input.snapshot.files = {
      'fixture-file': {
        id: 'fixture-file',
        mimeType: 'image/png',
        dataURL: 'data:image/png;base64,',
        created: 1,
      },
    }
    input.trash = {
      state: 'trashed',
      id: 'trash_00000000000000000000000000000001',
      trashedAt: '2026-01-02T00:00:00.000Z',
    }

    const parsed = parsePersistedProjectRecord(input)
    expect(parsed.assetHashes).toEqual([hash])
    expect(parsed.trash).toEqual(input.trash)
    expect(parsed.snapshot.files).toEqual(input.snapshot.files)
  })

  it('rejects duplicate element IDs and malformed revisions', () => {
    const input = JSON.parse(readFixture('mcp-generated-animation.json'))
    input.snapshot.elements[2].id = input.snapshot.elements[1].id
    expect(() => parsePersistedProjectRecord(input)).toThrow(/element id/i)

    expect(() => parseRevisionNumber(0)).toThrow(/revision/i)
    expect(() => parseRevisionNumber(1.5)).toThrow(/revision/i)
  })

  it.each([
    ['x', undefined],
    ['y', Number.NaN],
    ['width', Number.POSITIVE_INFINITY],
    ['height', '120'],
    ['angle', undefined],
    ['opacity', undefined],
    ['seed', 1.5],
    ['version', 0],
    ['versionNonce', undefined],
    ['updated', -1],
    ['groupIds', null],
    ['isDeleted', undefined],
    ['locked', undefined],
  ])('rejects an element with invalid required %s', (field, invalidValue) => {
    const input = JSON.parse(readFixture('ordinary-non-animated.json'))
    const candidate = input.snapshot.elements[0]
    if (invalidValue === undefined) delete candidate[field]
    else candidate[field] = invalidValue

    expect(() => parsePersistedProjectRecord(input)).toThrow(
      new RegExp(`element.*${field}`, 'i'),
    )
  })

  it('rejects an optimistic revision mismatch', () => {
    expect(() => assertExpectedRevision(8, 7)).toThrow(
      /expected revision 7.*current revision is 8/i,
    )
    expect(assertExpectedRevision(8, 8)).toBe(8)
  })
})
