import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Excalidraw, newElementWith } from '@excalidraw/excalidraw'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import {
  bumpAnimationElementVersion,
  compileAtStep,
  ENTRY_ANIMATION_DURATION_MS,
  getAnimationFrameChanges,
  getAutoplayIntervalMs,
  getElementAnimation,
  getEntranceAnimationFrameChanges,
  getSettledAnimationFrameChanges,
  getStepCount,
  resolveAnimationEffect,
} from './animation'
import type { EditorSnapshot } from './Editor'
import {
  DraggableControllerBar,
} from './DraggableControllerBar'
import type { ControllerPlacement } from './controllerPosition'

type PresentationProps = {
  controllerPlacement: ControllerPlacement
  snapshot: EditorSnapshot
  onExit: () => void
  initialPlaybackState?: PresentationPlaybackState
  onPlaybackStateChange?: (state: PresentationPlaybackState) => void
}

export type PresentationPlaybackState = {
  currentStep: number
  isPlaying: boolean
  playbackSpeed: number
}

export function Presentation({
  controllerPlacement,
  snapshot,
  onExit,
  initialPlaybackState,
  onPlaybackStateChange,
}: PresentationProps) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null)
  const [currentStep, setCurrentStep] = useState(
    initialPlaybackState?.currentStep ?? 0,
  )
  const [isPlaying, setIsPlaying] = useState(
    initialPlaybackState?.isPlaying ?? false,
  )
  const [playbackSpeed, setPlaybackSpeed] = useState(
    initialPlaybackState?.playbackSpeed ?? 1,
  )
  const animationFrame = useRef<number | null>(null)
  const previousStep = useRef(0)
  const renderedById = useRef(new Map<string, ExcalidrawElement>())
  const stepCount = useMemo(() => getStepCount(snapshot.elements), [snapshot])

  useEffect(() => {
    onPlaybackStateChange?.({
      currentStep,
      isPlaying,
      playbackSpeed,
    })
  }, [
    currentStep,
    isPlaying,
    onPlaybackStateChange,
    playbackSpeed,
  ])
  const baseElements = useMemo(
    () => compileAtStep(snapshot.elements, currentStep),
    [currentStep, snapshot],
  )
  const visibleElements = useMemo(() => {
    if (currentStep <= previousStep.current) return baseElements

    return baseElements.map((element) => {
      const changes = getEntranceAnimationFrameChanges(element, currentStep, 0)
      return changes
        ? ({ ...element, ...changes } as ExcalidrawElement)
        : element
    })
  }, [baseElements, currentStep])

  const goToStep = useCallback(
    (nextStep: number) => {
      setCurrentStep(Math.max(0, Math.min(stepCount, nextStep)))
    },
    [stepCount],
  )

  const handleExit = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined)
    }
    onExit()
  }, [onExit])

  const enterFullscreen = () => {
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen().catch(() => undefined)
    }
  }

  const togglePlayback = useCallback(() => {
    if (isPlaying) {
      setIsPlaying(false)
      return
    }
    if (!stepCount) return
    if (currentStep >= stepCount) goToStep(0)
    setIsPlaying(true)
  }, [currentStep, goToStep, isPlaying, stepCount])

  const moveManually = useCallback(
    (nextStep: number) => {
      setIsPlaying(false)
      goToStep(nextStep)
    },
    [goToStep],
  )

  useEffect(() => {
    if (!isPlaying) return
    if (currentStep >= stepCount) {
      setIsPlaying(false)
      return
    }

    const delay = currentStep === 0 ? 140 : getAutoplayIntervalMs(playbackSpeed)
    const timer = window.setTimeout(() => {
      setCurrentStep((value) => Math.min(stepCount, value + 1))
    }, delay)
    return () => window.clearTimeout(timer)
  }, [currentStep, isPlaying, playbackSpeed, stepCount])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (
        target instanceof Element &&
        target.closest(
          'button, input, textarea, select, [contenteditable="true"]',
        )
      ) {
        return
      }

      const handled =
        event.key === 'ArrowRight' ||
        event.key === ' ' ||
        event.key === 'PageDown' ||
        event.key === 'ArrowLeft' ||
        event.key === 'PageUp' ||
        event.key === 'Home' ||
        event.key === 'End' ||
        event.key === 'Escape'
      if (!handled) return

      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.repeat) return

      if (
        event.key === 'ArrowRight' ||
        event.key === 'PageDown'
      ) {
        setIsPlaying(false)
        setCurrentStep((value) => Math.min(stepCount, value + 1))
      } else if (event.key === ' ') {
        togglePlayback()
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        setIsPlaying(false)
        setCurrentStep((value) => Math.max(0, value - 1))
      } else if (event.key === 'Home') {
        moveManually(0)
      } else if (event.key === 'End') {
        moveManually(stepCount)
      } else if (event.key === 'Escape') {
        handleExit()
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [handleExit, moveManually, stepCount, togglePlayback])

  useEffect(() => {
    if (!api) return

    if (animationFrame.current !== null) {
      cancelAnimationFrame(animationFrame.current)
      animationFrame.current = null
    }

    const isForward = currentStep > previousStep.current
    const animatedIds = new Set(
      baseElements
        .filter((element) => {
          const animation = getElementAnimation(element)
          return (
            animation?.step === currentStep &&
            resolveAnimationEffect(element, animation.effect) !== 'appear'
          )
        })
        .map((element) => element.id),
    )

    const preparedElements = baseElements.map((element) => {
      let prepared = renderedById.current.get(element.id) ?? element
      const settledChanges = getSettledAnimationFrameChanges(
        element,
        currentStep,
      )
      if (settledChanges) {
        prepared = newElementWith(
          prepared,
          settledChanges as Partial<ExcalidrawElement>,
        )
      }
      if (isForward && animatedIds.has(element.id)) {
        const entranceChanges = getEntranceAnimationFrameChanges(
          element,
          currentStep,
          0,
        )
        if (entranceChanges) {
          prepared = newElementWith(
            prepared,
            entranceChanges as Partial<ExcalidrawElement>,
          )
        }
      }
      renderedById.current.set(element.id, prepared)
      return prepared
    })

    previousStep.current = currentStep

    api.updateScene({ elements: preparedElements })

    if (!isForward || !animatedIds.size) {
      return
    }

    const startedAt = performance.now()
    const duration = ENTRY_ANIMATION_DURATION_MS / playbackSpeed
    const drawFrame = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration)
      const easedProgress = 1 - (1 - progress) ** 3
      const frameElements = baseElements.map((baseElement) => {
        const previous = renderedById.current.get(baseElement.id) ?? baseElement
        if (!animatedIds.has(baseElement.id)) {
          return bumpAnimationElementVersion(previous)
        }
        const animation = getElementAnimation(baseElement)
        if (!animation) return previous
        const changes = getAnimationFrameChanges(
          baseElement,
          animation.effect,
          easedProgress,
        )
        return newElementWith(
          previous,
          changes as Partial<ExcalidrawElement>,
        )
      })
      for (const element of frameElements) {
        renderedById.current.set(element.id, element)
      }
      api.updateScene({ elements: frameElements })

      if (progress < 1) {
        animationFrame.current = requestAnimationFrame(drawFrame)
      } else {
        animationFrame.current = null
      }
    }
    animationFrame.current = requestAnimationFrame(drawFrame)

    return () => {
      if (animationFrame.current !== null) {
        cancelAnimationFrame(animationFrame.current)
        animationFrame.current = null
      }
    }
  }, [api, baseElements, currentStep, playbackSpeed])

  useEffect(() => {
    if (!api) return

    const files = Object.values(snapshot.files)
    if (files.length) api.addFiles(files)

    const animationFrame = requestAnimationFrame(() => {
      const frame = snapshot.frameId
        ? snapshot.elements.find((element) => element.id === snapshot.frameId)
        : undefined
      const fitElements = frame ? [frame] : snapshot.elements
      if (fitElements.length) {
        api.scrollToContent(fitElements, {
          fitToContent: true,
          animate: false,
        })
      }
    })

    return () => cancelAnimationFrame(animationFrame)
  }, [api, snapshot])

  return (
    <main className="presentation-shell">
      <Excalidraw
        excalidrawAPI={setApi}
        initialData={{
          elements: visibleElements,
          appState: {
            ...snapshot.appState,
            selectedElementIds: {},
            selectedGroupIds: {},
            viewModeEnabled: true,
            zenModeEnabled: true,
          },
          files: snapshot.files,
        }}
        viewModeEnabled
        zenModeEnabled
      />

      <div className="presentation-counter" aria-live="polite">
        {currentStep}/{stepCount}
      </div>

      <DraggableControllerBar
        className="presentation-controls"
        ariaLabel="Presentation controls"
        placement={controllerPlacement}
        role="navigation"
      >
        <button type="button" onClick={() => moveManually(0)}>
          Restart
        </button>
        <button
          type="button"
          disabled={currentStep === 0}
          onClick={() => moveManually(currentStep - 1)}
        >
          Previous
        </button>
        <button
          className="play-button"
          type="button"
          aria-pressed={isPlaying}
          onClick={togglePlayback}
        >
          {isPlaying ? 'Pause' : currentStep >= stepCount ? 'Replay' : 'Play'}
        </button>
        <button
          type="button"
          disabled={currentStep === stepCount}
          onClick={() => moveManually(currentStep + 1)}
        >
          Next
        </button>
        <label className="playback-speed">
          <span className="visually-hidden">Playback speed</span>
          <select
            aria-label="Playback speed"
            value={playbackSpeed}
            onChange={(event) => setPlaybackSpeed(Number(event.target.value))}
          >
            <option value="0.75">0.75×</option>
            <option value="1">1×</option>
            <option value="1.5">1.5×</option>
            <option value="2">2×</option>
          </select>
        </label>
        <button type="button" onClick={enterFullscreen}>
          Fullscreen
        </button>
        <button type="button" onClick={handleExit}>
          Exit
        </button>
      </DraggableControllerBar>
    </main>
  )
}
