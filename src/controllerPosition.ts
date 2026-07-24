export type ControllerPosition = {
  x: number
  y: number
}

export type ControllerPoint = {
  x: number
  y: number
}

export type ControllerViewport = {
  width: number
  height: number
}

export type ControllerSize = {
  width: number
  height: number
}

export type ControllerSafeArea = {
  top: number
  right: number
  bottom: number
  left: number
}

export type ControllerPlacement = {
  position: ControllerPosition | null
  viewport: ControllerViewport
  safeArea: ControllerSafeArea
  controllerSize: ControllerSize
  setPosition: (position: ControllerPosition) => void
  setControllerSize: (size: ControllerSize) => void
  resetPosition: () => void
}

export const CONTROLLER_POSITION_STORAGE_KEY =
  'sanverse-animation-controller-position-v1'
export const CONTROLLER_BOTTOM_CLEARANCE = 130
export const CONTROLLER_EDGE_GAP = 12

export const EMPTY_CONTROLLER_SAFE_AREA: ControllerSafeArea = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), maximum)

export const clampControllerPosition = (
  position: ControllerPosition,
  viewport: ControllerViewport,
  controller: ControllerSize,
  safeArea: ControllerSafeArea,
): ControllerPosition => {
  const minimumX = safeArea.left + CONTROLLER_EDGE_GAP
  const minimumY = safeArea.top + CONTROLLER_EDGE_GAP
  const maximumX = Math.max(
    minimumX,
    viewport.width -
      safeArea.right -
      CONTROLLER_EDGE_GAP -
      controller.width,
  )
  const maximumY = Math.max(
    minimumY,
    viewport.height -
      safeArea.bottom -
      CONTROLLER_EDGE_GAP -
      controller.height,
  )

  return {
    x: clamp(position.x, minimumX, maximumX),
    y: clamp(position.y, minimumY, maximumY),
  }
}

export const getDefaultControllerPosition = (
  viewport: ControllerViewport,
  controller: ControllerSize,
  safeArea: ControllerSafeArea,
): ControllerPosition =>
  clampControllerPosition(
    {
      x: (viewport.width - controller.width) / 2,
      y:
        viewport.height -
        safeArea.bottom -
        CONTROLLER_BOTTOM_CLEARANCE -
        controller.height,
    },
    viewport,
    controller,
    safeArea,
  )

export const getDraggedControllerPosition = (
  startPosition: ControllerPosition,
  startPointer: ControllerPoint,
  currentPointer: ControllerPoint,
  viewport: ControllerViewport,
  controller: ControllerSize,
  safeArea: ControllerSafeArea,
): ControllerPosition =>
  clampControllerPosition(
    {
      x: startPosition.x + currentPointer.x - startPointer.x,
      y: startPosition.y + currentPointer.y - startPointer.y,
    },
    viewport,
    controller,
    safeArea,
  )

export const parseStoredControllerPosition = (
  value: string | null,
): ControllerPosition | null => {
  if (!value) return null
  try {
    const candidate = JSON.parse(value) as {
      x?: unknown
      y?: unknown
    }
    return typeof candidate.x === 'number' &&
      Number.isFinite(candidate.x) &&
      typeof candidate.y === 'number' &&
      Number.isFinite(candidate.y)
      ? { x: candidate.x, y: candidate.y }
      : null
  } catch {
    return null
  }
}
