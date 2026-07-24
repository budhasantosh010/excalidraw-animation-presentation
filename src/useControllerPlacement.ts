import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'

import {
  CONTROLLER_POSITION_STORAGE_KEY,
  EMPTY_CONTROLLER_SAFE_AREA,
  clampControllerPosition,
  getDefaultControllerPosition,
  parseStoredControllerPosition,
  type ControllerPlacement,
  type ControllerPosition,
  type ControllerSafeArea,
  type ControllerSize,
  type ControllerViewport,
} from './controllerPosition'

const getWindowViewport = (): ControllerViewport => ({
  width: Math.max(1, window.innerWidth),
  height: Math.max(1, window.innerHeight),
})

const samePosition = (
  first: ControllerPosition | null,
  second: ControllerPosition,
) => first?.x === second.x && first.y === second.y

export const useControllerPlacement = (
  hostViewport?: Partial<ControllerViewport>,
  hostSafeArea?: Partial<ControllerSafeArea>,
): ControllerPlacement => {
  const [windowViewport, setWindowViewport] = useState(getWindowViewport)
  const [controllerSize, setControllerSizeState] = useState<ControllerSize>({
    width: 0,
    height: 0,
  })
  const [position, setPositionState] = useState<ControllerPosition | null>(() => {
    try {
      return parseStoredControllerPosition(
        window.localStorage.getItem(CONTROLLER_POSITION_STORAGE_KEY),
      )
    } catch {
      return null
    }
  })

  useEffect(() => {
    const handleResize = () => setWindowViewport(getWindowViewport())
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const viewport = useMemo(
    () => ({
      width: hostViewport?.width ?? windowViewport.width,
      height: hostViewport?.height ?? windowViewport.height,
    }),
    [
      hostViewport?.height,
      hostViewport?.width,
      windowViewport.height,
      windowViewport.width,
    ],
  )
  const safeArea = useMemo(
    () => ({
      top: hostSafeArea?.top ?? EMPTY_CONTROLLER_SAFE_AREA.top,
      right: hostSafeArea?.right ?? EMPTY_CONTROLLER_SAFE_AREA.right,
      bottom: hostSafeArea?.bottom ?? EMPTY_CONTROLLER_SAFE_AREA.bottom,
      left: hostSafeArea?.left ?? EMPTY_CONTROLLER_SAFE_AREA.left,
    }),
    [
      hostSafeArea?.bottom,
      hostSafeArea?.left,
      hostSafeArea?.right,
      hostSafeArea?.top,
    ],
  )

  useEffect(() => {
    if (!controllerSize.width || !controllerSize.height) return
    setPositionState((current) => {
      const next = clampControllerPosition(
        current ??
          getDefaultControllerPosition(viewport, controllerSize, safeArea),
        viewport,
        controllerSize,
        safeArea,
      )
      return samePosition(current, next) ? current : next
    })
  }, [controllerSize, safeArea, viewport])

  useEffect(() => {
    if (!position) return
    try {
      window.localStorage.setItem(
        CONTROLLER_POSITION_STORAGE_KEY,
        JSON.stringify(position),
      )
    } catch {
      // The controller remains usable when the embedding host blocks storage.
    }
  }, [position])

  const setPosition = useCallback((next: ControllerPosition) => {
    setPositionState((current) =>
      samePosition(current, next) ? current : next,
    )
  }, [])
  const setControllerSize = useCallback((next: ControllerSize) => {
    setControllerSizeState((current) =>
      current.width === next.width && current.height === next.height
        ? current
        : next,
    )
  }, [])
  const resetPosition = useCallback(() => {
    if (!controllerSize.width || !controllerSize.height) return
    setPositionState(
      getDefaultControllerPosition(viewport, controllerSize, safeArea),
    )
  }, [controllerSize, safeArea, viewport])

  return {
    position,
    viewport,
    safeArea,
    controllerSize,
    setPosition,
    setControllerSize,
    resetPosition,
  }
}
