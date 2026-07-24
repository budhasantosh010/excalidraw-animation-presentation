import { describe, expect, it } from 'vitest'

import {
  CONTROLLER_BOTTOM_CLEARANCE,
  CONTROLLER_POSITION_STORAGE_KEY,
  clampControllerPosition,
  getDefaultControllerPosition,
  getDraggedControllerPosition,
  parseStoredControllerPosition,
} from './controllerPosition'

const viewport = { width: 1200, height: 800 }
const controller = { width: 420, height: 80 }
const safeArea = { top: 10, right: 20, bottom: 30, left: 40 }

describe('animation controller position', () => {
  it('uses the stable storage key and 130px fullscreen clearance', () => {
    expect(CONTROLLER_POSITION_STORAGE_KEY).toBe(
      'sanverse-animation-controller-position-v1',
    )
    expect(CONTROLLER_BOTTOM_CLEARANCE).toBe(130)
  })

  it('defaults to bottom-center above the host composer', () => {
    expect(
      getDefaultControllerPosition(viewport, controller, safeArea),
    ).toEqual({
      x: 390,
      y: 560,
    })
  })

  it('clamps all edges using the safe area and measured controller size', () => {
    expect(
      clampControllerPosition(
        { x: -500, y: -500 },
        viewport,
        controller,
        safeArea,
      ),
    ).toEqual({ x: 52, y: 22 })

    expect(
      clampControllerPosition(
        { x: 5000, y: 5000 },
        viewport,
        controller,
        safeArea,
      ),
    ).toEqual({ x: 748, y: 678 })
  })

  it('keeps the controller reachable when the viewport becomes smaller', () => {
    expect(
      clampControllerPosition(
        { x: 900, y: 700 },
        { width: 260, height: 140 },
        controller,
        safeArea,
      ),
    ).toEqual({ x: 52, y: 22 })
  })

  it('applies pointer movement from the drag start and clamps the result', () => {
    expect(
      getDraggedControllerPosition(
        { x: 390, y: 560 },
        { x: 600, y: 600 },
        { x: 880, y: 200 },
        viewport,
        controller,
        safeArea,
      ),
    ).toEqual({ x: 670, y: 160 })
  })

  it('restores only finite saved coordinates', () => {
    expect(parseStoredControllerPosition('{"x":240,"y":160}')).toEqual({
      x: 240,
      y: 160,
    })
    expect(parseStoredControllerPosition('{"x":"240","y":160}')).toBeNull()
    expect(parseStoredControllerPosition('{"x":240}')).toBeNull()
    expect(parseStoredControllerPosition('not-json')).toBeNull()
    expect(parseStoredControllerPosition(null)).toBeNull()
  })
})
