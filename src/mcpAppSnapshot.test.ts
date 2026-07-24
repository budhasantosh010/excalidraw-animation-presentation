import { describe, expect, it } from 'vitest'

import { parseMcpAppProject } from './mcpAppSnapshot'

const populatedResult = {
  structuredContent: {
    filename: 'demo.excalidraw',
    revision: 1,
    drawableElementCount: 1,
    animatedElementCount: 1,
    stepCount: 1,
  },
  _meta: {
    filename: 'demo.excalidraw',
    revision: 1,
    uiResourceUri: 'ui://sanverse/animation-studio-v4.html',
    projectSnapshot: {
      type: 'excalidraw',
      version: 2,
      elements: [
        {
          id: 'shape',
          type: 'rectangle',
          isDeleted: false,
          customData: {
            sanverseAnimation: {
              version: 1,
              sceneId: 'scene-1',
              step: 1,
              effect: 'pop',
            },
          },
        },
      ],
      appState: {},
      files: {},
    },
  },
}

describe('MCP App project handoff', () => {
  it('accepts one exact populated snapshot and revision', () => {
    const project = parseMcpAppProject(populatedResult)

    expect(project.filename).toBe('demo.excalidraw')
    expect(project.revision).toBe(1)
    expect(project.snapshot.elements).toHaveLength(1)
  })

  it.each([
    undefined,
    {},
    { ...populatedResult, _meta: undefined },
    {
      ...populatedResult,
      _meta: {
        ...populatedResult._meta,
        projectSnapshot: {
          ...populatedResult._meta.projectSnapshot,
          elements: [],
        },
      },
    },
  ])('rejects missing, malformed, or blank project data', (result) => {
    expect(() => parseMcpAppProject(result)).toThrow(
      /project|snapshot|drawable/i,
    )
  })

  it('rejects a result whose summary and private revision do not match', () => {
    expect(() =>
      parseMcpAppProject({
        ...populatedResult,
        _meta: { ...populatedResult._meta, revision: 2 },
      }),
    ).toThrow(/revision|match/i)
  })

  it('rejects a project that differs from the requested filename', () => {
    expect(() =>
      parseMcpAppProject(populatedResult, 'different.excalidraw'),
    ).toThrow(/requested|filename/i)
  })
})
