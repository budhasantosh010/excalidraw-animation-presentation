import { describe, expect, it } from 'vitest'

import { validateAnimationDocument } from './animation-tools.ts'
import { PILOT_PROJECTS, toCanonicalPilotName } from './pilot-projects.ts'

describe('real-work pilot seeds', () => {
  it('provides one valid agency project and one valid content project', () => {
    expect(PILOT_PROJECTS.map((project) => project.kind)).toEqual(['agency', 'content'])
    for (const project of PILOT_PROJECTS) {
      const validation = validateAnimationDocument(project.snapshot)
      expect(validation.valid).toBe(true)
      expect(validation.elementCount).toBeGreaterThanOrEqual(5)
      const frame = project.snapshot.elements.find((element) => element.type === 'frame')!
      expect(frame.customData.sanverseScene.camera).toHaveLength(2)
      expect(project.snapshot.elements.some(
        (element) => element.customData?.sanverseAnimation?.version === 2,
      )).toBe(true)
    }
  })

  it('matches pilot names using the project store canonical rules', () => {
    expect(toCanonicalPilotName('  AGENCY   FUNNEL PILOT  ')).toBe(
      toCanonicalPilotName('Agency funnel pilot'),
    )
    expect(toCanonicalPilotName('Ａgency funnel pilot')).toBe(
      toCanonicalPilotName('Agency funnel pilot'),
    )
  })
})
