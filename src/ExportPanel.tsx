import { useMemo, useRef, useState } from 'react'

import type { ExportSnapshot } from './exportMedia'
import {
  estimateExport,
  normalizeExportOptions,
  type ExportFormat,
  type ExportOptions,
  type ExportRange,
} from './exportModel'

type ExportPanelProps = {
  getSnapshot: (range: ExportRange) => ExportSnapshot
  onClose: () => void
}

const extensionFor = (format: ExportFormat) =>
  format === 'excalidraw' ? 'excalidraw' : format

export function ExportPanel({ getSnapshot, onClose }: ExportPanelProps) {
  const [options, setOptions] = useState<ExportOptions>({
    format: 'png',
    width: 1920,
    height: 1080,
    fps: 30,
    durationMs: 5000,
    transparent: false,
    range: 'all',
  })
  const [status, setStatus] = useState('Ready')
  const [busy, setBusy] = useState(false)
  const aborter = useRef<AbortController | null>(null)
  const estimate = useMemo(() => estimateExport(normalizeExportOptions(options)), [options])

  const patch = <Key extends keyof ExportOptions>(key: Key, value: ExportOptions[Key]) =>
    setOptions((current) => ({ ...current, [key]: value }))

  const run = async () => {
    setBusy(true)
    setStatus('Preparing export…')
    aborter.current = new AbortController()
    try {
      const {
        downloadExport,
        sourceExportBlob,
        stillExportBlob,
        videoExportBlob,
      } = await import('./exportMedia')
      const snapshot = getSnapshot(options.range)
      let blob: Blob
      if (options.format === 'excalidraw' || options.format === 'json') {
        blob = sourceExportBlob(snapshot, options.format)
      } else if (options.format === 'png' || options.format === 'svg') {
        blob = await stillExportBlob(snapshot, options)
      } else {
        blob = await videoExportBlob(
          snapshot,
          options,
          (progress) => setStatus(`Rendering ${progress.percent}%`),
          aborter.current.signal,
        )
      }
      downloadExport(blob, `sanverse-animation.${extensionFor(options.format)}`)
      setStatus(`Downloaded ${(blob.size / 1024).toFixed(1)} KB ${options.format.toUpperCase()}`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Export failed.')
    } finally {
      aborter.current = null
      setBusy(false)
    }
  }

  return (
    <aside className="export-panel" aria-label="Export animation">
      <header>
        <div><strong>Export</strong><span>Source, stills, and video</span></div>
        <button type="button" onClick={onClose}>Close</button>
      </header>
      <div className="export-grid">
        <label>
          <span>Format</span>
          <select
            aria-label="Export format"
            value={options.format}
            disabled={busy}
            onChange={(event) => patch('format', event.target.value as ExportFormat)}
          >
            <option value="excalidraw">Animated Excalidraw</option>
            <option value="json">Canonical JSON</option>
            <option value="png">PNG</option>
            <option value="svg">SVG</option>
            <option value="webm">WebM video</option>
            <option value="mp4">MP4 (when supported)</option>
          </select>
        </label>
        {(['width', 'height', 'fps', 'durationMs'] as const).map((key) => (
          <label key={key}>
            <span>{key === 'durationMs' ? 'Duration ms' : key}</span>
            <input
              aria-label={`Export ${key}`}
              type="number"
              disabled={busy}
              value={options[key]}
              onChange={(event) => patch(key, Number(event.target.value))}
            />
          </label>
        ))}
        <label>
          <span>Range</span>
          <select
            aria-label="Export range"
            value={options.range}
            disabled={busy}
            onChange={(event) => patch('range', event.target.value as ExportOptions['range'])}
          >
            <option value="all">All</option>
            <option value="scene">Selected scene</option>
            <option value="selection">Selected elements</option>
          </select>
        </label>
        <label className="export-check">
          <input
            type="checkbox"
            checked={options.transparent}
            disabled={busy}
            onChange={(event) => patch('transparent', event.target.checked)}
          />
          <span>Transparent background</span>
        </label>
      </div>
      <p>{estimate.frameCount} frames · {(estimate.rawFrameBytes / 1024 / 1024).toFixed(0)} MB raw workload</p>
      <output aria-live="polite">{status}</output>
      <div className="export-actions">
        <button type="button" disabled={busy} onClick={() => void run()}>
          {busy ? 'Exporting…' : 'Download'}
        </button>
        <button
          type="button"
          disabled={!busy}
          onClick={() => aborter.current?.abort()}
        >
          Cancel
        </button>
      </div>
    </aside>
  )
}
