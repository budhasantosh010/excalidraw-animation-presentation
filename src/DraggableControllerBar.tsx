import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'

import {
  getDraggedControllerPosition,
  type ControllerPlacement,
  type ControllerPosition,
} from './controllerPosition'

type DraggableControllerBarProps = {
  ariaLabel: string
  children: ReactNode
  className: string
  placement: ControllerPlacement
  role?: 'navigation' | 'region'
}

type ActiveDrag = {
  pointerId: number
  startPointer: { x: number; y: number }
  startPosition: ControllerPosition
}

export function DraggableControllerBar({
  ariaLabel,
  children,
  className,
  placement,
  role = 'region',
}: DraggableControllerBarProps) {
  const barRef = useRef<HTMLDivElement | null>(null)
  const activeDrag = useRef<ActiveDrag | null>(null)
  const [dragging, setDragging] = useState(false)
  const setControllerSize = placement.setControllerSize

  useEffect(() => {
    const bar = barRef.current
    if (!bar) return
    const measure = () => {
      const bounds = bar.getBoundingClientRect()
      setControllerSize({
        width: bounds.width,
        height: bounds.height,
      })
    }
    measure()
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(bar)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [setControllerSize])

  const handlePointerDown = (
    event: ReactPointerEvent<HTMLSpanElement>,
  ) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if (!placement.position) return
    event.currentTarget.setPointerCapture(event.pointerId)
    activeDrag.current = {
      pointerId: event.pointerId,
      startPointer: { x: event.clientX, y: event.clientY },
      startPosition: placement.position,
    }
    setDragging(true)
    event.preventDefault()
  }

  const handlePointerMove = (
    event: ReactPointerEvent<HTMLSpanElement>,
  ) => {
    const active = activeDrag.current
    if (!active || active.pointerId !== event.pointerId) return
    placement.setPosition(
      getDraggedControllerPosition(
        active.startPosition,
        active.startPointer,
        { x: event.clientX, y: event.clientY },
        placement.viewport,
        placement.controllerSize,
        placement.safeArea,
      ),
    )
  }

  const finishDrag = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (activeDrag.current?.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    activeDrag.current = null
    setDragging(false)
  }

  const style: CSSProperties = placement.position
    ? {
        left: placement.position.x,
        top: placement.position.y,
      }
    : {
        left: 0,
        top: 0,
        visibility: 'hidden',
      }

  return (
    <div
      ref={barRef}
      className={`${className} draggable-controller${dragging ? ' draggable-controller--dragging' : ''}`}
      role={role}
      aria-label={ariaLabel}
      style={style}
    >
      <span
        className="controller-drag-handle"
        role="button"
        tabIndex={0}
        aria-label="Move animation controls"
        title="Drag to move animation controls"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      >
        <span aria-hidden="true">⠿</span>
      </span>
      <button
        className="controller-reset-position"
        type="button"
        title="Reset control position"
        onClick={placement.resetPosition}
      >
        Reset position
      </button>
      {children}
    </div>
  )
}
