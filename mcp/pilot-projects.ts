import {
  applyRevisionOperations,
  buildAnimationDocument,
  type ExcalidrawDocument,
  type Storyboard,
} from './animation-tools.ts'

export const toCanonicalPilotName = (name: string) =>
  name.trim().replace(/\s+/g, ' ').normalize('NFKC').toLocaleLowerCase('en-US')

const agencyStoryboard: Storyboard = {
  projectName: 'Agency funnel pilot',
  scenes: [{
    sceneId: 'agency-funnel',
    title: 'Client acquisition funnel',
    elements: [
      { id: 'traffic', type: 'rectangle', x: 120, y: 300, width: 260, height: 120, text: 'Qualified traffic', animation: { step: 1, effect: 'pop' } },
      { id: 'lead', type: 'diamond', x: 520, y: 285, width: 180, height: 150, text: 'Lead fit?', animation: { step: 3, effect: 'fade' } },
      { id: 'sale', type: 'rectangle', x: 850, y: 300, width: 260, height: 120, text: 'Sales call', animation: { step: 5, effect: 'pop' } },
      { id: 'flow-a', type: 'arrow', x: 380, y: 360, width: 140, height: 0, startElementId: 'traffic', endElementId: 'lead', animation: { step: 2, effect: 'draw' } },
      { id: 'flow-b', type: 'arrow', x: 700, y: 360, width: 150, height: 0, startElementId: 'lead', endElementId: 'sale', animation: { step: 4, effect: 'draw' } },
    ],
  }],
}

const contentStoryboard: Storyboard = {
  projectName: 'Talking head visual pilot',
  scenes: [{
    sceneId: 'content-sequence',
    title: 'Why editing takes too long',
    elements: [
      { id: 'problem', type: 'rectangle', x: 120, y: 250, width: 330, height: 150, text: 'Hours of keyframes', animation: { step: 1, effect: 'fade' } },
      { id: 'shift', type: 'arrow', x: 470, y: 325, width: 220, height: 0, startElementId: 'problem', endElementId: 'result', animation: { step: 2, effect: 'draw' } },
      { id: 'result', type: 'rectangle', x: 710, y: 250, width: 360, height: 150, text: 'Animated idea in minutes', animation: { step: 3, effect: 'pop' } },
    ],
  }],
}

const enrich = (
  storyboard: Storyboard,
  frameId: string,
  animatedId: string,
): ExcalidrawDocument => applyRevisionOperations(buildAnimationDocument(storyboard), [
  {
    type: 'set_animation_timing',
    elementId: animatedId,
    durationMs: 900,
    delayMs: 100,
    easing: 'ease-in-out',
    phase: 'entrance',
    transform: { x: -80, opacity: 0 },
  },
  {
    type: 'set_scene',
    elementId: frameId,
    name: storyboard.scenes[0]!.title,
    order: 0,
    durationMs: 6000,
  },
  {
    type: 'set_camera_track',
    elementId: frameId,
    camera: [
      { atMs: 0, zoom: 0.9, scrollX: 0, scrollY: 0 },
      { atMs: 5000, zoom: 1.15, scrollX: -120, scrollY: -40 },
    ],
  },
])

export const PILOT_PROJECTS = [
  {
    name: agencyStoryboard.projectName,
    kind: 'agency' as const,
    snapshot: enrich(agencyStoryboard, 'frame_agency-funnel', 'traffic'),
  },
  {
    name: contentStoryboard.projectName,
    kind: 'content' as const,
    snapshot: enrich(contentStoryboard, 'frame_content-sequence', 'problem'),
  },
]
