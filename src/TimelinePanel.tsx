import { useMemo, useState } from 'react'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'

import {
  compileTimeline,
  getAnimationDefinition,
  getTimelineScenes,
  updateAnimationDefinition,
  updateSceneDefinition,
  type AnimationDefinitionPatch,
  type TimelineEasing,
  type TimelinePhase,
} from './timeline'

type TimelinePanelProps = {
  elements: readonly ExcalidrawElement[]
  selectedIds: readonly string[]
  onChange: (elements: ExcalidrawElement[]) => void
  onSelect: (elementId: string) => void
}

type DragState = {
  elementId: string
  originX: number
  delayMs: number
  durationMs: number
  mode: 'move' | 'resize'
}

const numberValue = (value: string, fallback: number) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function TimelinePanel({
  elements,
  selectedIds,
  onChange,
  onSelect,
}: TimelinePanelProps) {
  const [zoom, setZoom] = useState(1)
  const [drag, setDrag] = useState<DragState | null>(null)
  const timeline = useMemo(() => compileTimeline(elements), [elements])
  const scenes = useMemo(() => getTimelineScenes(elements), [elements])
  const selected = elements.find((element) => selectedIds.includes(element.id))
  const definition = selected ? getAnimationDefinition(selected) : undefined
  const selectedScene = selected?.type === 'frame'
    ? scenes.find((scene) => scene.frameId === selected.id)
    : undefined
  const pixelsPerMs = 0.08 * zoom
  const width = Math.max(720, timeline.durationMs * pixelsPerMs + 120)

  const patchSelected = (patch: AnimationDefinitionPatch) => {
    if (!selected) return
    onChange(updateAnimationDefinition(elements, [selected.id], patch))
  }

  const patchScene = (patch: Parameters<typeof updateSceneDefinition>[2]) => {
    if (!selectedScene) return
    onChange(updateSceneDefinition(elements, selectedScene.frameId, patch))
  }

  const cameraKeyframe = (position: 'start' | 'end') => {
    const fallback = {
      atMs: position === 'start' ? 0 : selectedScene?.durationMs ?? 5000,
      zoom: 1,
      scrollX: 0,
      scrollY: 0,
    }
    if (!selectedScene?.camera.length) return fallback
    return position === 'start'
      ? selectedScene.camera[0]!
      : selectedScene.camera[selectedScene.camera.length - 1]!
  }

  const patchCamera = (
    position: 'start' | 'end',
    key: 'atMs' | 'zoom' | 'scrollX' | 'scrollY',
    value: number,
  ) => {
    if (!selectedScene) return
    const start = { ...cameraKeyframe('start') }
    const end = { ...cameraKeyframe('end') }
    if (position === 'start') start[key] = value
    else end[key] = value
    patchScene({ camera: [start, end] })
  }

  const finishDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!drag) return
    const deltaMs = Math.round((event.clientX - drag.originX) / pixelsPerMs)
    const patch = drag.mode === 'move'
      ? { delayMs: Math.max(0, drag.delayMs + deltaMs) }
      : { durationMs: Math.max(50, drag.durationMs + deltaMs) }
    onChange(updateAnimationDefinition(elements, [drag.elementId], patch))
    setDrag(null)
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return (
    <section className="timeline-panel" aria-label="Animation timeline">
      <header className="timeline-header">
        <div>
          <strong>Timeline</strong>
          <span>{timeline.clips.length} clips · {(timeline.durationMs / 1000).toFixed(2)}s</span>
        </div>
        <label>
          <span>Zoom</span>
          <input
            aria-label="Timeline zoom"
            type="range"
            min="0.5"
            max="2.5"
            step="0.25"
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
          />
        </label>
      </header>

      <div className="timeline-body">
        <div className="timeline-tracks" style={{ width }}>
          <div className="timeline-ruler" aria-hidden="true">
            {Array.from({ length: Math.ceil(timeline.durationMs / 1000) + 1 }, (_, index) => (
              <span key={index} style={{ left: index * 1000 * pixelsPerMs }}>{index}s</span>
            ))}
          </div>
          {timeline.clips.map((clip) => {
            const active = selectedIds.includes(clip.elementId)
            return (
              <div className="timeline-track" key={clip.elementId}>
                <span className="timeline-track-name">{clip.elementId}</span>
                <button
                  type="button"
                  className={`timeline-clip timeline-clip--${clip.phase}${active ? ' is-active' : ''}`}
                  style={{
                    left: 110 + clip.startMs * pixelsPerMs,
                    width: Math.max(46, clip.durationMs * pixelsPerMs),
                  }}
                  onClick={() => onSelect(clip.elementId)}
                  onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture(event.pointerId)
                    setDrag({
                      elementId: clip.elementId,
                      originX: event.clientX,
                      delayMs: clip.definition.timing.delayMs,
                      durationMs: clip.durationMs,
                      mode: event.nativeEvent.offsetX > event.currentTarget.clientWidth - 12
                        ? 'resize'
                        : 'move',
                    })
                  }}
                  onPointerUp={finishDrag}
                >
                  <span>{clip.effect}</span>
                  <i aria-hidden="true" />
                </button>
              </div>
            )
          })}
          {!timeline.clips.length ? (
            <p className="timeline-empty">Assign a reveal step to create a timeline clip.</p>
          ) : null}
        </div>
      </div>

      <aside className="timeline-inspector" aria-label="Animation inspector">
        {definition && selected ? (
          <>
            <div className="inspector-title">
              <strong>{selected.id}</strong>
              <span>Step {definition.step} · {definition.effect}</span>
            </div>
            <label>
              <span>Duration</span>
              <input
                aria-label="Duration milliseconds"
                type="number"
                min="50"
                max="120000"
                value={definition.timing.durationMs}
                onChange={(event) => patchSelected({
                  durationMs: numberValue(event.target.value, definition.timing.durationMs),
                })}
              />
            </label>
            <label>
              <span>Delay</span>
              <input
                aria-label="Delay milliseconds"
                type="number"
                min="0"
                max="120000"
                value={definition.timing.delayMs}
                onChange={(event) => patchSelected({
                  delayMs: numberValue(event.target.value, definition.timing.delayMs),
                })}
              />
            </label>
            <label>
              <span>Easing</span>
              <select
                aria-label="Timeline easing"
                value={definition.timing.easing}
                onChange={(event) => patchSelected({ easing: event.target.value as TimelineEasing })}
              >
                <option value="linear">Linear</option>
                <option value="ease-in">Ease in</option>
                <option value="ease-out">Ease out</option>
                <option value="ease-in-out">Ease in/out</option>
              </select>
            </label>
            <label>
              <span>Phase</span>
              <select
                aria-label="Animation phase"
                value={definition.timing.phase}
                onChange={(event) => patchSelected({ phase: event.target.value as TimelinePhase })}
              >
                <option value="entrance">Entrance</option>
                <option value="emphasis">Emphasis</option>
                <option value="exit">Exit</option>
              </select>
            </label>
            <fieldset>
              <legend>Transform</legend>
              {(['x', 'y', 'scale', 'rotate', 'opacity'] as const).map((key) => (
                <label key={key}>
                  <span>{key}</span>
                  <input
                    aria-label={`Transform ${key}`}
                    type="number"
                    step={key === 'scale' ? '0.05' : '1'}
                    value={definition.transform?.[key] ?? (key === 'scale' ? 1 : key === 'opacity' ? 100 : 0)}
                    onChange={(event) => patchSelected({
                      transform: {
                        ...definition.transform,
                        [key]: numberValue(event.target.value, 0),
                      },
                    })}
                  />
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>Animation group</legend>
              <label>
                <span>Group ID</span>
                <input
                  aria-label="Animation group ID"
                  value={definition.group?.id ?? ''}
                  placeholder="None"
                  onChange={(event) => patchSelected(event.target.value.trim()
                    ? {
                        group: {
                          id: event.target.value,
                          order: definition.group?.order ?? 0,
                          intervalMs: definition.group?.intervalMs ?? 120,
                          direction: definition.group?.direction ?? 'forward',
                        },
                      }
                    : { group: null })}
                />
              </label>
              <label>
                <span>Order</span>
                <input
                  aria-label="Animation group order"
                  type="number"
                  min="0"
                  value={definition.group?.order ?? 0}
                  disabled={!definition.group}
                  onChange={(event) => definition.group && patchSelected({
                    group: {
                      ...definition.group,
                      order: numberValue(event.target.value, definition.group.order),
                    },
                  })}
                />
              </label>
              <label>
                <span>Stagger ms</span>
                <input
                  aria-label="Animation group stagger milliseconds"
                  type="number"
                  min="0"
                  value={definition.group?.intervalMs ?? 120}
                  disabled={!definition.group}
                  onChange={(event) => definition.group && patchSelected({
                    group: {
                      ...definition.group,
                      intervalMs: numberValue(event.target.value, definition.group.intervalMs),
                    },
                  })}
                />
              </label>
              <label>
                <span>Direction</span>
                <select
                  aria-label="Animation group direction"
                  value={definition.group?.direction ?? 'forward'}
                  disabled={!definition.group}
                  onChange={(event) => definition.group && patchSelected({
                    group: {
                      ...definition.group,
                      direction: event.target.value === 'reverse' ? 'reverse' : 'forward',
                    },
                  })}
                >
                  <option value="forward">Forward</option>
                  <option value="reverse">Reverse</option>
                </select>
              </label>
            </fieldset>
          </>
        ) : selectedScene ? (
          <>
            <div className="inspector-title">
              <strong>Scene settings</strong>
              <span>{selectedScene.frameId}</span>
            </div>
            <label>
              <span>Scene name</span>
              <input
                aria-label="Scene name"
                value={selectedScene.name}
                onChange={(event) => patchScene({ name: event.target.value })}
              />
            </label>
            <label>
              <span>Order</span>
              <input
                aria-label="Scene order"
                type="number"
                min="0"
                value={selectedScene.order}
                onChange={(event) => patchScene({
                  order: numberValue(event.target.value, selectedScene.order),
                })}
              />
            </label>
            <label>
              <span>Duration</span>
              <input
                aria-label="Scene duration milliseconds"
                type="number"
                min="100"
                value={selectedScene.durationMs}
                onChange={(event) => patchScene({
                  durationMs: numberValue(event.target.value, selectedScene.durationMs),
                })}
              />
            </label>
            {(['start', 'end'] as const).map((position) => {
              const keyframe = cameraKeyframe(position)
              return (
                <fieldset key={position}>
                  <legend>Camera {position}</legend>
                  {(['atMs', 'zoom', 'scrollX', 'scrollY'] as const).map((key) => (
                    <label key={key}>
                      <span>{key}</span>
                      <input
                        aria-label={`Camera ${position} ${key}`}
                        type="number"
                        step={key === 'zoom' ? '0.1' : '1'}
                        value={keyframe[key]}
                        onChange={(event) => patchCamera(
                          position,
                          key,
                          numberValue(event.target.value, keyframe[key]),
                        )}
                      />
                    </label>
                  ))}
                </fieldset>
              )
            })}
          </>
        ) : (
          <p>Select an animated element to edit timing and Transform tracks.</p>
        )}
        {scenes.length ? (
          <div className="timeline-scenes">
            <strong>Scenes</strong>
            {scenes.map((scene) => (
              <span key={scene.frameId}>{scene.order + 1}. {scene.name} · {(scene.durationMs / 1000).toFixed(1)}s</span>
            ))}
          </div>
        ) : null}
      </aside>
    </section>
  )
}
