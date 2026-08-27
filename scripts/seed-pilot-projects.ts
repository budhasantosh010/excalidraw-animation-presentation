import { resolve } from 'node:path'

import { PILOT_PROJECTS, toCanonicalPilotName } from '../mcp/pilot-projects.ts'
import { createProjectControl } from '../mcp/project-control.ts'

const root = resolve(process.env.ANIMATION_WORKSPACE_DATA_DIR ?? '.sanverse-animation-data')
const control = await createProjectControl(root)
try {
  const existingNames = new Set(
    control.list().map((project) => toCanonicalPilotName(project.name)),
  )
  for (const pilot of PILOT_PROJECTS) {
    const canonicalName = toCanonicalPilotName(pilot.name)
    if (existingNames.has(canonicalName)) {
      console.log(`kept: ${pilot.name}`)
      continue
    }
    const created = control.create({ name: pilot.name, snapshot: pilot.snapshot })
    existingNames.add(canonicalName)
    console.log(`created: ${created.name} revision ${created.revision.number}`)
  }
} finally {
  control.close()
}
