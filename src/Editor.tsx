import { useMemo, useRef, useState } from 'react'
import {
  convertToExcalidrawElements,
  Excalidraw,
  newElementWith,
} from '@excalidraw/excalidraw'
import type {
  ExcalidrawElement,
  ExcalidrawImageElement,
} from '@excalidraw/excalidraw/element/types'
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from '@excalidraw/excalidraw/types'
import {
  assignStep,
  clearStep,
  getElementAnimation,
  getOrderBadgePosition,
  getSelectionClosure,
  getStepCount,
  MAX_ANIMATION_STEP,
  type AnimationViewport,
  type SanverseAnimation,
} from './animation'
import {
  filterReferencedFiles,
  loadProjectFile,
  serializeProject,
} from './projectFile'
import {
  createBinaryFileData,
  fetchIconifyFile,
  insertImageFile,
  searchIconify,
  type IconifyResult,
} from './assets'
import { removeImageBackground } from './backgroundRemoval'
import {
  DraggableControllerBar,
} from './DraggableControllerBar'
import type { ControllerPlacement } from './controllerPosition'
import { TimelinePanel } from './TimelinePanel'

export type EditorSnapshot = {
  elements: readonly ExcalidrawElement[]
  appState: Partial<AppState>
  files: BinaryFiles
  frameId: string | null
}

const getPersistedSceneKey = (
  elements: readonly ExcalidrawElement[],
  appState: Partial<AppState>,
  files: BinaryFiles,
) => {
  const persistedAppState = JSON.parse(
    serializeProject([], appState, {} as BinaryFiles),
  ) as { appState?: unknown }
  return [
    ...elements.map(
      (element) =>
        `${element.id}:${element.version}:${element.versionNonce}:${element.isDeleted ? 1 : 0}`,
    ),
    `appState=${JSON.stringify(persistedAppState.appState ?? {})}`,
    `files=${Object.keys(files).sort().join(',')}`,
  ].join('|')
}

type EditorProps = {
  controllerPlacement: ControllerPlacement
  onPresent: (snapshot: EditorSnapshot) => void
  onSnapshotChange?: (snapshot: EditorSnapshot) => void
  initialSnapshot?: EditorSnapshot
  showAssetTools?: boolean
}

export function Editor({
  controllerPlacement,
  onPresent,
  onSnapshotChange,
  initialSnapshot,
  showAssetTools = true,
}: EditorProps) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [step, setStep] = useState(1)
  const [effect, setEffect] = useState<SanverseAnimation['effect']>('auto')
  const [stepCount, setStepCount] = useState(() =>
    getStepCount(initialSnapshot?.elements ?? []),
  )
  const [liveElements, setLiveElements] = useState<readonly ExcalidrawElement[]>(
    initialSnapshot?.elements ?? [],
  )
  const [liveFiles, setLiveFiles] = useState<BinaryFiles>(
    initialSnapshot?.files ?? {},
  )
  const [viewport, setViewport] = useState<AnimationViewport>({
    scrollX: 0,
    scrollY: 0,
    zoom: 1,
    offsetLeft: 0,
    offsetTop: 0,
  })
  const [fileStatus, setFileStatus] = useState('')
  const [assetsOpen, setAssetsOpen] = useState(false)
  const [timelineOpen, setTimelineOpen] = useState(false)
  const [assetBusy, setAssetBusy] = useState(false)
  const [iconQuery, setIconQuery] = useState('')
  const [icons, setIcons] = useState<IconifyResult[]>([])
  const fileInput = useRef<HTMLInputElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const latestElements = useRef<readonly ExcalidrawElement[]>(
    initialSnapshot?.elements ?? [],
  )
  const latestAppState = useRef<Partial<AppState>>(
    initialSnapshot?.appState ?? {},
  )
  const latestFiles = useRef<BinaryFiles>(initialSnapshot?.files ?? {})
  const sceneId = useRef(crypto.randomUUID())
  const lastReportedScene = useRef(
    initialSnapshot
      ? getPersistedSceneKey(
          initialSnapshot.elements,
          initialSnapshot.appState,
          initialSnapshot.files,
        )
      : '',
  )

  const sequence = useMemo(() => {
    const rows = new Map<
      number,
      {
        step: number
        count: number
        effects: Set<SanverseAnimation['effect']>
      }
    >()

    for (const element of liveElements) {
      if (element.isDeleted) continue
      const animation = getElementAnimation(element)
      if (!animation) continue
      const row = rows.get(animation.step) ?? {
        step: animation.step,
        count: 0,
        effects: new Set<SanverseAnimation['effect']>(),
      }
      row.count += 1
      row.effects.add(animation.effect)
      rows.set(animation.step, row)
    }

    return [...rows.values()].sort((first, second) => first.step - second.step)
  }, [liveElements])

  const orderBadges = useMemo(
    () =>
      liveElements.flatMap((element) => {
        if (element.isDeleted || element.type === 'frame') return []
        const animation = getElementAnimation(element)
        if (!animation) return []
        return [
          {
            id: element.id,
            step: animation.step,
            ...getOrderBadgePosition(element, viewport),
          },
        ]
      }),
    [liveElements, viewport],
  )

  const selectedImage = useMemo(() => {
    const selectedIdSet = new Set(selectedIds)
    const selectedElements = liveElements.filter(
      (element) => !element.isDeleted && selectedIdSet.has(element.id),
    )
    if (selectedElements.length !== 1) return null

    const [element] = selectedElements
    if (
      element.type !== 'image' ||
      !element.fileId ||
      !liveFiles[element.fileId]
    ) {
      return null
    }
    return element as ExcalidrawImageElement
  }, [liveElements, liveFiles, selectedIds])

  const updateSelection = (appState: AppState) => {
    const nextIds = Object.entries(appState.selectedElementIds)
      .filter(([, isSelected]) => isSelected)
      .map(([id]) => id)
    // Excalidraw fires onChange after every render; setting state with a fresh
    // array identity each time creates an infinite render loop. Bail out when
    // the selection is actually unchanged.
    setSelectedIds((previous) =>
      previous.length === nextIds.length &&
      previous.every((id, index) => id === nextIds[index])
        ? previous
        : nextIds,
    )
  }

  const applyElements = (
    elements: readonly ExcalidrawElement[],
    appState?: Pick<AppState, 'selectedElementIds'>,
  ) => {
    latestElements.current = elements
    setLiveElements(elements)
    setStepCount(getStepCount(elements))
    api?.updateScene({ elements, appState })
  }

  const handleAssign = () => {
    if (!selectedIds.length) return
    applyElements(
      assignStep(
        latestElements.current,
        selectedIds,
        step,
        sceneId.current,
        effect,
      ),
    )
  }

  const handleClear = () => {
    if (!selectedIds.length) return
    applyElements(clearStep(latestElements.current, selectedIds))
  }

  const handleTimelineSelect = (elementId: string) => {
    setSelectedIds([elementId])
    api?.updateScene({
      appState: {
        selectedElementIds: { [elementId]: true },
        selectedGroupIds: {},
      },
    })
  }

  const handlePresent = () => {
    const currentElements = api?.getSceneElements() ?? latestElements.current
    const currentAppState = api?.getAppState() ?? latestAppState.current

    const selectedFrame = currentElements.find(
      (element) =>
        !element.isDeleted &&
        element.type === 'frame' &&
        selectedIds.includes(element.id),
    )
    const firstFrame = currentElements.find(
      (element) => !element.isDeleted && element.type === 'frame',
    )
    const activeFrame = selectedFrame ?? firstFrame
    const initiallyScoped = currentElements.filter(
      (element) =>
        !element.isDeleted &&
        (!activeFrame ||
          element.id === activeFrame.id ||
          element.frameId === activeFrame.id),
    )
    const scopedIds = activeFrame
      ? getSelectionClosure(
          currentElements,
          initiallyScoped.map((element) => element.id),
        )
      : new Set(initiallyScoped.map((element) => element.id))
    const snapshotElements = currentElements.filter(
      (element) => !element.isDeleted && scopedIds.has(element.id),
    )
    const currentFiles = filterReferencedFiles(
      snapshotElements,
      api?.getFiles() ?? latestFiles.current,
    )

    onPresent({
      elements: snapshotElements.map((element) => ({
        ...element,
        customData: element.customData
          ? structuredClone(element.customData)
          : undefined,
        groupIds: [...element.groupIds],
        boundElements: element.boundElements
          ? element.boundElements.map((binding) => ({ ...binding }))
          : null,
      })) as ExcalidrawElement[],
      appState: {
        ...currentAppState,
        selectedElementIds: {},
        selectedGroupIds: {},
      },
      files: { ...currentFiles },
      frameId: activeFrame?.id ?? null,
    })
  }

  const handleAddFrame = () => {
    if (!api) return
    const appState = api.getAppState()
    const zoom = appState.zoom.value || 1
    const x = -appState.scrollX + appState.width / zoom / 2 - 800
    const y = -appState.scrollY + appState.height / zoom / 2 - 450
    const [frame] = convertToExcalidrawElements(
      [
        {
          type: 'frame',
          x,
          y,
          width: 1600,
          height: 900,
          children: [],
          name: '16:9 Scene',
        },
      ],
      { regenerateIds: true },
    )
    if (!frame) return

    const elements = [...latestElements.current, frame]
    applyElements(elements, {
      selectedElementIds: { [frame.id]: true },
    })
    requestAnimationFrame(() => {
      api.scrollToContent([frame], { fitToContent: true, animate: false })
    })
  }

  const handleSave = () => {
    try {
      const currentElements = api?.getSceneElements() ?? latestElements.current
      const currentAppState = api?.getAppState() ?? latestAppState.current
      const currentFiles = filterReferencedFiles(
        currentElements,
        api?.getFiles() ?? latestFiles.current,
      )
      const blob = new Blob(
        [serializeProject(currentElements, currentAppState, currentFiles)],
        { type: 'application/json' },
      )
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'sanverse-presentation.excalidraw'
      document.body.append(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 0)
      setFileStatus('Saved')
    } catch (error) {
      setFileStatus(error instanceof Error ? error.message : 'Save failed')
    }
  }

  const handleOpen = async (file: File | undefined) => {
    if (!file || !api) return
    try {
      const restored = await loadProjectFile(
        file,
        api.getAppState(),
        api.getSceneElements(),
      )
      const elements = restored.elements ?? []
      const files = restored.files ?? {}

      latestElements.current = elements
      latestAppState.current = restored.appState ?? {}
      latestFiles.current = files
      setLiveFiles(files)
      setLiveElements(elements)
      setStepCount(getStepCount(elements))
      api.addFiles(Object.values(files))
      api.updateScene({ elements, appState: restored.appState ?? undefined })
      setFileStatus(`Opened ${file.name}`)
    } catch (error) {
      setFileStatus(error instanceof Error ? error.message : 'Open failed')
    } finally {
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const handleInsertImage = async (file: File | undefined) => {
    if (!file || !api || assetBusy) return
    setAssetBusy(true)
    setFileStatus(`Adding ${file.name}...`)
    try {
      await insertImageFile(api, file)
      setFileStatus(`Added ${file.name}`)
    } catch (error) {
      setFileStatus(error instanceof Error ? error.message : 'Image insert failed')
    } finally {
      setAssetBusy(false)
      if (imageInput.current) imageInput.current.value = ''
    }
  }

  const handleIconSearch = async () => {
    if (assetBusy) return
    setAssetBusy(true)
    setFileStatus('Searching Iconify...')
    try {
      const results = await searchIconify(iconQuery)
      setIcons(results)
      setFileStatus(results.length ? `${results.length} icons found` : 'No icons found')
    } catch (error) {
      setIcons([])
      setFileStatus(error instanceof Error ? error.message : 'Icon search failed')
    } finally {
      setAssetBusy(false)
    }
  }

  const handleInsertIcon = async (icon: IconifyResult) => {
    if (!api || assetBusy) return
    setAssetBusy(true)
    setFileStatus(`Adding ${icon.id}...`)
    try {
      const file = await fetchIconifyFile(icon)
      await insertImageFile(api, file, { allowSvg: true })
      setFileStatus(`Added ${icon.id}`)
    } catch (error) {
      setFileStatus(error instanceof Error ? error.message : 'Icon insert failed')
    } finally {
      setAssetBusy(false)
    }
  }

  const handleRemoveBackground = async () => {
    if (!api || !selectedImage?.fileId || assetBusy) return
    const targetElementId = selectedImage.id
    const sourceFileId = selectedImage.fileId
    const source = (api.getFiles() ?? latestFiles.current)[sourceFileId]
    if (!source) {
      setFileStatus('The selected image file is missing.')
      return
    }

    setAssetBusy(true)
    setFileStatus('Preparing background removal...')
    try {
      const result = await removeImageBackground(source.dataURL, ({ asset, percent }) => {
        const label = asset.split('/').pop() ?? 'model'
        setFileStatus(`Downloading ${label}: ${percent}%`)
      })
      const sceneAfterRemoval = api.getSceneElements()
      const targetAfterRemoval = sceneAfterRemoval.find(
        (element) => element.id === targetElementId,
      )
      if (
        !targetAfterRemoval ||
        targetAfterRemoval.isDeleted ||
        targetAfterRemoval.type !== 'image' ||
        targetAfterRemoval.fileId !== sourceFileId
      ) {
        setFileStatus('Image changed while background removal was running; no changes applied.')
        return
      }

      const replacement = await createBinaryFileData(result)
      const currentElements = api.getSceneElements()
      const currentTarget = currentElements.find(
        (element) => element.id === targetElementId,
      )
      if (
        !currentTarget ||
        currentTarget.isDeleted ||
        currentTarget.type !== 'image' ||
        currentTarget.fileId !== sourceFileId
      ) {
        setFileStatus('Image changed while background removal was running; no changes applied.')
        return
      }

      const elements = currentElements.map((element) => {
        if (element.id !== currentTarget.id || element.type !== 'image') return element
        return newElementWith(element, {
          fileId: replacement.id,
          status: 'saved',
        })
      })
      api.addFiles([replacement])
      applyElements(elements)
      setFileStatus('Background removed')
    } catch {
      setFileStatus('Background removal unavailable; retry or use an external remover.')
    } finally {
      setAssetBusy(false)
    }
  }

  return (
    <main className="editor-shell">
      <Excalidraw
        excalidrawAPI={setApi}
        initialData={
          initialSnapshot
            ? {
                elements: initialSnapshot.elements,
                appState: initialSnapshot.appState,
                files: initialSnapshot.files,
              }
            : undefined
        }
        onChange={(elements, appState, files) => {
          latestElements.current = elements
          latestAppState.current = appState
          latestFiles.current = files
          // Identity guards for the same reason as updateSelection: an
          // unconditional setState per onChange re-render-loops Excalidraw.
          setLiveElements((previous) => (previous === elements ? previous : elements))
          setLiveFiles((previous) => (previous === files ? previous : files))
          const nextViewport: AnimationViewport = {
            scrollX: appState.scrollX,
            scrollY: appState.scrollY,
            zoom: appState.zoom.value,
            offsetLeft: appState.offsetLeft,
            offsetTop: appState.offsetTop,
          }
          setViewport((previous) =>
            previous.scrollX === nextViewport.scrollX &&
            previous.scrollY === nextViewport.scrollY &&
            previous.zoom === nextViewport.zoom &&
            previous.offsetLeft === nextViewport.offsetLeft &&
            previous.offsetTop === nextViewport.offsetTop
              ? previous
              : nextViewport,
          )
          updateSelection(appState)
          setStepCount(getStepCount(elements))
          if (onSnapshotChange) {
            const sceneKey = getPersistedSceneKey(elements, appState, files)
            if (sceneKey !== lastReportedScene.current) {
              lastReportedScene.current = sceneKey
              const frameId =
                initialSnapshot?.frameId &&
                elements.some(
                  (element) =>
                    !element.isDeleted &&
                    element.type === 'frame' &&
                    element.id === initialSnapshot.frameId,
                )
                  ? initialSnapshot.frameId
                  : (elements.find(
                      (element) =>
                        !element.isDeleted && element.type === 'frame',
                    )?.id ?? null)
              onSnapshotChange({
                elements,
                appState,
                files,
                frameId,
              })
            }
          }
        }}
      />

      <div className="order-badges" aria-hidden="true">
        {orderBadges.map((badge) => (
          <span
            key={badge.id}
            className={`order-badge order-badge--${(badge.step - 1) % 8}`}
            style={{ left: badge.x, top: badge.y }}
          >
            {badge.step}
          </span>
        ))}
      </div>

      {sequence.length ? (
        <aside className="sequence-panel" aria-label="Reveal sequence">
          <strong>Sequence</strong>
          <div className="sequence-list">
            {sequence.map((row) => (
              <button
                key={row.step}
                type="button"
                className={step === row.step ? 'is-current' : undefined}
                onClick={() => setStep(row.step)}
              >
                <span>Step {row.step}</span>
                <small>
                  {row.count} element{row.count === 1 ? '' : 's'} ·{' '}
                  {[...row.effects].join(', ')}
                </small>
              </button>
            ))}
          </div>
        </aside>
      ) : null}

      {showAssetTools ? (
        <aside className="assets-panel" aria-label="Image assets">
        <button
          className="assets-toggle"
          type="button"
          aria-expanded={assetsOpen}
          onClick={() => setAssetsOpen((open) => !open)}
        >
          Assets {assetsOpen ? '−' : '+'}
        </button>
      {assetsOpen ? (
          <div className="assets-content">
            <button
              type="button"
              disabled={!api || assetBusy}
              onClick={() => imageInput.current?.click()}
            >
              Upload image
            </button>
            <input
              ref={imageInput}
              className="visually-hidden"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(event) => void handleInsertImage(event.target.files?.[0])}
            />
            <small>You can also paste images directly on the canvas.</small>

            <form
              className="icon-search"
              onSubmit={(event) => {
                event.preventDefault()
                void handleIconSearch()
              }}
            >
              <input
                aria-label="Search logos and icons"
                placeholder="Search logos or icons"
                value={iconQuery}
                disabled={assetBusy}
                onChange={(event) => setIconQuery(event.target.value)}
              />
              <button type="submit" disabled={assetBusy || !iconQuery.trim()}>
                Search
              </button>
            </form>

            {icons.length ? (
              <div className="icon-results" aria-label="Iconify results">
                {icons.map((icon) => (
                  <button
                    key={icon.id}
                    type="button"
                    title={`Insert ${icon.id}`}
                    disabled={assetBusy}
                    onClick={() => void handleInsertIcon(icon)}
                  >
                    <img src={icon.url} alt="" loading="lazy" />
                    <span>{icon.id}</span>
                  </button>
                ))}
              </div>
            ) : null}

            <button
              type="button"
              disabled={!selectedImage || assetBusy}
              onClick={() => void handleRemoveBackground()}
            >
              {assetBusy ? 'Working…' : 'Remove background'}
            </button>
            <small>Select exactly one image to remove its background.</small>
          </div>
        ) : null}
        </aside>
      ) : null}

      {timelineOpen ? (
        <TimelinePanel
          elements={liveElements}
          selectedIds={selectedIds}
          onChange={applyElements}
          onSelect={handleTimelineSelect}
        />
      ) : null}

      <DraggableControllerBar
        className="animation-toolbar"
        ariaLabel="Animation controls"
        placement={controllerPlacement}
      >
        <div className="toolbar-stat">
          <span>Selected</span>
          <strong>{selectedIds.length}</strong>
        </div>

        <label className="step-field">
          <span>Step</span>
          <input
            aria-label="Reveal step"
            type="number"
            min={1}
            max={MAX_ANIMATION_STEP}
            value={step}
            onChange={(event) =>
              setStep(Math.max(1, Number.parseInt(event.target.value, 10) || 1))
            }
          />
        </label>

        <label className="effect-field">
          <span>Effect</span>
          <select
            aria-label="Reveal effect"
            value={effect}
            onChange={(event) =>
              setEffect(event.target.value as SanverseAnimation['effect'])
            }
          >
            <option value="auto">Auto</option>
            <option value="appear">Appear</option>
            <option value="fade">Fade</option>
            <option value="pop">Pop</option>
            <option value="draw">Draw on</option>
          </select>
        </label>

        <button type="button" disabled={!selectedIds.length} onClick={handleAssign}>
          Assign step
        </button>
        <button
          type="button"
          disabled={!selectedIds.length}
          onClick={() => {
            handleAssign()
            setStep((value) => Math.min(MAX_ANIMATION_STEP, value + 1))
          }}
        >
          Assign + next
        </button>
        <button type="button" disabled={!selectedIds.length} onClick={handleClear}>
          Clear step
        </button>

        <div className="toolbar-stat">
          <span>Total steps</span>
          <strong>{stepCount}</strong>
        </div>


        <button type="button" onClick={handleAddFrame}>
          Add 16:9 frame
        </button>
        <button
          type="button"
          aria-pressed={timelineOpen}
          onClick={() => setTimelineOpen((value) => !value)}
        >
          Timeline
        </button>
        <button type="button" onClick={handleSave}>
          Save
        </button>
        <button type="button" onClick={() => fileInput.current?.click()}>
          Open
        </button>
        <input
          ref={fileInput}
          className="visually-hidden"
          type="file"
          accept=".excalidraw,.json,application/json"
          onChange={(event) => void handleOpen(event.target.files?.[0])}
        />
        {fileStatus ? (
          <output className="file-status" title={fileStatus}>
            {fileStatus}
          </output>
        ) : null}

        <button
          className="present-button"
          type="button"
          disabled={!latestElements.current.length}
          onClick={handlePresent}
        >
          Present
        </button>
      </DraggableControllerBar>
    </main>
  )
}
