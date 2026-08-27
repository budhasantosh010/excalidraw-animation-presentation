import {
  exportToBlob,
  exportToCanvas,
  exportToSvg,
} from '@excalidraw/excalidraw'
import type {
  ExcalidrawElement,
  NonDeleted,
} from '@excalidraw/excalidraw/element/types'
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types'

import { normalizeExportOptions, validateExportSupport, type ExportOptions } from './exportModel'
import { serializeProject } from './projectFile'
import { getElementsAtTimelineTime } from './timeline'

export type ExportSnapshot = {
  elements: readonly ExcalidrawElement[]
  appState: Partial<AppState>
  files: BinaryFiles
}

export type ExportProgress = {
  completedFrames: number
  totalFrames: number
  percent: number
}

const liveElements = (elements: readonly ExcalidrawElement[]) =>
  elements.filter((element): element is NonDeleted<ExcalidrawElement> => !element.isDeleted)

const exportAppState = (
  appState: Partial<AppState>,
  options: ExportOptions,
): Partial<Omit<AppState, 'offsetTop' | 'offsetLeft'>> => ({
  ...appState,
  exportBackground: !options.transparent,
  exportScale: 1,
})

export const sourceExportBlob = (
  snapshot: ExportSnapshot,
  format: 'excalidraw' | 'json',
) => new Blob(
  [serializeProject(snapshot.elements, snapshot.appState, snapshot.files)],
  { type: format === 'json' ? 'application/json' : 'application/vnd.excalidraw+json' },
)

export const stillExportBlob = async (
  snapshot: ExportSnapshot,
  rawOptions: ExportOptions,
): Promise<Blob> => {
  const options = normalizeExportOptions(rawOptions)
  const elements = liveElements(snapshot.elements)
  if (!elements.length) throw new Error('Nothing drawable is available to export.')
  if (options.format === 'png') {
    const blob = await exportToBlob({
      elements,
      appState: exportAppState(snapshot.appState, options),
      files: snapshot.files,
      mimeType: 'image/png',
      getDimensions: () => ({ width: options.width, height: options.height }),
    })
    if (!blob.size || blob.type !== 'image/png') {
      throw new Error('PNG export produced an invalid result.')
    }
    return blob
  }
  if (options.format === 'svg') {
    const svg = await exportToSvg({
      elements,
      appState: exportAppState(snapshot.appState, options),
      files: snapshot.files,
    })
    svg.setAttribute('width', String(options.width))
    svg.setAttribute('height', String(options.height))
    const text = new XMLSerializer().serializeToString(svg)
    if (!text.includes('<svg')) throw new Error('SVG export produced an invalid result.')
    return new Blob([text], { type: 'image/svg+xml' })
  }
  throw new Error('Still export supports PNG or SVG only.')
}

const stoppedBlob = (recorder: MediaRecorder, chunks: Blob[]) =>
  new Promise<Blob>((resolve, reject) => {
    recorder.addEventListener('stop', () => {
      const blob = new Blob(chunks, { type: recorder.mimeType })
      if (!blob.size || !/^video\/(webm|mp4)/.test(blob.type)) {
        reject(new Error('Video recorder produced an invalid result.'))
        return
      }
      resolve(blob)
    }, { once: true })
    recorder.addEventListener('error', () => {
      reject(new Error('Video recorder failed.'))
    }, { once: true })
    recorder.stop()
  })

export const videoExportBlob = async (
  snapshot: ExportSnapshot,
  rawOptions: ExportOptions,
  onProgress?: (progress: ExportProgress) => void,
  signal?: AbortSignal,
): Promise<Blob> => {
  const options = normalizeExportOptions(rawOptions)
  if (options.format !== 'webm' && options.format !== 'mp4') {
    throw new Error('Video export supports WebM or MP4 only.')
  }
  const support = validateExportSupport(options.format)
  if (!support.supported || !support.mimeType) {
    throw new Error(support.reason ?? 'Video export is unsupported.')
  }
  const canvas = document.createElement('canvas')
  canvas.width = options.width
  canvas.height = options.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas rendering is unavailable.')
  const stream = canvas.captureStream(options.fps)
  const videoTrack = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined
  const recorder = new MediaRecorder(stream, { mimeType: support.mimeType })
  const chunks: Blob[] = []
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size) chunks.push(event.data)
  })
  const frameCount = Math.ceil(options.durationMs / 1000 * options.fps)
  const frameDelay = 1000 / options.fps
  recorder.start(Math.max(100, Math.round(frameDelay * 4)))
  try {
    for (let index = 0; index < frameCount; index += 1) {
      if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError')
      const timeMs = index * frameDelay
      const frameElements = liveElements(
        getElementsAtTimelineTime(snapshot.elements, timeMs),
      )
      const rendered = await exportToCanvas({
        elements: frameElements,
        appState: exportAppState(snapshot.appState, options),
        files: snapshot.files,
        getDimensions: () => ({ width: options.width, height: options.height }),
      })
      context.clearRect(0, 0, options.width, options.height)
      context.drawImage(rendered, 0, 0, options.width, options.height)
      videoTrack?.requestFrame?.()
      onProgress?.({
        completedFrames: index + 1,
        totalFrames: frameCount,
        percent: Math.round((index + 1) / frameCount * 100),
      })
      await new Promise((resolve) => window.setTimeout(resolve, frameDelay))
    }
    recorder.requestData()
    await new Promise((resolve) => window.setTimeout(resolve, Math.max(100, frameDelay)))
    return await stoppedBlob(recorder, chunks)
  } catch (error) {
    if (recorder.state !== 'inactive') recorder.stop()
    throw error
  } finally {
    for (const track of stream.getTracks()) track.stop()
  }
}

export const downloadExport = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
