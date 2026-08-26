import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'

import {
  bumpAnimationElementVersion,
  ENTRY_ANIMATION_DURATION_MS,
  getAnimationFrameChanges,
  getElementAnimation,
  type AnimationFrameChanges,
  type SanverseAnimation,
} from './animation'

export type TimelineEasing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'
export type TimelinePhase = 'entrance' | 'emphasis' | 'exit'

export type AnimationTiming = {
  durationMs: number
  delayMs: number
  easing: TimelineEasing
  phase: TimelinePhase
}

export type AnimationTransform = {
  x?: number
  y?: number
  scale?: number
  rotate?: number
  opacity?: number
}

export type AnimationGroup = {
  id: string
  order: number
  intervalMs: number
  direction: 'forward' | 'reverse'
}

export type AnimationDefinition = Omit<SanverseAnimation, 'version'> & {
  version: 1 | 2
  timing: AnimationTiming
  transform?: AnimationTransform
  group?: AnimationGroup
  trackId?: string
}

export type TimelineClip = {
  elementId: string
  sceneId: string
  step: number
  effect: SanverseAnimation['effect']
  phase: TimelinePhase
  startMs: number
  endMs: number
  durationMs: number
  definition: AnimationDefinition
}

export type CompiledTimeline = {
  clips: TimelineClip[]
  durationMs: number
}

export type TimelineScene = {
  frameId: string
  sceneId: string
  name: string
  order: number
  durationMs: number
  camera: Array<{
    atMs: number
    zoom: number
    scrollX: number
    scrollY: number
  }>
}

const DEFAULT_TIMING: AnimationTiming = {
  durationMs: ENTRY_ANIMATION_DURATION_MS,
  delayMs: 0,
  easing: 'ease-out',
  phase: 'entrance',
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value))

const finite = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const normalizeTiming = (value: unknown): AnimationTiming => {
  const timing = value && typeof value === 'object'
    ? value as Partial<AnimationTiming>
    : {}
  const easing: TimelineEasing =
    timing.easing === 'linear' ||
    timing.easing === 'ease-in' ||
    timing.easing === 'ease-out' ||
    timing.easing === 'ease-in-out'
      ? timing.easing
      : DEFAULT_TIMING.easing
  const phase: TimelinePhase =
    timing.phase === 'entrance' ||
    timing.phase === 'emphasis' ||
    timing.phase === 'exit'
      ? timing.phase
      : DEFAULT_TIMING.phase
  return {
    durationMs: Math.round(
      clamp(finite(timing.durationMs, DEFAULT_TIMING.durationMs), 50, 120_000),
    ),
    delayMs: Math.round(clamp(finite(timing.delayMs, 0), 0, 120_000)),
    easing,
    phase,
  }
}

const normalizeTransform = (value: unknown): AnimationTransform | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const source = value as AnimationTransform
  const transform: AnimationTransform = {}
  if (Number.isFinite(source.x)) transform.x = clamp(source.x!, -20_000, 20_000)
  if (Number.isFinite(source.y)) transform.y = clamp(source.y!, -20_000, 20_000)
  if (Number.isFinite(source.scale)) transform.scale = clamp(source.scale!, 0.05, 20)
  if (Number.isFinite(source.rotate)) transform.rotate = clamp(source.rotate!, -720, 720)
  if (Number.isFinite(source.opacity)) transform.opacity = clamp(source.opacity!, 0, 100)
  return Object.keys(transform).length ? transform : undefined
}

const normalizeGroup = (value: unknown): AnimationGroup | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const source = value as Partial<AnimationGroup>
  if (typeof source.id !== 'string' || !source.id.trim()) return undefined
  return {
    id: source.id,
    order: Math.max(0, Math.trunc(finite(source.order, 0))),
    intervalMs: Math.round(clamp(finite(source.intervalMs, 0), 0, 30_000)),
    direction: source.direction === 'reverse' ? 'reverse' : 'forward',
  }
}

export const getAnimationDefinition = (
  element: ExcalidrawElement,
): AnimationDefinition | undefined => {
  const candidate = element.customData?.sanverseAnimation as
    | Record<string, unknown>
    | undefined
  if (candidate?.version !== 2) {
    const legacy = getElementAnimation(element)
    return legacy ? { ...legacy, timing: { ...DEFAULT_TIMING } } : undefined
  }
  if (
    typeof candidate.sceneId !== 'string' ||
    !Number.isSafeInteger(candidate.step) ||
    typeof candidate.effect !== 'string'
  ) {
    return undefined
  }
  const effect = candidate.effect as SanverseAnimation['effect']
  if (!['auto', 'appear', 'fade', 'pop', 'draw'].includes(effect)) return undefined

  return {
    version: 2,
    sceneId: candidate.sceneId,
    step: clamp(candidate.step as number, 1, 999),
    effect,
    timing: normalizeTiming(candidate.timing),
    transform: normalizeTransform(candidate.transform),
    group: normalizeGroup(candidate.group),
    trackId: typeof candidate.trackId === 'string' ? candidate.trackId : undefined,
  }
}

export type AnimationDefinitionPatch = Partial<AnimationTiming> & {
  transform?: AnimationTransform
  group?: AnimationGroup | null
  trackId?: string
}

export const updateAnimationDefinition = (
  elements: readonly ExcalidrawElement[],
  selectedIds: ReadonlySet<string> | readonly string[],
  patch: AnimationDefinitionPatch,
): ExcalidrawElement[] => {
  const selected = new Set(selectedIds)
  return elements.map((element) => {
    if (element.isDeleted || !selected.has(element.id)) return element
    const definition = getAnimationDefinition(element)
    if (!definition) return element
    const existing = element.customData?.sanverseAnimation as Record<string, unknown>
    const timing = normalizeTiming({ ...definition.timing, ...patch })
    const next = bumpAnimationElementVersion(element)
    return {
      ...next,
      customData: {
        ...element.customData,
        sanverseAnimation: {
          ...existing,
          version: 2,
          sceneId: definition.sceneId,
          step: definition.step,
          effect: definition.effect,
          timing,
          ...(patch.transform === undefined && definition.transform === undefined
            ? {}
            : { transform: normalizeTransform(patch.transform ?? definition.transform) }),
          ...(patch.group === null
            ? { group: undefined }
            : patch.group === undefined && definition.group === undefined
              ? {}
              : { group: normalizeGroup(patch.group ?? definition.group) }),
          ...(patch.trackId === undefined && definition.trackId === undefined
            ? {}
            : { trackId: patch.trackId ?? definition.trackId }),
        },
      },
    } as ExcalidrawElement
  })
}

export const compileTimeline = (
  elements: readonly ExcalidrawElement[],
): CompiledTimeline => {
  const clips = elements.flatMap((element): TimelineClip[] => {
    if (element.isDeleted) return []
    const definition = getAnimationDefinition(element)
    if (!definition) return []
    const stagger = definition.group
      ? definition.group.order * definition.group.intervalMs
      : 0
    const startMs =
      (definition.step - 1) * 900 + definition.timing.delayMs + stagger
    return [{
      elementId: element.id,
      sceneId: definition.sceneId,
      step: definition.step,
      effect: definition.effect,
      phase: definition.timing.phase,
      startMs,
      endMs: startMs + definition.timing.durationMs,
      durationMs: definition.timing.durationMs,
      definition,
    }]
  }).sort((first, second) =>
    first.startMs - second.startMs || first.elementId.localeCompare(second.elementId),
  )
  return {
    clips,
    durationMs: clips.reduce((highest, clip) => Math.max(highest, clip.endMs), 0),
  }
}

export const getTimelineStepDuration = (
  timeline: CompiledTimeline,
  step: number,
): number => {
  const baseMs = (Math.max(1, Math.trunc(step)) - 1) * 900
  return timeline.clips
    .filter((clip) => clip.step === step)
    .reduce(
      (duration, clip) => Math.max(duration, clip.endMs - baseMs),
      0,
    )
}

const ease = (progress: number, easing: TimelineEasing) => {
  if (easing === 'linear') return progress
  if (easing === 'ease-in') return progress ** 3
  if (easing === 'ease-in-out') {
    return progress < 0.5
      ? 4 * progress ** 3
      : 1 - (-2 * progress + 2) ** 3 / 2
  }
  return 1 - (1 - progress) ** 3
}

const transformChanges = (
  element: ExcalidrawElement,
  transform: AnimationTransform,
  amount: number,
): AnimationFrameChanges => {
  const scale = 1 + ((transform.scale ?? 1) - 1) * amount
  return {
    x: element.x + (transform.x ?? 0) * amount,
    y: element.y + (transform.y ?? 0) * amount,
    width: element.width * scale,
    height: element.height * scale,
    angle: element.angle + ((transform.rotate ?? 0) * Math.PI / 180) * amount,
    opacity: Math.round(
      element.opacity + ((transform.opacity ?? element.opacity) - element.opacity) * amount,
    ),
  }
}

export const sampleTimelineElement = (
  element: ExcalidrawElement,
  clip: TimelineClip,
  timeMs: number,
): { visible: boolean; progress: number; changes: AnimationFrameChanges } => {
  const raw = clamp((timeMs - clip.startMs) / clip.durationMs, 0, 1)
  const progress = ease(raw, clip.definition.timing.easing)
  if (clip.phase === 'entrance' && timeMs < clip.startMs) {
    return { visible: false, progress: 0, changes: {} }
  }
  if (clip.phase === 'exit' && timeMs >= clip.endMs) {
    return { visible: false, progress: 1, changes: {} }
  }

  const amount = clip.phase === 'entrance'
    ? 1 - progress
    : clip.phase === 'exit'
      ? progress
      : Math.sin(Math.PI * progress)
  const changes = clip.definition.transform
    ? transformChanges(element, clip.definition.transform, amount)
    : getAnimationFrameChanges(
        element,
        clip.effect,
        clip.phase === 'entrance' ? progress : 1 - amount,
      )
  return { visible: true, progress, changes }
}

export const getElementsAtTimelineTime = (
  elements: readonly ExcalidrawElement[],
  timeMs: number,
): ExcalidrawElement[] => {
  const timeline = compileTimeline(elements)
  const clips = new Map(timeline.clips.map((clip) => [clip.elementId, clip]))
  return elements.flatMap((element) => {
    if (element.isDeleted) return []
    const clip = clips.get(element.id)
    if (!clip) return [element]
    const sampled = sampleTimelineElement(element, clip, timeMs)
    if (!sampled.visible) return []
    return [{ ...element, ...sampled.changes } as ExcalidrawElement]
  })
}

export const getTimelineScenes = (
  elements: readonly ExcalidrawElement[],
): TimelineScene[] =>
  elements.flatMap((element): TimelineScene[] => {
    if (element.isDeleted || element.type !== 'frame') return []
    const candidate = element.customData?.sanverseScene as
      | Record<string, unknown>
      | undefined
    const camera = Array.isArray(candidate?.camera)
      ? candidate.camera.flatMap((item): TimelineScene['camera'] => {
          if (!item || typeof item !== 'object') return []
          const keyframe = item as Record<string, unknown>
          return [{
            atMs: Math.round(clamp(finite(keyframe.atMs, 0), 0, 120_000)),
            zoom: clamp(finite(keyframe.zoom, 1), 0.1, 4),
            scrollX: clamp(finite(keyframe.scrollX, 0), -100_000, 100_000),
            scrollY: clamp(finite(keyframe.scrollY, 0), -100_000, 100_000),
          }]
        })
      : []
    return [{
      frameId: element.id,
      sceneId: typeof candidate?.sceneId === 'string' ? candidate.sceneId : element.id,
      name:
        typeof candidate?.name === 'string'
          ? candidate.name
          : ('name' in element && typeof element.name === 'string' ? element.name : 'Scene'),
      order: Math.max(0, Math.trunc(finite(candidate?.order, 0))),
      durationMs: Math.round(clamp(finite(candidate?.durationMs, 5_000), 100, 120_000)),
      camera: camera.sort((first, second) => first.atMs - second.atMs),
    }]
  }).sort((first, second) => first.order - second.order || first.frameId.localeCompare(second.frameId))

export type SceneDefinitionPatch = Partial<
  Pick<TimelineScene, 'name' | 'order' | 'durationMs' | 'camera'>
>

export const updateSceneDefinition = (
  elements: readonly ExcalidrawElement[],
  frameId: string,
  patch: SceneDefinitionPatch,
): ExcalidrawElement[] =>
  elements.map((element) => {
    if (element.id !== frameId || element.isDeleted || element.type !== 'frame') {
      return element
    }
    const current = getTimelineScenes([element])[0]!
    const next = bumpAnimationElementVersion(element)
    return {
      ...next,
      customData: {
        ...element.customData,
        sanverseScene: {
          version: 1,
          sceneId: current.sceneId,
          name: patch.name ?? current.name,
          order: Math.max(0, Math.trunc(patch.order ?? current.order)),
          durationMs: Math.round(
            clamp(patch.durationMs ?? current.durationMs, 100, 120_000),
          ),
          camera: (patch.camera ?? current.camera).map((keyframe) => ({
            atMs: Math.round(clamp(keyframe.atMs, 0, 120_000)),
            zoom: clamp(keyframe.zoom, 0.1, 4),
            scrollX: clamp(keyframe.scrollX, -100_000, 100_000),
            scrollY: clamp(keyframe.scrollY, -100_000, 100_000),
          })).sort((first, second) => first.atMs - second.atMs),
        },
      },
    } as ExcalidrawElement
  })

export const sampleSceneCamera = (
  scene: TimelineScene,
  timeMs: number,
): { zoom: number; scrollX: number; scrollY: number } | undefined => {
  if (!scene.camera.length) return undefined
  const time = clamp(timeMs, 0, scene.durationMs)
  const nextIndex = scene.camera.findIndex((keyframe) => keyframe.atMs >= time)
  if (nextIndex <= 0) {
    const keyframe = scene.camera[Math.max(0, nextIndex)] ?? scene.camera.at(-1)!
    return {
      zoom: keyframe.zoom,
      scrollX: keyframe.scrollX,
      scrollY: keyframe.scrollY,
    }
  }
  const next = scene.camera[nextIndex]!
  const previous = scene.camera[nextIndex - 1]!
  const progress = (time - previous.atMs) / Math.max(1, next.atMs - previous.atMs)
  return {
    zoom: previous.zoom + (next.zoom - previous.zoom) * progress,
    scrollX: previous.scrollX + (next.scrollX - previous.scrollX) * progress,
    scrollY: previous.scrollY + (next.scrollY - previous.scrollY) * progress,
  }
}
