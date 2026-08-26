import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'

export type SanverseAnimation = {
  version: 1 | 2
  sceneId: string
  step: number
  effect: 'auto' | 'appear' | 'fade' | 'pop' | 'draw'
}

export type ResolvedAnimationEffect = Exclude<
  SanverseAnimation['effect'],
  'auto'
>

const METADATA_KEY = 'sanverseAnimation'
export const MAX_ANIMATION_STEP = 999
export const ENTRY_ANIMATION_DURATION_MS = 650
const AUTOPLAY_BASE_INTERVAL_MS = 900

export const getAutoplayIntervalMs = (speed: number): number => {
  const safeSpeed = Number.isFinite(speed)
    ? Math.max(0.5, Math.min(2, speed))
    : 1
  return Math.round(AUTOPLAY_BASE_INTERVAL_MS / safeSpeed)
}

export type AnimationViewport = {
  scrollX: number
  scrollY: number
  zoom: number
  offsetLeft: number
  offsetTop: number
}

export const getOrderBadgePosition = (
  element: Pick<ExcalidrawElement, 'x' | 'y'>,
  viewport: AnimationViewport,
): { x: number; y: number } => ({
  x:
    (element.x + viewport.scrollX) * viewport.zoom +
    viewport.offsetLeft,
  y:
    (element.y + viewport.scrollY) * viewport.zoom +
    viewport.offsetTop,
})

const createVersionNonce = (previousNonce: number): number => {
  let nonce = previousNonce
  while (nonce === previousNonce) {
    nonce = Math.floor(Math.random() * 0x80000000)
  }
  return nonce
}

const updateElement = (
  element: ExcalidrawElement,
  changes: Partial<ExcalidrawElement>,
): ExcalidrawElement =>
  ({
    ...element,
    ...changes,
    version: element.version + 1,
    versionNonce: createVersionNonce(element.versionNonce),
    updated: Date.now(),
  }) as ExcalidrawElement

export const bumpAnimationElementVersion = (
  element: ExcalidrawElement,
): ExcalidrawElement => updateElement(element, {})

export const getElementAnimation = (
  element: ExcalidrawElement,
): SanverseAnimation | undefined => {
  const candidate = element.customData?.[METADATA_KEY] as
    | Partial<SanverseAnimation>
    | undefined

  if (
    candidate?.version !== 1 && candidate?.version !== 2 ||
    typeof candidate.sceneId !== 'string' ||
    typeof candidate.step !== 'number' ||
    !Number.isSafeInteger(candidate.step) ||
    candidate.step < 1 ||
    candidate.step > MAX_ANIMATION_STEP ||
    candidate.effect !== 'auto' &&
    candidate.effect !== 'appear' &&
    candidate.effect !== 'fade' &&
    candidate.effect !== 'pop' &&
    candidate.effect !== 'draw'
  ) {
    return undefined
  }

  return candidate as SanverseAnimation
}

export const resolveAnimationEffect = (
  element: ExcalidrawElement,
  effect: SanverseAnimation['effect'],
): ResolvedAnimationEffect => {
  if (effect !== 'auto') return effect
  if (
    element.type === 'arrow' ||
    element.type === 'line' ||
    element.type === 'freedraw'
  ) {
    return 'draw'
  }
  if (
    element.type === 'image' ||
    element.type === 'rectangle' ||
    element.type === 'diamond' ||
    element.type === 'ellipse'
  ) {
    return 'pop'
  }
  return 'fade'
}

export const getSelectionClosure = (
  elements: readonly ExcalidrawElement[],
  selectedIds: ReadonlySet<string> | readonly string[],
): Set<string> => {
  const liveElements = elements.filter((element) => !element.isDeleted)
  const liveIds = new Set(liveElements.map((element) => element.id))
  const closure = new Set(
    Array.from(selectedIds).filter((id) => liveIds.has(id)),
  )

  let changed = true
  while (changed) {
    changed = false

    const activeGroupIds = new Set<string>()
    for (const element of liveElements) {
      if (!closure.has(element.id)) continue
      for (const groupId of element.groupIds) activeGroupIds.add(groupId)
    }

    for (const element of liveElements) {
      const belongsToActiveGroup = element.groupIds.some((groupId) =>
        activeGroupIds.has(groupId),
      )
      const isBoundToIncludedContainer =
        'containerId' in element &&
        typeof element.containerId === 'string' &&
        closure.has(element.containerId)
      const includesBoundCounterpart = element.boundElements?.some((binding) =>
        closure.has(binding.id),
      )

      if (
        !closure.has(element.id) &&
        (belongsToActiveGroup ||
          isBoundToIncludedContainer ||
          includesBoundCounterpart)
      ) {
        closure.add(element.id)
        changed = true
      }

      if (!closure.has(element.id)) continue

      if (
        'containerId' in element &&
        typeof element.containerId === 'string' &&
        liveIds.has(element.containerId) &&
        !closure.has(element.containerId)
      ) {
        closure.add(element.containerId)
        changed = true
      }

      for (const binding of element.boundElements ?? []) {
        if (liveIds.has(binding.id) && !closure.has(binding.id)) {
          closure.add(binding.id)
          changed = true
        }
      }
    }
  }

  return closure
}

export const assignStep = (
  elements: readonly ExcalidrawElement[],
  selectedIds: ReadonlySet<string> | readonly string[],
  step: number,
  sceneId: string,
  effect: SanverseAnimation['effect'] = 'auto',
): ExcalidrawElement[] => {
  const normalizedStep = Number.isFinite(step) ? Math.trunc(step) : 1
  const safeStep = Math.max(
    1,
    Math.min(MAX_ANIMATION_STEP, normalizedStep),
  )
  const selectedIdSet = new Set(selectedIds)

  return elements.map((element) => {
    if (element.isDeleted || !selectedIdSet.has(element.id)) return element

    const animation: SanverseAnimation = {
      version: 1,
      sceneId,
      step: safeStep,
      effect,
    }

    return updateElement(element, {
      customData: {
        ...element.customData,
        [METADATA_KEY]: animation,
      },
    })
  })
}

export const clearStep = (
  elements: readonly ExcalidrawElement[],
  selectedIds: ReadonlySet<string> | readonly string[],
): ExcalidrawElement[] => {
  const selectedIdSet = new Set(selectedIds)

  return elements.map((element) => {
    if (element.isDeleted || !selectedIdSet.has(element.id)) return element

    const customData: Record<string, unknown> = { ...element.customData }
    delete customData[METADATA_KEY]

    return updateElement(element, { customData })
  })
}

export const getStepCount = (
  elements: readonly ExcalidrawElement[],
): number =>
  elements.reduce((highestStep, element) => {
    if (element.isDeleted) return highestStep
    return Math.max(highestStep, getElementAnimation(element)?.step ?? 0)
  }, 0)

export const compileAtStep = (
  elements: readonly ExcalidrawElement[],
  currentStep: number,
): ExcalidrawElement[] => {
  const safeCurrentStep = Math.max(0, Math.trunc(currentStep))

  return elements.filter((element) => {
    if (element.isDeleted) return false
    const animation = getElementAnimation(element)
    return !animation || animation.step <= safeCurrentStep
  })
}

export const interpolateOpacity = (
  originalOpacity: number,
  progress: number,
): number => {
  const clampedOpacity = Math.max(0, Math.min(100, originalOpacity))
  const clampedProgress = Math.max(0, Math.min(1, progress))
  return Math.round(clampedOpacity * clampedProgress)
}

type PathPoint = readonly [number, number]

export const interpolatePathPoints = (
  sourcePoints: readonly PathPoint[],
  progress: number,
): Array<[number, number]> => {
  if (!sourcePoints.length) return []
  const points = sourcePoints.map(
    ([x, y]) => [x, y] as [number, number],
  )
  if (points.length === 1) return [points[0]!, [...points[0]!] as [number, number]]

  const safeProgress = Number.isFinite(progress)
    ? Math.max(0, Math.min(1, progress))
    : 0
  if (safeProgress === 0) {
    return [points[0]!, [...points[0]!] as [number, number]]
  }
  if (safeProgress === 1) return points

  const segmentLengths = points.slice(1).map((point, index) => {
    const previous = points[index]!
    return Math.hypot(point[0] - previous[0], point[1] - previous[1])
  })
  const totalLength = segmentLengths.reduce((total, length) => total + length, 0)
  if (totalLength === 0) {
    return [points[0]!, [...points[0]!] as [number, number]]
  }

  const targetLength = totalLength * safeProgress
  const revealed: Array<[number, number]> = [points[0]!]
  let traversed = 0

  for (let index = 0; index < segmentLengths.length; index += 1) {
    const segmentLength = segmentLengths[index]!
    const start = points[index]!
    const end = points[index + 1]!
    const segmentEnd = traversed + segmentLength

    if (segmentEnd < targetLength) {
      revealed.push(end)
      traversed = segmentEnd
      continue
    }

    const segmentProgress = segmentLength
      ? (targetLength - traversed) / segmentLength
      : 0
    revealed.push([
      start[0] + (end[0] - start[0]) * segmentProgress,
      start[1] + (end[1] - start[1]) * segmentProgress,
    ])
    break
  }

  return revealed
}

export type AnimationFrameChanges = Record<string, unknown>

export const getAnimationFrameChanges = (
  element: ExcalidrawElement,
  effect: SanverseAnimation['effect'],
  progress: number,
): AnimationFrameChanges => {
  const safeProgress = Number.isFinite(progress)
    ? Math.max(0, Math.min(1, progress))
    : 0
  const resolvedEffect = resolveAnimationEffect(element, effect)

  if (
    resolvedEffect === 'draw' &&
    'points' in element &&
    Array.isArray(element.points)
  ) {
    return {
      points: interpolatePathPoints(
        element.points as unknown as readonly PathPoint[],
        safeProgress,
      ),
      ...('endArrowhead' in element
        ? {
            endArrowhead:
              safeProgress >= 0.98 ? element.endArrowhead : null,
          }
        : {}),
    }
  }

  if (resolvedEffect === 'fade') {
    return {
      opacity: interpolateOpacity(element.opacity, safeProgress),
    }
  }

  if (resolvedEffect === 'pop') {
    const scale = 0.86 + 0.14 * safeProgress
    const width = element.width * scale
    const height = element.height * scale
    return {
      x: element.x + (element.width - width) / 2,
      y: element.y + (element.height - height) / 2,
      width,
      height,
      opacity: interpolateOpacity(element.opacity, safeProgress),
    }
  }

  return {}
}

export const getEntranceAnimationFrameChanges = (
  element: ExcalidrawElement,
  currentStep: number,
  progress: number,
): AnimationFrameChanges | undefined => {
  const animation = getElementAnimation(element)
  if (
    !animation ||
    animation.step !== Math.max(0, Math.trunc(currentStep)) ||
    resolveAnimationEffect(element, animation.effect) === 'appear'
  ) {
    return undefined
  }

  return getAnimationFrameChanges(element, animation.effect, progress)
}

export const getSettledAnimationFrameChanges = (
  element: ExcalidrawElement,
  currentStep: number,
): AnimationFrameChanges | undefined => {
  const animation = getElementAnimation(element)
  if (!animation || animation.step >= currentStep) return undefined
  return getAnimationFrameChanges(element, animation.effect, 1)
}
