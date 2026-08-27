import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { buildAnimationDocument } from './animation-tools.ts'
import { createProjectControl } from './project-control.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('project-aware MCP control', () => {
  it('creates finds opens revises and restores exact durable revisions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'animation-project-control-'))
    roots.push(root)
    const control = await createProjectControl(root)
    const snapshot = buildAnimationDocument({
      projectName: 'Agency map',
      scenes: [{
        sceneId: 'scene-a',
        title: 'Agency map',
        elements: [{
          id: 'box', type: 'rectangle', x: 10, y: 20, width: 100, height: 80,
          animation: { step: 1, effect: 'fade' },
        }],
      }],
    })

    const created = control.create({ name: 'Agency map', snapshot })
    expect(control.list({ query: 'agency' })).toHaveLength(1)
    expect(control.open({ projectId: created.projectId }).revision.number).toBe(1)

    const revised = control.revise({
      projectId: created.projectId,
      expectedRevision: 1,
      operations: [{ type: 'move_element', elementId: 'box', x: 400, y: 200 }],
    })
    expect(revised.revision.number).toBe(2)
    expect(revised.snapshot.elements.find((element) => element.id === 'box')).toMatchObject({ x: 400, y: 200 })
    expect(control.open({ projectId: created.projectId, revision: 1 }).snapshot.elements.find((element) => element.id === 'box')).toMatchObject({ x: 10, y: 20 })
    expect(control.history(created.projectId).map((entry) => entry.revisionNumber)).toEqual([2, 1])
    control.close()
  })
})
