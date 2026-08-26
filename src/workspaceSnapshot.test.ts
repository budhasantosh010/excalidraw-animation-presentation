import { describe, expect, it } from 'vitest'

import { parseWorkspaceSnapshot } from './workspaceSnapshot.ts'

describe('workspace snapshot normalization', () => {
  it('normalizes only the browser export source to the durable local contract', () => {
    const serialized = JSON.stringify({
      type: 'excalidraw',
      version: 2,
      source: 'http://localhost:5199',
      elements: [{ id: 'shape', customData: { sanverseAnimation: { step: 2 } } }],
      appState: { viewBackgroundColor: '#ffffff' },
      files: {},
    })

    expect(parseWorkspaceSnapshot(serialized)).toEqual({
      type: 'excalidraw',
      version: 2,
      source: 'local',
      elements: [{ id: 'shape', customData: { sanverseAnimation: { step: 2 } } }],
      appState: { viewBackgroundColor: '#ffffff' },
      files: {},
    })
  })

  it('rejects malformed editor output', () => {
    expect(() => parseWorkspaceSnapshot('{}')).toThrow(/valid Excalidraw/i)
  })
})
